// Приёмник обновлений бота: зритель нажимает «Start» — получает видео урока.
//
// Заказчик 2026-09-16: ссылка t.me/бот?start=l36 из анонса ведёт в бота, а тот
// сразу отдаёт полную запись. Файл уже загружен автором, поэтому отправка идёт
// по номеру — мгновенно и без траты трафика.
//
// Адрес приёмника со скрытой частью: это единственный вход портала, у которого
// нет сессии, и знать его должен только Telegram.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { saveLesson } from '../src/services/lessons.js';
import { registerAsset } from '../src/services/media.js';
import { rememberTelegramFile } from '../src/services/telegram-files.js';
import { webhookPath } from '../src/routes/telegram-bot.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://portal.example',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: '12345:secret-token', botId: '12345', botUsername: 'portal_bot', apiUrl: '' },
  google: { clientId: '', clientSecret: '' },
  vapid: { publicKey: '', privateKey: '', subject: '' },
  redis: { url: 'redis://redis:6379', prefix: 'portal:' },
  yandex: { apiKey: '', folderId: '' },
  yandexOauth: { clientId: '', clientSecret: '' },
  tokenEncryptionKey: 'a'.repeat(64),
  media: { dir: '/tmp', ttlHours: 168 },
  youtube: { clientId: '', clientSecret: '', redirectUri: '/back', mode: 'semi' }
};

const update = (text, chatId = 555) => ({
  update_id: 1,
  message: { message_id: 2, chat: { id: chatId, type: 'private' }, text }
});

async function seed(pool, { fileId = 'BAACAgIAAxkBAAI' } = {}) {
  const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок про портал' });
  const asset = await registerAsset(pool, config, {
    lessonId: lesson.id,
    kind: 'source',
    relativePath: `lesson-${lesson.id}/source.mp4`,
    bytes: 250 * 1024 * 1024
  });
  if (fileId) await rememberTelegramFile(pool, asset.id, fileId);
  return { lesson, asset };
}

test('«Start» с номером урока отдаёт видео по номеру файла', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson } = await seed(pool);
    const sent = [];
    const app = finalize(
      createApp({
        config,
        pool,
        fetchImpl: async (url, options) => {
          sent.push({ url: String(url), body: JSON.parse(options.body) });
          return { ok: true, json: async () => ({ ok: true, result: { message_id: 3 } }) };
        }
      })
    );

    await withServer(app, async (base) => {
      const response = await fetch(`${base}${webhookPath(config)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update(`/start l${lesson.id}`))
      });
      // Telegram повторяет обновление, пока не получит 200: отвечаем всегда.
      assert.equal(response.status, 200);
    });

    const video = sent.find((call) => call.url.includes('sendVideo'));
    assert.ok(video, 'видео не отправлено');
    assert.equal(video.body.chat_id, 555);
    assert.equal(video.body.video, 'BAACAgIAAxkBAAI', 'видео ушло не по номеру файла');
    assert.match(video.body.caption, /Урок про портал/);
  });
});

test('чужой адрес приёмника не работает', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await seed(pool);
    const app = finalize(createApp({ config, pool, fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }));
    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/telegram/hook/chuzhoy-adres`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update('/start l1'))
      });
      assert.equal(response.status, 404);
    });
  });
});

test('видео ещё не загружено — человеку отвечают словами, а не молчанием', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson } = await seed(pool, { fileId: null });
    const sent = [];
    const app = finalize(
      createApp({
        config,
        pool,
        fetchImpl: async (url, options) => {
          sent.push({ url: String(url), body: JSON.parse(options.body) });
          return { ok: true, json: async () => ({ ok: true, result: { message_id: 3 } }) };
        }
      })
    );

    await withServer(app, async (base) => {
      await fetch(`${base}${webhookPath(config)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update(`/start l${lesson.id}`))
      });
    });

    assert.ok(!sent.some((call) => call.url.includes('sendVideo')), 'видео взяться неоткуда');
    const message = sent.find((call) => call.url.includes('sendMessage'));
    assert.ok(message, 'человеку ничего не ответили');
    assert.match(message.body.text, /портал/i);
  });
});

test('просто «Start» — здороваемся и рассказываем, зачем бот', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await seed(pool);
    const sent = [];
    const app = finalize(
      createApp({
        config,
        pool,
        fetchImpl: async (url, options) => {
          sent.push({ url: String(url), body: JSON.parse(options.body) });
          return { ok: true, json: async () => ({ ok: true, result: { message_id: 3 } }) };
        }
      })
    );

    await withServer(app, async (base) => {
      await fetch(`${base}${webhookPath(config)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update('/start'))
      });
    });

    const message = sent.find((call) => call.url.includes('sendMessage'));
    assert.ok(message, 'бот промолчал');
    assert.match(message.body.text, /урок/i);
  });
});
