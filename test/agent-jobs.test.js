// Шаги агента роликов: сбор, сборка, выкладка.
//
// Сборка — с настоящим ffmpeg (он есть в образе): весь смысл шага в том, что
// чужая программа собрала вертикальный ролик, и заглушка этого не проверит.
// Синтезатор и Telegram подменены: голос — тон из ffmpeg, отправка — запись.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  makeAgentCollect,
  makeAgentRender,
  makeAgentPublish,
  makePublishYoutubeShort,
  moscowHour,
  withSource
} from '../src/jobs/agent.js';
import { createDraft, getDraft, moveDraft } from '../src/services/shorts-agent.js';
import { addSource } from '../src/services/news-sources.js';
import { forgetAnnouncements } from '../src/services/announcements.js';
import { registerAsset } from '../src/services/media.js';
import { probeFrameSize } from '../src/lib/ffmpeg.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const hasFfmpeg = await new Promise((resolve) => {
  const child = spawn('ffmpeg', ['-version']);
  child.on('error', () => resolve(false));
  child.on('close', (code) => resolve(code === 0));
});
const needsFfmpeg = { skip: hasFfmpeg ? false : 'ffmpeg не установлен' };

const SCRIPT = {
  title: 'Модель открыта всем',
  description: 'Что умеет.',
  hashtags: ['ai', 'google'],
  headline: 'Модель для всех',
  sentences: ['Первое предложение ролика.', 'Второе, чуть длиннее первого.']
};

async function makeConfig() {
  return {
    publicBaseUrl: 'https://soloaijourney.online',
    adminIdentities: [{ provider: 'tg_widget', externalId: '4242' }],
    telegram: { botToken: 'T', apiUrl: 'https://tg.test' },
    media: { dir: await mkdtemp(path.join(tmpdir(), 'portal-agent-')), ttlHours: 168 }
  };
}

function fakeTelegram() {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const body = options.body instanceof FormData ? Object.fromEntries(options.body) : options.body ? JSON.parse(options.body) : null;
    calls.push({ method: String(url).split('/').pop(), body });
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 501 } }) };
  };
  return { calls, fetchImpl };
}

function fakeQueue() {
  const added = [];
  return { added, add: async (name, data) => added.push({ name, data }) };
}

/** Тон нужной длины в wav — вместо голоса синтезатора. */
function tone(seconds) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const child = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `sine=frequency=300:duration=${seconds}`,
      '-f', 'wav', 'pipe:1'
    ]);
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error('нет тона'))));
  });
}

const rss = (items) => `<rss><channel>${items
  .map(
    (item) =>
      `<item><title>${item.title}</title><link>${item.url}</link><description>${item.title} подробно</description><pubDate>${new Date().toUTCString()}</pubDate></item>`
  )
  .join('')}</channel></rss>`;

test('час по Москве — UTC плюс три', () => {
  assert.equal(moscowHour(Date.parse('2026-10-18T07:30:00Z')), 10);
  assert.equal(moscowHour(Date.parse('2026-10-18T22:00:00Z')), 1);
});

test('к описанию добавляется ссылка на источник', () => {
  assert.equal(withSource('Текст.', 'https://x'), 'Текст.\n\nИсточник: https://x');
});

test('сбор: темы → сценарии → черновики в сборку; норма не превышается', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    forgetAnnouncements();
    await addSource(pool, { title: 'Google', url: 'https://feed.test/rss' });
    const feed = rss([
      { title: 'Первая', url: 'https://n/1' },
      { title: 'Вторая', url: 'https://n/2' },
      { title: 'Третья', url: 'https://n/3' }
    ]);
    const { fetchImpl, calls } = fakeTelegram();
    const fetchAll = async (url, options) =>
      String(url).startsWith('https://feed.test')
        ? { ok: true, status: 200, text: async () => feed }
        : fetchImpl(url, options);
    const texts = {
      pickShortTopics: async (items, count) => ({ picks: items.slice(0, count).map((item) => ({ item })) }),
      writeShortScript: async (topic) => ({ ...SCRIPT, title: `Про ${topic.title}` })
    };
    const queue = fakeQueue();
    const collect = makeAgentCollect(config, pool, queue, texts, { fetchImpl: fetchAll });

    const result = await collect({});
    assert.equal(result.drafts, 2, 'норма по умолчанию — два ролика');
    assert.deepEqual(queue.added.map((job) => job.name), ['agentRender', 'agentRender']);

    // Тот же день, по расписанию — норма уже собрана.
    forgetAnnouncements();
    assert.equal((await collect({})).skipped, 'норма на сегодня собрана');
    assert.equal(calls.length, 0, 'автора лишний раз не беспокоим');
  });
});

test('сбор по расписанию — только в свой час', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const collect = makeAgentCollect(config, pool, fakeQueue(), {}, {
      now: () => Date.parse('2026-10-18T03:00:00Z')
    });
    assert.equal((await collect({ scheduled: true })).skipped, 'не тот час');
  });
});

test('сборка: вертикальный ролик уходит автору с кнопками', { ...needsFfmpeg, ...skipWithoutDb }, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const draft = await createDraft(pool, {
      topic: { url: 'https://n/1', title: 'Новость', source: 'X', summary: '' },
      script: SCRIPT
    });
    const voices = [];
    const tts = { synthesize: async (text, voice) => (voices.push(voice), tone(1.2)) };
    const { calls, fetchImpl } = fakeTelegram();

    await makeAgentRender(config, pool, { tts, fetchImpl })({ shortId: draft.shortId });

    const after = await getDraft(pool, draft.shortId);
    assert.equal(after.state, 'awaiting');
    assert.equal(after.botMessageId, 501);
    assert.deepEqual(voices, ['ruslan', 'ruslan'], 'голос из настроек, по предложению за раз');

    const frame = await probeFrameSize(path.join(config.media.dir, `short-${draft.shortId}/vertical.mp4`));
    assert.deepEqual(frame, { width: 1080, height: 1920 });

    const sent = calls.find((call) => call.method === 'sendVideo');
    assert.equal(sent.body.chat_id, '4242');
    assert.match(sent.body.reply_markup, /agent:publish:/);

    const { rows } = await pool.query(
      'SELECT description, jsonb_array_length(segments) AS n, asset_id, cover_url FROM shorts WHERE id = $1',
      [draft.shortId]
    );
    assert.match(rows[0].description, /Источник: https:\/\/n\/1/);
    assert.ok(rows[0].n >= 2);
    assert.ok(rows[0].asset_id && rows[0].cover_url);
  });
});

test('сборка упала — черновик failed, автор узнаёт', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const draft = await createDraft(pool, {
      topic: { url: 'https://n/1', title: 'Новость', source: 'X', summary: '' },
      script: SCRIPT
    });
    const tts = { synthesize: async () => { throw new Error('синтезатор молчит'); } };
    const { calls, fetchImpl } = fakeTelegram();
    await assert.rejects(makeAgentRender(config, pool, { tts, fetchImpl })({ shortId: draft.shortId }));
    const after = await getDraft(pool, draft.shortId);
    assert.equal(after.state, 'failed');
    assert.match(calls.at(-1).body.text, /синтезатор молчит/);
  });
});

test('выкладка: подключённые площадки — в очередь, о неподключённых сказано', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const draft = await createDraft(pool, {
      topic: { url: 'https://n/1', title: 'Новость', source: 'X', summary: '' },
      script: SCRIPT
    });
    const asset = await registerAsset(pool, config, {
      shortId: draft.shortId,
      kind: 'vertical',
      relativePath: `short-${draft.shortId}/vertical.mp4`,
      bytes: 10
    });
    await pool.query('UPDATE shorts SET asset_id = $1 WHERE id = $2', [asset.id, draft.shortId]);
    await moveDraft(pool, draft.shortId, { from: ['rendering'], to: 'published' });

    const queue = fakeQueue();
    const { calls, fetchImpl } = fakeTelegram();
    const platforms = [
      { name: 'telegram', title: 'Telegram', job: 'publishTelegram', ready: async () => true, mode: async () => 'auto' },
      { name: 'youtube', title: 'YouTube Shorts', job: 'publishYoutubeShort', ready: async () => false, mode: async () => 'semi' }
    ];
    const result = await makeAgentPublish(config, pool, queue, platforms, { fetchImpl })({ shortId: draft.shortId });
    assert.deepEqual(result, { queued: ['Telegram'], skipped: ['YouTube Shorts'] });
    assert.equal(queue.added[0].name, 'publishTelegram');

    const { rows } = await pool.query('SELECT status FROM shorts WHERE id = $1', [draft.shortId]);
    assert.equal(rows[0].status, 'published');
    assert.ok(calls.some((call) => /Не подключены: YouTube Shorts/.test(call.body?.text ?? '')));
  });
});

test('выкладка невыбранного черновика не идёт', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const draft = await createDraft(pool, {
      topic: { url: 'https://n/1', title: 'Новость', source: 'X', summary: '' },
      script: SCRIPT
    });
    const queue = fakeQueue();
    const result = await makeAgentPublish(config, pool, queue, [])({ shortId: draft.shortId });
    assert.equal(result.skipped, 'черновик не подтверждён');
    assert.deepEqual(queue.added, []);
  });
});

test('YouTube Shorts: метка #Shorts, приватно до проверки Google', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const draft = await createDraft(pool, {
      topic: { url: 'https://n/1', title: 'Новость', source: 'X', summary: '' },
      script: SCRIPT
    });
    const asset = await registerAsset(pool, config, {
      shortId: draft.shortId,
      kind: 'vertical',
      relativePath: `short-${draft.shortId}/vertical.mp4`,
      bytes: 10
    });
    await pool.query('UPDATE shorts SET asset_id = $1 WHERE id = $2', [asset.id, draft.shortId]);
    const { rows } = await pool.query(
      `INSERT INTO publications (short_id, platform, state, mode) VALUES ($1, 'youtube', 'queued', 'semi') RETURNING id`,
      [draft.shortId]
    );
    let body = null;
    const platform = {
      accessToken: async () => 'tok',
      startUploadSession: async (args) => ((body = args.body), 'https://upload'),
      uploadVideoFile: async () => ({ videoId: 'abc' })
    };
    await makePublishYoutubeShort(config, pool, platform)({ shortId: draft.shortId, publicationId: Number(rows[0].id) });
    assert.match(body.snippet.title, /#Shorts$/);
    assert.equal(body.status.privacyStatus, 'private');
    const { rows: after } = await pool.query('SELECT state, url FROM publications WHERE id = $1', [rows[0].id]);
    assert.deepEqual(after[0], { state: 'ready', url: 'https://youtube.com/shorts/abc' });
  });
});
