// Проверка API витрины поверх HTTP: что видит гость, что может вошедший,
// что доступно только автору.
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
  google: { clientId: '', clientSecret: '' }
};

/** Заголовки запроса от имени пользователя с заданной ролью. */
function as(userId, role = 'user') {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${signSession({ userId, role }, config.jwtSecret)}`
  };
}

async function seed(pool) {
  await saveLesson(pool, {
    slug: 'docker-1',
    title: 'Docker',
    status: 'published',
    publishedAt: new Date()
  });
  await saveLesson(pool, { slug: 'chernovik', title: 'Не готов' });
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Пётр', 'user'), ('Автор', 'admin') RETURNING id`
  );
  const { rows: lesson } = await pool.query(`SELECT id FROM lessons WHERE slug = 'docker-1'`);
  return { petr: Number(rows[0].id), admin: Number(rows[1].id), lessonId: Number(lesson[0].id) };
}

test('гость видит опубликованное и не видит черновик', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const list = await (await fetch(`${base}/api/lessons`)).json();
      assert.deepEqual(
        list.lessons.map((l) => l.slug),
        ['docker-1']
      );
      const res = await fetch(`${base}/api/lessons/chernovik`, {
        headers: { Accept: 'application/json' }
      });
      assert.equal(res.status, 404);
    });
  });
});

test('админ видит черновики, обычный пользователь их не выпрашивает', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr, admin } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const свои = await (
        await fetch(`${base}/api/lessons?drafts=1`, { headers: as(admin, 'admin') })
      ).json();
      assert.equal(свои.lessons.length, 2);
      const чужие = await (
        await fetch(`${base}/api/lessons?drafts=1`, { headers: as(petr) })
      ).json();
      assert.equal(чужие.lessons.length, 1);
    });
  });
});

test('гость не может поставить реакцию', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessonId } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ objectType: 'lesson', objectId: lessonId, kind: '8' })
      });
      assert.equal(res.status, 401);
    });
  });
});

test('вошедший ставит оценку, голос считается один', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr, lessonId } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      for (let i = 0; i < 3; i += 1) {
        await fetch(`${base}/api/reactions`, {
          method: 'POST',
          headers: as(petr),
          body: JSON.stringify({ objectType: 'lesson', objectId: lessonId, kind: '8' })
        });
      }
      const lesson = await (await fetch(`${base}/api/lessons/docker-1`)).json();
      assert.deepEqual(lesson.lesson.reactions, { 8: 1 });
      assert.deepEqual(lesson.lesson.rating, { total: 1, average: 8 });
    });
  });
});

test('гость не видит неодобренный комментарий, после одобрения видит', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr, admin, lessonId } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const created = await (
        await fetch(`${base}/api/comments`, {
          method: 'POST',
          headers: as(petr),
          body: JSON.stringify({ objectType: 'lesson', objectId: lessonId, body: 'Спасибо!' })
        })
      ).json();

      const до = await (
        await fetch(`${base}/api/comments?objectType=lesson&objectId=${lessonId}`)
      ).json();
      assert.equal(до.comments.length, 0);

      const решение = await fetch(`${base}/api/comments/${created.comment.id}/moderate`, {
        method: 'POST',
        headers: as(admin, 'admin'),
        body: JSON.stringify({ status: 'approved' })
      });
      assert.equal(решение.status, 200);

      const после = await (
        await fetch(`${base}/api/comments?objectType=lesson&objectId=${lessonId}`)
      ).json();
      assert.equal(после.comments.length, 1);
    });
  });
});

test('модерация закрыта для обычного пользователя', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr, lessonId } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const created = await (
        await fetch(`${base}/api/comments`, {
          method: 'POST',
          headers: as(petr),
          body: JSON.stringify({ objectType: 'lesson', objectId: lessonId, body: 'Спасибо!' })
        })
      ).json();
      const res = await fetch(`${base}/api/comments/${created.comment.id}/moderate`, {
        method: 'POST',
        headers: as(petr),
        body: JSON.stringify({ status: 'approved' })
      });
      assert.equal(res.status, 403);
    });
  });
});

test('правка урока доступна только автору портала', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { petr, admin } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const чужой = await fetch(`${base}/api/lessons/docker-1`, {
        method: 'PUT',
        headers: as(petr),
        body: JSON.stringify({ title: 'Взлом' })
      });
      assert.equal(чужой.status, 403);

      const свой = await fetch(`${base}/api/lessons/novyj`, {
        method: 'PUT',
        headers: as(admin, 'admin'),
        body: JSON.stringify({ title: 'Новый урок', tags: ['docker', 'vps'] })
      });
      assert.equal(свой.status, 200);
      assert.deepEqual((await свой.json()).lesson.tags, ['docker', 'vps']);
    });
  });
});
