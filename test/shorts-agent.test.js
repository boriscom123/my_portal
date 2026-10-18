// Агент роликов: темы, сценарии, черновики.
//
// Самое дорогое, что агент может сделать неправильно, — ролик об одной
// новости дважды, выложенный выброшенный черновик и сценарий с выдумкой.
// Первые два проверяем здесь; третье держит запрос (см. agent-prompts.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freshCandidates,
  createDraft,
  moveDraft,
  getDraft,
  draftWaitingFor,
  loadAgentSettings,
  saveAgentSettings,
  takenTopicUrls
} from '../src/services/shorts-agent.js';
import {
  parsePickResponse,
  parseScriptResponse,
  buildScriptPrompt
} from '../src/services/agent-prompts.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const NOW = Date.parse('2026-10-18T10:00:00Z');
const hoursAgo = (hours) => new Date(NOW - hours * 3600 * 1000);
const answer = (value) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] });

const SCRIPT = {
  title: 'Новая модель Google бесплатна',
  description: 'Что умеет и как попробовать.',
  hashtags: ['ai', 'google'],
  headline: 'Google открыла модель',
  sentences: ['Первое.', 'Второе.']
};
const topic = (url) => ({ url, title: 'Новость', source: 'Google', summary: 'Текст' });

test('кандидаты: свежие, не взятые, без повторов и с датой', () => {
  const items = [
    { url: 'a', title: 'A', publishedAt: hoursAgo(5) },
    { url: 'b', title: 'B', publishedAt: hoursAgo(100) },
    { url: 'c', title: 'C', publishedAt: hoursAgo(1) },
    { url: 'a', title: 'A снова', publishedAt: hoursAgo(2) },
    { url: 'd', title: 'D', publishedAt: null }
  ];
  assert.deepEqual(
    freshCandidates(items, ['c'], { now: NOW }).map((item) => item.url),
    ['a']
  );
});

test('выбор тем: номера вне списка и повторы отбрасываются', () => {
  const items = [{ title: 'x' }, { title: 'y' }, { title: 'z' }];
  const picks = parsePickResponse(
    answer({
      picks: [
        { number: 2, reason: 'интересно' },
        { number: 2, reason: 'повтор' },
        { number: 9, reason: 'нет такой' },
        { number: 1, reason: 'тоже' },
        { number: 3, reason: 'лишняя' }
      ]
    }),
    items,
    2
  );
  assert.deepEqual(
    picks.map((pick) => pick.item.title),
    ['y', 'x']
  );
});

test('сценарий: хэштеги чистятся, точка в конце заголовка убирается', () => {
  const words = Array.from({ length: 80 }, (_, index) => `слово${index}`).join(' ');
  const script = parseScriptResponse(
    answer({ ...SCRIPT, title: 'Заголовок.', hashtags: ['#AI', 'ai', 'Open AI'], sentences: [words] })
  );
  assert.equal(script.title, 'Заголовок');
  assert.deepEqual(script.hashtags, ['ai', 'openai']);
});

test('слишком короткий сценарий — ошибка, а не ролик на десять секунд', () => {
  assert.throws(() => parseScriptResponse(answer({ ...SCRIPT, sentences: ['Коротко.'] })), /короткий/);
});

test('битый ответ модели — понятная ошибка', () => {
  assert.throws(
    () => parseScriptResponse({ candidates: [{ content: { parts: [{ text: 'не json' }] } }] }),
    /не JSON/
  );
});

test('поправка автора попадает в запрос сценария', () => {
  const prompt = buildScriptPrompt(topic('u'), { instruction: 'короче и без цифр', previous: SCRIPT });
  assert.match(prompt, /короче и без цифр/);
  assert.match(prompt, /Первое\. Второе\./);
});

test('одна новость — один черновик, даже при двух сборах подряд', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const first = await createDraft(pool, { topic: topic('https://x/1'), script: SCRIPT });
    const second = await createDraft(pool, { topic: topic('https://x/1'), script: SCRIPT });
    assert.equal(first.state, 'rendering');
    assert.equal(second, null);
    assert.deepEqual(await takenTopicUrls(pool, ['https://x/1', 'https://x/2']), ['https://x/1']);

    const { rows } = await pool.query('SELECT origin, title FROM shorts WHERE id = $1', [first.shortId]);
    assert.deepEqual(rows[0], { origin: 'agent', title: SCRIPT.title });
  });
});

test('выброшенный черновик старой кнопкой не выложить', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const draft = await createDraft(pool, { topic: topic('https://x/1'), script: SCRIPT });
    assert.equal(await moveDraft(pool, draft.shortId, { from: ['rendering'], to: 'awaiting' }), true);
    assert.equal(await moveDraft(pool, draft.shortId, { from: ['awaiting'], to: 'rejected' }), true);
    assert.equal(await moveDraft(pool, draft.shortId, { from: ['awaiting'], to: 'published' }), false);
    assert.equal((await getDraft(pool, draft.shortId)).state, 'rejected');
  });
});

test('ответ автора идёт к последнему черновику, который его ждёт', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const first = await createDraft(pool, { topic: topic('https://x/1'), script: SCRIPT });
    const second = await createDraft(pool, { topic: topic('https://x/2'), script: { ...SCRIPT, title: 'Другой' } });
    await moveDraft(pool, first.shortId, { from: ['rendering'], to: 'voice_wait' });
    await moveDraft(pool, second.shortId, {
      from: ['rendering'],
      to: 'voice_wait',
      fields: { instruction: 'x' }
    });
    assert.equal((await draftWaitingFor(pool, 'voice_wait')).shortId, second.shortId);
    assert.equal(await draftWaitingFor(pool, 'redo_wait'), null);
  });
});

test('настройки агента проверяются', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    assert.deepEqual(await loadAgentSettings(pool), {
      enabled: true,
      perDay: 2,
      runHour: 10,
      // Выбран автором по образцам 2026-10-18.
      voice: 'ruslan'
    });
    await assert.rejects(saveAgentSettings(pool, { enabled: true, perDay: 0, runHour: 10, voice: 'denis' }), /от 1 до 10/);
    await assert.rejects(saveAgentSettings(pool, { enabled: true, perDay: 2, runHour: 10, voice: 'alice' }), /голоса/);
    const saved = await saveAgentSettings(pool, { enabled: false, perDay: '3', runHour: '8', voice: 'irina' });
    assert.deepEqual(saved, { enabled: false, perDay: 3, runHour: 8, voice: 'irina' });
  });
});
