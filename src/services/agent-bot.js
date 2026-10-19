// Разговор агента роликов с автором через бота портала.
//
// Задача — прислать автору черновик с кнопками и понимать его ответы: нажатые
// кнопки, голосовое для «Надиктую сам», текст для «Переделать». Бот тот же,
// что отдаёт зрителям уроки (TELEGRAM_BOT_TOKEN), — второго бота заводить
// незачем, а автору проще, когда всё приходит из одного места.
//
// Писать боту может кто угодно, поэтому всё, что меняет черновики, принимается
// только от автора: его Telegram-номер записан в ADMIN_IDENTITIES.
// Вызывается из src/jobs/agent-*.js и src/routes/telegram-bot.js.
import { readFile, writeFile } from 'node:fs/promises';
import { botMethod } from './platforms/telegram-channel.js';

// Приставка данных кнопки. По ней обработчик отличает кнопки агента от любых
// других, которые появятся у бота потом.
const PREFIX = 'agent';

export const ACTIONS = {
  publish: 'publish',
  voice: 'voice',
  film: 'film',
  redo: 'redo',
  reject: 'reject'
};

/** Номер автора в Telegram — он же номер личного чата с ботом. */
export function adminChatId(config) {
  const identity = (config.adminIdentities ?? []).find((item) =>
    ['tg_widget', 'tg_miniapp'].includes(item.provider)
  );
  return identity ? String(identity.externalId) : null;
}

/** Пишет ли это автор. Сравнение строками: номер приходит числом, а в настройке — текстом. */
export function isAdmin(config, telegramUserId) {
  const id = adminChatId(config);
  return Boolean(id) && String(telegramUserId) === id;
}

/** Данные кнопки: «agent:publish:42». Telegram ограничивает их 64 байтами — хватает. */
export function buttonData(action, shortId) {
  return `${PREFIX}:${action}:${shortId}`;
}

/** Разбирает данные кнопки; null — кнопка не агента или испорчена. */
export function parseButton(data) {
  const match = /^agent:(publish|voice|film|redo|reject):(\d+)$/.exec(String(data ?? ''));
  return match ? { action: match[1], shortId: Number(match[2]) } : null;
}

/**
 * Кнопки под черновиком. Три пути к ролику — выложить как есть, надиктовать,
 * снять самому — и две служебные. По две в строке, чтобы на телефоне подписи
 * не обрезались; «Выложить» — одна в первой строке: это главное действие.
 */
export function draftKeyboard(shortId) {
  return {
    inline_keyboard: [
      [{ text: '✅ Выложить', callback_data: buttonData(ACTIONS.publish, shortId) }],
      [
        { text: '🎙 Надиктую сам', callback_data: buttonData(ACTIONS.voice, shortId) },
        { text: '🎥 Сниму сам', callback_data: buttonData(ACTIONS.film, shortId) }
      ],
      [
        { text: '🔁 Переделать', callback_data: buttonData(ACTIONS.redo, shortId) },
        { text: '🗑 Выбросить', callback_data: buttonData(ACTIONS.reject, shortId) }
      ]
    ]
  };
}

/** Подпись черновика: то, что уйдёт на площадки, и откуда тема. */
export function draftCaption({ title, description, hashtags = [], topic }) {
  const tags = hashtags.map((tag) => `#${tag}`).join(' ');
  // Подпись видео у Telegram — до 1024 знаков; режем описание, а не ссылку.
  const head = `${title}\n\n${description}`.slice(0, 760);
  return [head, tags, `Источник: ${topic.url}`].filter(Boolean).join('\n\n');
}

async function call(config, name, payload, fetchImpl) {
  const api = config.telegram ?? {};
  const isForm = payload instanceof FormData;
  const response = await fetchImpl(botMethod(api.apiUrl, api.botToken, name), {
    method: 'POST',
    ...(isForm
      ? { body: payload }
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new Error(`Telegram отказал (${response.status}): ${body.description ?? 'без объяснения'}`);
  }
  return body.result;
}

/**
 * Присылает автору черновик: видео, подпись и кнопки.
 * Возвращает номер сообщения — по нему кнопки потом снимаются.
 */
export async function sendDraft(config, { filePath, caption, shortId }, fetchImpl = fetch) {
  const chatId = adminChatId(config);
  if (!chatId) throw new Error('Не знаю, кому слать черновик: в ADMIN_IDENTITIES нет Telegram-номера');
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('caption', caption);
  form.append('supports_streaming', 'true');
  form.append('reply_markup', JSON.stringify(draftKeyboard(shortId)));
  form.append('video', new Blob([await readFile(filePath)], { type: 'video/mp4' }), 'short.mp4');
  const result = await call(config, 'sendVideo', form, fetchImpl);
  return result.message_id;
}

/** Пишет автору словами. */
export async function tellAdmin(config, text, fetchImpl = fetch) {
  const chatId = adminChatId(config);
  if (!chatId) return null;
  const result = await call(
    config,
    'sendMessage',
    { chat_id: chatId, text, link_preview_options: { is_disabled: true } },
    fetchImpl
  );
  return result.message_id;
}

/**
 * Снимает кнопки с черновика и дописывает итог в подпись. Старое сообщение
 * после этого нажать нельзя — это и защищает от второго нажатия.
 * Отказ не роняет дело: кнопки — удобство, а выкладка уже идёт.
 */
export async function closeDraftMessage(config, { messageId, caption, outcome }, fetchImpl = fetch) {
  const chatId = adminChatId(config);
  if (!chatId || !messageId) return;
  try {
    await call(
      config,
      'editMessageCaption',
      { chat_id: chatId, message_id: messageId, caption: `${outcome}\n\n${caption}`.slice(0, 1024) },
      fetchImpl
    );
  } catch (error) {
    console.error('Агент: кнопки с черновика не снялись:', error.message);
  }
}

/** Гасит «часики» на нажатой кнопке и, если надо, показывает короткую надпись. */
export async function answerButton(config, callbackId, text = '', fetchImpl = fetch) {
  try {
    await call(config, 'answerCallbackQuery', { callback_query_id: callbackId, text }, fetchImpl);
  } catch (error) {
    console.error('Агент: ответ на кнопку не ушёл:', error.message);
  }
}

/**
 * Скачивает файл, присланный боту (голосовое автора), к себе на диск.
 * У своего сервера Bot API (TELEGRAM_API_URL) путь к файлу — локальный, у
 * облака — относительный адрес для скачивания; поддерживаем оба.
 */
export async function downloadBotFile(config, fileId, output, fetchImpl = fetch) {
  const file = await call(config, 'getFile', { file_id: fileId }, fetchImpl);
  const api = config.telegram ?? {};
  if (String(file.file_path).startsWith('/')) {
    await writeFile(output, await readFile(file.file_path));
    return output;
  }
  const base = api.apiUrl || 'https://api.telegram.org';
  const response = await fetchImpl(`${base}/file/bot${api.botToken}/${file.file_path}`);
  if (!response.ok) throw new Error(`голосовое не скачалось: ${response.status}`);
  await writeFile(output, Buffer.from(await response.arrayBuffer()));
  return output;
}
