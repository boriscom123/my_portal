// Проверка второго и третьего поводов уведомить из спеки: ответили на отзыв —
// узнал автор отзыва; пришёл отзыв — узнал автор портала. Это тот сценарий,
// который заказчик описал словами «заполнил форму обратной связи, при ответе
// на его запрос пришло уведомление».
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { saveLesson } from '../src/services/lessons.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://soloaijourney.online',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: '', channelId: '', botUsername: '' },
  google: { clientId: '', clientSecret: '' },
  vapid: { publicKey: '', privateKey: '', subject: 'mailto:a@b' }
};

function as(userId, role = 'user') {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${signSession({ userId, role }, config.jwtSecret)}`
  };
}

/** Трое, урок и подписки на пуш у всех: канал должен найтись у каждого. */
async function seed(pool) {
  const lesson = await saveLesson(pool, {
    slug: 'docker-1',
    title: 'Docker',
    status: 'published',
    publishedAt: new Date()
  });
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role)
     VALUES ('Пётр', 'user'), ('Анна', 'user'), ('Автор', 'admin') RETURNING id`
  );
  const people = rows.map((r) => Number(r.id));
  for (const [i, id] of people.entries()) {
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, 'k', 's')`,
      [id, `https://push.example/${i}`]
    );
  }
  return { lessonId: lesson.id, petr: people[0], anna: people[1], admin: people[2] };
}

function makeApp(pool, sent) {
  const app = createApp({ config, pool });
  app.locals.channels = {
    webpush: async (subscriptions, m) => sent.push({ url: subscriptions[0].endpoint, m })
  };
  return finalize(app);
}

async function commentItem(base, headers, fields) {
  const res = await fetch(`${base}/api/comments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ objectType: 'lesson', ...fields })
  });
  return (await res.json()).comment;
}

test('автор отзыва узнаёт об ответе на него', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, petr, admin } = await seed(pool);
    const sent = [];
    await withServer(makeApp(pool, sent), async (base) => {
      const first = await commentItem(base, as(petr), { objectId: lessonId, body: 'Вопрос' });
      sent.length = 0; // Уведомление о самом отзыве проверяется отдельно.

      await commentItem(base, as(admin, 'admin'), {
        objectId: lessonId,
        parentId: first.id,
        body: 'Ответ'
      });

      const recipients = sent.map((entry) => entry.url);
      assert.ok(recipients.includes('https://push.example/0'), 'Пётр должен узнать об ответе');
      assert.ok(!recipients.includes('https://push.example/1'), 'Анна тут ни при чём');
    });
  });
});

test('ответ самому себе не будит автора', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, petr } = await seed(pool);
    const sent = [];
    await withServer(makeApp(pool, sent), async (base) => {
      const first = await commentItem(base, as(petr), { objectId: lessonId, body: 'Вопрос' });
      sent.length = 0;
      await commentItem(base, as(petr), { objectId: lessonId, parentId: first.id, body: 'Сам себе' });
      assert.ok(!sent.some((entry) => entry.url === 'https://push.example/0'));
    });
  });
});

test('новый отзыв уведомляет автора портала о модерации', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, petr } = await seed(pool);
    const sent = [];
    await withServer(makeApp(pool, sent), async (base) => {
      await commentItem(base, as(petr), { objectId: lessonId, body: 'Вопрос' });
    });
    const toAdmin = sent.find((entry) => entry.url === 'https://push.example/2');
    assert.ok(toAdmin, 'админ должен узнать о новом отзыве');
    assert.match(toAdmin.m.title, /модерац/i);
    assert.match(toAdmin.m.url, /^\/lesson\/docker-1$/);
  });
});

test('свой отзыв не зовёт автора портала модерировать самого себя', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, admin } = await seed(pool);
    const sent = [];
    await withServer(makeApp(pool, sent), async (base) => {
      await commentItem(base, as(admin, 'admin'), { objectId: lessonId, body: 'Заметка' });
    });
    assert.equal(sent.length, 0);
  });
});
