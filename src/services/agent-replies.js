// Ответы автора агенту роликов: кнопки под черновиком, голосовое, поправка.
//
// Задача — превратить обновление от Telegram в переход черновика и задачу
// очереди. Здесь ничего долгого: Telegram ждёт ответа на обновление недолго и
// при молчании шлёт его снова, а сборка и модель идут минутами — их делает
// воркер.
//
// Кнопки остаются под черновиком, пока он не выложен или не выброшен: автор
// мог нажать «Надиктую сам», передумать и нажать «Выложить» как есть.
// Вызывается из src/routes/telegram-bot.js.
import { parseButton, isAdmin, answerButton, tellAdmin, closeDraftMessage, draftCaption, ACTIONS } from './agent-bot.js';
import { getDraft, moveDraft, draftWaitingFor } from './shorts-agent.js';
import { addJob, JOBS } from '../queue.js';

// Из каких состояний кнопки действуют: всё, где черновик ещё ждёт решения.
const OPEN = ['awaiting', 'voice_wait', 'redo_wait'];

async function onButton(config, pool, queue, query, fetchImpl) {
  const button = parseButton(query.data);
  if (!button) return false;
  if (!isAdmin(config, query.from?.id)) {
    await answerButton(config, query.id, 'Эти кнопки — только для автора', fetchImpl);
    return true;
  }

  const draft = await getDraft(pool, button.shortId);
  const closed = () => answerButton(config, query.id, 'Этот черновик уже закрыт', fetchImpl);
  if (!draft) return closed().then(() => true);

  if (button.action === ACTIONS.publish) {
    if (!(await moveDraft(pool, draft.shortId, { from: OPEN, to: 'published' }))) return closed().then(() => true);
    await addJob(queue, JOBS.agentPublish, { shortId: draft.shortId });
    await answerButton(config, query.id, 'Выкладываю', fetchImpl);
    return true;
  }

  if (button.action === ACTIONS.reject) {
    if (!(await moveDraft(pool, draft.shortId, { from: OPEN, to: 'rejected' }))) return closed().then(() => true);
    await closeDraftMessage(
      config,
      {
        messageId: draft.botMessageId,
        caption: draftCaption({ ...draft.script, topic: draft.topic }),
        outcome: '🗑 Выброшено'
      },
      fetchImpl
    );
    await answerButton(config, query.id, 'Выброшено', fetchImpl);
    return true;
  }

  if (button.action === ACTIONS.voice) {
    if (!(await moveDraft(pool, draft.shortId, { from: OPEN, to: 'voice_wait' }))) return closed().then(() => true);
    await answerButton(config, query.id, '', fetchImpl);
    await tellAdmin(
      config,
      `🎙 Пришлите голосовое — прочитайте текст ролика своими словами, до минуты:\n\n${(draft.script.sentences ?? []).join(' ')}`,
      fetchImpl
    );
    return true;
  }

  if (button.action === ACTIONS.redo) {
    if (!(await moveDraft(pool, draft.shortId, { from: OPEN, to: 'redo_wait' }))) return closed().then(() => true);
    await answerButton(config, query.id, '', fetchImpl);
    await tellAdmin(
      config,
      '🔁 Что поправить? Напишите одним сообщением. Или /skip — просто другой вариант.',
      fetchImpl
    );
    return true;
  }
  return false;
}

/** Пересборка: старое сообщение закрываем, чтобы не нажать его кнопки по ошибке. */
async function rebuild(config, pool, queue, draft, { to, fields, outcome, rewrite }, fetchImpl) {
  const moved = await moveDraft(pool, draft.shortId, { from: [draft.state], to, fields });
  if (!moved) return false;
  await closeDraftMessage(
    config,
    { messageId: draft.botMessageId, caption: draftCaption({ ...draft.script, topic: draft.topic }), outcome },
    fetchImpl
  );
  await addJob(queue, JOBS.agentRender, { shortId: draft.shortId, rewrite });
  return true;
}

async function onMessage(config, pool, queue, message, fetchImpl) {
  if (!isAdmin(config, message.from?.id)) return false;

  const voice = message.voice ?? message.audio;
  if (voice) {
    const draft = await draftWaitingFor(pool, 'voice_wait');
    if (!draft) return false;
    await rebuild(
      config,
      pool,
      queue,
      draft,
      {
        to: 'rendering',
        fields: { voice: 'author', authorFileId: voice.file_id },
        outcome: '🎙 Пересобираю с вашим голосом',
        rewrite: false
      },
      fetchImpl
    );
    await tellAdmin(config, '🎙 Голос получен, собираю ролик — пришлю через пару минут.', fetchImpl);
    return true;
  }

  const text = String(message.text ?? '').trim();
  if (!text || (text.startsWith('/') && text !== '/skip')) return false;
  const draft = await draftWaitingFor(pool, 'redo_wait');
  if (!draft) return false;
  await rebuild(
    config,
    pool,
    queue,
    draft,
    {
      to: 'rendering',
      // Переделанный сценарий читает синтезатор: прежнее голосовое автора к
      // новому тексту уже не подходит.
      fields: { instruction: text === '/skip' ? '' : text.slice(0, 1000), voice: 'synth', authorFileId: null },
      outcome: '🔁 Переделываю',
      rewrite: true
    },
    fetchImpl
  );
  await tellAdmin(config, '🔁 Принял, переделываю — пришлю новый вариант через пару минут.', fetchImpl);
  return true;
}

/**
 * Разбирает обновление бота. true — это было агенту, и отвечать «Здравствуйте,
 * этот бот присылает уроки» не нужно.
 */
export async function handleAgentUpdate(config, pool, queue, update, fetchImpl = fetch) {
  if (!queue) return false;
  if (update?.callback_query) return onButton(config, pool, queue, update.callback_query, fetchImpl);
  if (update?.message) return onMessage(config, pool, queue, update.message, fetchImpl);
  return false;
}
