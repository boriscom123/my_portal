// Приёмник обновлений бота: зритель нажал «Start» — получил урок.
//
// Задача — отдать полную запись урока в личку тому, кто пришёл по ссылке
// t.me/бот?start=l36 из анонса. Запись уже загружена автором, поэтому уходит
// по номеру файла: мгновенно и без траты трафика.
//
// Это единственный вход портала без сессии: здесь не человек с куками, а
// площадка со своим запросом. Поэтому адрес со скрытой частью — она считается
// из токена бота и нигде не показывается. Знает её только Telegram, которому
// мы сами её и сообщили.
// Подключается из src/app.js.
import { Router } from 'express';
import express from 'express';
import { createHash } from 'node:crypto';
import { getLessonById } from '../services/lessons.js';
import { telegramFileOfLesson } from '../services/telegram-files.js';
import { sendStoredVideo, sendBotMessage } from '../services/platforms/telegram-channel.js';

/** Скрытая часть адреса: из токена, чтобы не заводить ещё одну настройку. */
export function webhookSecret(config) {
  return createHash('sha256')
    .update(String(config.telegram?.botToken ?? ''))
    .digest('hex')
    .slice(0, 32);
}

/** Полный адрес приёмника — его же сообщаем площадке в setWebhook. */
export function webhookPath(config) {
  return `/api/telegram/hook/${webhookSecret(config)}`;
}

/** Номер урока из «/start l36». null — пришли без него. */
export function lessonFromStart(text) {
  const match = /^\/start(?:@\S+)?\s+l(\d+)$/i.exec(String(text ?? '').trim());
  return match ? Number(match[1]) : null;
}

export function telegramBotRoutes(config, pool, fetchImpl = fetch) {
  const router = Router();
  const api = { apiUrl: config.telegram?.apiUrl, token: config.telegram?.botToken, fetchImpl };

  router.post('/hook/:secret', express.json({ limit: '64kb' }), async (req, res) => {
    // Адрес не тот — для чужого это просто несуществующая страница.
    if (!config.telegram?.botToken || req.params.secret !== webhookSecret(config)) {
      return res.status(404).json({ error: 'Не найдено' });
    }
    const message = req.body?.message;
    const chatId = message?.chat?.id;
    // Площадка повторяет обновление, пока не получит 200. Отвечаем всегда —
    // и всегда ПОСЛЕ работы: ответ раньше дела означал бы, что об отказе никто
    // не узнает, а проверить отправку нечем.
    if (!chatId) return res.json({ ok: true });

    try {
      const lessonId = lessonFromStart(message.text);
      const lesson = lessonId ? await getLessonById(pool, lessonId) : null;
      const fileId = lesson ? await telegramFileOfLesson(pool, lesson.id) : null;

      if (lesson && fileId) {
        await sendStoredVideo({
          ...api,
          chatId,
          fileId,
          caption: `${lesson.title}\n\n${config.publicBaseUrl}/lesson/${lesson.slug}`
        });
        return res.json({ ok: true });
      }

      // Урока нет, номера файла нет или пришли просто «Start» — отвечаем
      // словами: молчащий бот выглядит сломанным.
      const text = lesson
        ? `Видео этого урока ещё не готово к отправке. Посмотреть его можно на портале: ${config.publicBaseUrl}/lesson/${lesson.slug}`
        : `Здравствуйте! Этот бот присылает записи уроков портала целиком. Откройте нужный урок на сайте и нажмите там «Получить видео»: ${config.publicBaseUrl}/lessons`;
      await sendBotMessage({ ...api, chatId, text });
    } catch (error) {
      // Отказ площадки — наша забота, а не повод для повторов: Telegram будет
      // слать это обновление снова и снова, пока не получит 200.
      console.error('Бот не ответил человеку:', error.message);
    }
    res.json({ ok: true });
  });

  return router;
}
