// Агент роликов в боте: кнопки под черновиком и ответы автора.
//
// Бот публичный — писать ему может кто угодно. Поэтому главное здесь: чужое
// нажатие ничего не меняет, а старая кнопка не выкладывает закрытый черновик.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseButton,
  buttonData,
  draftCaption,
  isAdmin,
  adminChatId
} from '../src/services/agent-bot.js';
import { handleAgentUpdate } from '../src/services/agent-replies.js';
import { createDraft, moveDraft, getDraft } from '../src/services/shorts-agent.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const ADMIN = 4242;
const config = {
  publicBaseUrl: 'https://soloaijourney.online',
  adminIdentities: [{ provider: 'google', externalId: 'g1' }, { provider: 'tg_widget', externalId: String(ADMIN) }],
  telegram: { botToken: 'T', apiUrl: 'https://tg.test' }
};
const SCRIPT = {
  title: 'Заголовок',
  description: 'Описание.',
  hashtags: ['ai'],
  headline: 'Крупно',
  sentences: ['Раз.', 'Два.']
};

/** Подмена Telegram: запоминает вызовы, отвечает «ок». */
function fakeTelegram() {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ method: url.split('/').pop(), body: options?.body ? JSON.parse(options.body) : null });
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) };
  };
  return { calls, fetchImpl };
}

function fakeQueue() {
  const added = [];
  return { added, add: async (name, data) => added.push({ name, data }) };
}

async function seedDraft(pool, state = 'awaiting') {
  const draft = await createDraft(pool, {
    topic: { url: 'https://news/1', title: 'Новость', source: 'X', summary: '' },
    script: SCRIPT
  });
  await moveDraft(pool, draft.shortId, { from: ['rendering'], to: state, fields: { botMessageId: 77 } });
  return draft.shortId;
}

const press = (action, shortId, from = ADMIN) => ({
  callback_query: { id: 'q1', from: { id: from }, data: buttonData(action, shortId) }
});

test('кнопка разбирается, чужие данные — нет', () => {
  assert.deepEqual(parseButton('agent:publish:12'), { action: 'publish', shortId: 12 });
  assert.equal(parseButton('agent:delete:12'), null);
  assert.equal(parseButton('other:publish:12'), null);
});

test('автор — по Telegram-номеру из ADMIN_IDENTITIES', () => {
  assert.equal(adminChatId(config), String(ADMIN));
  assert.equal(isAdmin(config, ADMIN), true);
  assert.equal(isAdmin(config, 1), false);
  assert.equal(isAdmin({ adminIdentities: [] }, ADMIN), false);
});

test('подпись черновика: хэштеги и ссылка на источник', () => {
  const caption = draftCaption({ ...SCRIPT, topic: { url: 'https://news/1' } });
  assert.match(caption, /#ai/);
  assert.match(caption, /Источник: https:\/\/news\/1/);
});

test('«Выложить» от автора ставит выкладку', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const shortId = await seedDraft(pool);
    const queue = fakeQueue();
    const { fetchImpl } = fakeTelegram();
    assert.equal(await handleAgentUpdate(config, pool, queue, press('publish', shortId), fetchImpl), true);
    assert.equal((await getDraft(pool, shortId)).state, 'published');
    assert.deepEqual(queue.added, [{ name: 'agentPublish', data: { shortId } }]);
  });
});

test('чужое нажатие ничего не меняет', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const shortId = await seedDraft(pool);
    const queue = fakeQueue();
    const { calls, fetchImpl } = fakeTelegram();
    await handleAgentUpdate(config, pool, queue, press('publish', shortId, 999), fetchImpl);
    assert.equal((await getDraft(pool, shortId)).state, 'awaiting');
    assert.deepEqual(queue.added, []);
    assert.match(calls[0].body.text, /только для автора/);
  });
});

test('выброшенный черновик старой кнопкой не выложить', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const shortId = await seedDraft(pool);
    const queue = fakeQueue();
    const { calls, fetchImpl } = fakeTelegram();
    await handleAgentUpdate(config, pool, queue, press('reject', shortId), fetchImpl);
    assert.ok(calls.some((call) => call.method === 'editMessageCaption'), 'кнопки снимаются');
    await handleAgentUpdate(config, pool, queue, press('publish', shortId), fetchImpl);
    assert.equal((await getDraft(pool, shortId)).state, 'rejected');
    assert.deepEqual(queue.added, []);
  });
});

test('«Надиктую сам» → голосовое автора пересобирает ролик его голосом', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const shortId = await seedDraft(pool);
    const queue = fakeQueue();
    const { calls, fetchImpl } = fakeTelegram();
    await handleAgentUpdate(config, pool, queue, press('voice', shortId), fetchImpl);
    assert.equal((await getDraft(pool, shortId)).state, 'voice_wait');
    assert.ok(calls.some((call) => /Раз\. Два\./.test(call.body?.text ?? '')), 'текст для чтения прислан');

    const voice = { message: { from: { id: ADMIN }, chat: { id: ADMIN }, voice: { file_id: 'F1' } } };
    assert.equal(await handleAgentUpdate(config, pool, queue, voice, fetchImpl), true);
    const draft = await getDraft(pool, shortId);
    assert.equal(draft.state, 'rendering');
    assert.equal(draft.voice, 'author');
    assert.equal(draft.authorFileId, 'F1');
    assert.deepEqual(queue.added.at(-1), { name: 'agentRender', data: { shortId, rewrite: false } });
  });
});

test('«Переделать» → поправка автора уходит в новый сценарий', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const shortId = await seedDraft(pool);
    const queue = fakeQueue();
    const { fetchImpl } = fakeTelegram();
    await handleAgentUpdate(config, pool, queue, press('redo', shortId), fetchImpl);
    const reply = { message: { from: { id: ADMIN }, chat: { id: ADMIN }, text: 'короче и смешнее' } };
    await handleAgentUpdate(config, pool, queue, reply, fetchImpl);
    const draft = await getDraft(pool, shortId);
    assert.equal(draft.state, 'rendering');
    assert.equal(draft.instruction, 'короче и смешнее');
    assert.deepEqual(queue.added.at(-1), { name: 'agentRender', data: { shortId, rewrite: true } });
  });
});

test('сообщения не автора и без ожидающего черновика — не агенту', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const queue = fakeQueue();
    const { fetchImpl } = fakeTelegram();
    const stranger = { message: { from: { id: 1 }, chat: { id: 1 }, text: '/start l3' } };
    assert.equal(await handleAgentUpdate(config, pool, queue, stranger, fetchImpl), false);
    const author = { message: { from: { id: ADMIN }, chat: { id: ADMIN }, text: 'привет' } };
    assert.equal(await handleAgentUpdate(config, pool, queue, author, fetchImpl), false);
  });
});
