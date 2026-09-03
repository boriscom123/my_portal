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
  const люди = rows.map((r) => Number(r.id));
  for (const [i, id] of люди.entries()) {
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, 'k', 's')`,
      [id, `https://push.example/${i}`]
    );
  }
  return { lessonId: lesson.id, petr: люди[0], anna: люди[1], admin: люди[2] };
}

function приложение(pool, отправлено) {
  const app = createApp({ config, pool });
  app.locals.channels = {
    webpush: async (подписки, m) => отправлено.push({ адрес: подписки[0].endpoint, m })
  };
  return finalize(app);
}

async function отзыв(base, headers, поля) {
  const res = await fetch(`${base}/api/comments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ objectType: 'lesson', ...поля })
  });
  return (await res.json()).comment;
}

test('автор отзыва узнаёт об ответе на него', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, petr, admin } = await seed(pool);
    const отправлено = [];
    await withServer(приложение(pool, отправлено), async (base) => {
      const первый = await отзыв(base, as(petr), { objectId: lessonId, body: 'Вопрос' });
      отправлено.length = 0; // Уведомление о самом отзыве проверяется отдельно.

      await отзыв(base, as(admin, 'admin'), {
        objectId: lessonId,
        parentId: первый.id,
        body: 'Ответ'
      });

      const адресаты = отправлено.map((о) => о.адрес);
      assert.ok(адресаты.includes('https://push.example/0'), 'Пётр должен узнать об ответе');
      assert.ok(!адресаты.includes('https://push.example/1'), 'Анна тут ни при чём');
    });
  });
});

test('ответ самому себе не будит автора', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, petr } = await seed(pool);
    const отправлено = [];
    await withServer(приложение(pool, отправлено), async (base) => {
      const первый = await отзыв(base, as(petr), { objectId: lessonId, body: 'Вопрос' });
      отправлено.length = 0;
      await отзыв(base, as(petr), { objectId: lessonId, parentId: первый.id, body: 'Сам себе' });
      assert.ok(!отправлено.some((о) => о.адрес === 'https://push.example/0'));
    });
  });
});

test('новый отзыв уведомляет автора портала о модерации', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, petr } = await seed(pool);
    const отправлено = [];
    await withServer(приложение(pool, отправлено), async (base) => {
      await отзыв(base, as(petr), { objectId: lessonId, body: 'Вопрос' });
    });
    const админу = отправлено.find((о) => о.адрес === 'https://push.example/2');
    assert.ok(админу, 'админ должен узнать о новом отзыве');
    assert.match(админу.m.title, /модерац/i);
    assert.match(админу.m.url, /^\/lesson\/docker-1$/);
  });
});

test('свой отзыв не зовёт автора портала модерировать самого себя', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId, admin } = await seed(pool);
    const отправлено = [];
    await withServer(приложение(pool, отправлено), async (base) => {
      await отзыв(base, as(admin, 'admin'), { objectId: lessonId, body: 'Заметка' });
    });
    assert.equal(отправлено.length, 0);
  });
});
