// Серии уроков и похожие уроки.
//
// Главное здесь — порядок: он задан автором, и любая его потеря превращает
// курс в россыпь роликов, по которой зритель идёт наугад.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { saveLesson, setLessonTags, getLessonBySlug } from '../src/services/lessons.js';
import {
  saveSeries,
  deleteSeries,
  listSeries,
  getSeriesBySlug,
  setLessonSeries,
  moveLessonInSeries,
  seriesNavigation,
  relatedLessons
} from '../src/services/series.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://portal.example',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: '', botId: '', botUsername: '' },
  google: { clientId: '', clientSecret: '' },
  vapid: { publicKey: '', privateKey: '', subject: '' },
  redis: { url: 'redis://redis:6379', prefix: 'portal:' },
  yandex: { apiKey: '', folderId: '' },
  yandexOauth: { clientId: '', clientSecret: '' },
  tokenEncryptionKey: 'a'.repeat(64),
  media: { dir: '/tmp', ttlHours: 168 },
  youtube: { clientId: '', clientSecret: '', redirectUri: '/back', mode: 'semi' }
};

async function admin(pool) {
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
  );
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'admin' }, config.jwtSecret)}`
  };
}

/** Вышедший урок: связи показываются только между такими. */
async function publishedLesson(pool, slug, title, day = 1) {
  return saveLesson(pool, {
    slug,
    title,
    description: `Описание урока ${title}`,
    status: 'published',
    publishedAt: new Date(`2026-09-0${day}T10:00:00Z`)
  });
}

/** Серия из трёх вышедших уроков по порядку. */
async function threeInSeries(pool) {
  const series = await saveSeries(pool, { title: 'Портал с нуля' });
  const lessons = [];
  for (const [index, slug] of ['pervyy', 'vtoroy', 'tretiy'].entries()) {
    const lesson = await publishedLesson(pool, slug, `Урок ${index + 1}`, index + 1);
    await setLessonSeries(pool, lesson.id, series.id);
    lessons.push(lesson);
  }
  return { series, lessons };
}

test('серия получает адрес из названия', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const series = await saveSeries(pool, { title: 'Портал с нуля' });
    assert.equal(series.slug, 'portal-s-nulya');
  });
});

test('две серии с одним названием не делят один адрес', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    // Адрес ведёт в одно место — иначе вторая серия открывала бы первую.
    const first = await saveSeries(pool, { title: 'Портал с нуля' });
    const second = await saveSeries(pool, { title: 'Портал с нуля' });
    assert.notEqual(first.slug, second.slug);
  });
});

test('урок встаёт в конец серии, а повтор его оттуда не двигает', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { series, lessons } = await threeInSeries(pool);
    assert.deepEqual(
      (await getSeriesBySlug(pool, series.slug)).lessons.map((item) => item.slug),
      ['pervyy', 'vtoroy', 'tretiy']
    );

    // «Сохранить серию» на экране первого урока не должно отправлять его в
    // конец списка — а именно так и вышло бы, считай мы номер каждый раз.
    await setLessonSeries(pool, lessons[0].id, series.id);
    assert.deepEqual(
      (await getSeriesBySlug(pool, series.slug)).lessons.map((item) => item.slug),
      ['pervyy', 'vtoroy', 'tretiy']
    );
  });
});

test('стрелка меняет урок местами с соседом', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { series } = await threeInSeries(pool);

    assert.equal(await moveLessonInSeries(pool, 'tretiy', 'up'), true);
    assert.deepEqual(
      (await getSeriesBySlug(pool, series.slug)).lessons.map((item) => item.slug),
      ['pervyy', 'tretiy', 'vtoroy']
    );

    // Край списка — не ошибка: кнопка там просто ничего не делает.
    assert.equal(await moveLessonInSeries(pool, 'pervyy', 'up'), false);
  });
});

test('урок вне серии переставить нельзя', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await publishedLesson(pool, 'odinokiy', 'Одинокий');
    assert.equal(await moveLessonInSeries(pool, 'odinokiy', 'down'), false);
  });
});

test('место урока в серии — номер, всего и соседи', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await threeInSeries(pool);
    const lesson = await getLessonBySlug(pool, 'vtoroy', {});
    const nav = await seriesNavigation(pool, lesson);

    assert.equal(nav.number, 2);
    assert.equal(nav.total, 3);
    assert.equal(nav.previous.slug, 'pervyy');
    assert.equal(nav.next.slug, 'tretiy');
  });
});

test('черновик серии не считается зрителю ни в номер, ни в соседи', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { series } = await threeInSeries(pool);
    // Второй урок вернули в черновики: зритель обязан увидеть «1 из 2», а не
    // «урок 3 из 3» с соседом, которого ему не открыть.
    await pool.query(`UPDATE lessons SET status = 'draft' WHERE slug = 'vtoroy'`);

    const lesson = await getLessonBySlug(pool, 'tretiy', {});
    const nav = await seriesNavigation(pool, lesson);
    assert.equal(nav.total, 2);
    assert.equal(nav.number, 2);
    assert.equal(nav.previous.slug, 'pervyy');

    const forAuthor = await seriesNavigation(pool, lesson, { includeDrafts: true });
    assert.equal(forAuthor.total, 3);
    assert.equal(forAuthor.previous.slug, 'vtoroy');

    // У серии на публичной странице тоже только вышедшее.
    assert.equal((await getSeriesBySlug(pool, series.slug)).lessonCount, 2);
  });
});

test('похожие идут по числу общих тегов', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const base = await publishedLesson(pool, 'osnova', 'Основа', 1);
    await setLessonTags(pool, base.id, ['vps', 'docker', 'node']);

    const close = await publishedLesson(pool, 'blizkiy', 'Близкий', 2);
    await setLessonTags(pool, close.id, ['vps', 'docker']);
    const far = await publishedLesson(pool, 'dalniy', 'Дальний', 3);
    await setLessonTags(pool, far.id, ['docker']);

    const found = await relatedLessons(pool, await getLessonBySlug(pool, 'osnova', {}));
    assert.deepEqual(
      found.slice(0, 2).map((item) => item.slug),
      ['blizkiy', 'dalniy']
    );
    // Сам урок в похожих — насмешка над читателем.
    assert.ok(!found.some((item) => item.slug === 'osnova'));
  });
});

test('уроки своей серии в похожие не попадают', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessons } = await threeInSeries(pool);
    for (const lesson of lessons) await setLessonTags(pool, lesson.id, ['portal']);
    const outside = await publishedLesson(pool, 'chuzhoy', 'Чужой', 4);
    await setLessonTags(pool, outside.id, ['portal']);

    const found = await relatedLessons(pool, await getLessonBySlug(pool, 'pervyy', {}));
    // Соседи по серии уже показаны блоком серии — повторять их значит отнимать
    // место у того, чего человек ещё не видел.
    assert.deepEqual(
      found.map((item) => item.slug),
      ['chuzhoy']
    );
  });
});

test('без общих тегов похожие берутся из свежих, а не остаются пустыми', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const base = await publishedLesson(pool, 'bez-tegov', 'Без тегов', 1);
    await publishedLesson(pool, 'svezhiy', 'Свежий', 3);
    await publishedLesson(pool, 'starshiy', 'Старший', 2);

    const found = await relatedLessons(pool, { ...base, seriesId: null });
    assert.deepEqual(
      found.map((item) => item.slug),
      ['svezhiy', 'starshiy']
    );
  });
});

test('черновик в похожие не попадает', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const base = await publishedLesson(pool, 'osnova', 'Основа', 1);
    await setLessonTags(pool, base.id, ['vps']);
    const draft = await saveLesson(pool, { slug: 'chernovik', title: 'Черновик' });
    await setLessonTags(pool, draft.id, ['vps']);

    const found = await relatedLessons(pool, await getLessonBySlug(pool, 'osnova', {}));
    assert.equal(found.length, 0, 'зрителю нечего показать — и выдумывать нечего');
  });
});

test('удаление серии не уносит уроки', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { series } = await threeInSeries(pool);
    assert.equal(await deleteSeries(pool, series.slug), true);

    const lesson = await getLessonBySlug(pool, 'pervyy', {});
    assert.ok(lesson, 'урок обязан остаться: серия — способ разложить, а не хозяин');
    assert.equal(lesson.seriesId, null);
    assert.equal(await seriesNavigation(pool, lesson), null);
  });
});

test('страница серии показывает уроки по порядку', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { series } = await threeInSeries(pool);
    await moveLessonInSeries(pool, 'tretiy', 'up');
    const app = finalize(createApp({ config, pool, queue: { add: async () => {} } }));

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/series/${series.slug}`);
      assert.equal(response.status, 200);
      const page = await response.text();
      assert.ok(
        page.indexOf('Урок 3') < page.indexOf('Урок 2'),
        'порядок на странице обязан быть тем, что задал автор'
      );
      assert.equal((await fetch(`${base}/series/net-takoy`)).status, 404);
    });
  });
});

test('страница урока зовёт к следующему и к похожим', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lessons } = await threeInSeries(pool);
    for (const lesson of lessons) await setLessonTags(pool, lesson.id, ['portal']);
    const outside = await publishedLesson(pool, 'chuzhoy', 'Чужой урок', 4);
    await setLessonTags(pool, outside.id, ['portal']);

    const app = finalize(createApp({ config, pool, queue: { add: async () => {} } }));
    await withServer(app, async (base) => {
      const page = await (await fetch(`${base}/lesson/pervyy`)).text();
      assert.match(page, /Урок 1 из 3/);
      assert.match(page, /Портал с нуля/);
      assert.match(page, /\/lesson\/vtoroy/);
      assert.match(page, /Похожие уроки/);
      assert.match(page, /Чужой урок/);
    });
  });
});

test('урок вне серии не показывает пустого блока серии', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await publishedLesson(pool, 'odinokiy', 'Одинокий');
    const app = finalize(createApp({ config, pool, queue: { add: async () => {} } }));
    await withServer(app, async (base) => {
      const page = await (await fetch(`${base}/lesson/odinokiy`)).text();
      assert.doesNotMatch(page, /Серия «/);
    });
  });
});

test('урок ставится в серию с её заведением на ходу', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await publishedLesson(pool, 'urok', 'Урок');
    const headers = await admin(pool);
    const app = finalize(createApp({ config, pool, queue: { add: async () => {} } }));

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/admin/lessons/urok/series`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ seriesSlug: '', title: 'Портал с нуля' })
      });
      assert.equal(response.status, 200);
      const answer = await response.json();
      assert.equal(answer.series.title, 'Портал с нуля');
      assert.equal(answer.position, 1);

      // И обратно: пустой выбор вынимает урок из серии.
      const back = await fetch(`${base}/api/admin/lessons/urok/series`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ seriesSlug: '', title: '' })
      });
      assert.equal((await back.json()).series, null);
    });

    assert.equal((await getLessonBySlug(pool, 'urok', {})).seriesId, null);
    assert.equal((await listSeries(pool)).length, 1, 'сама серия при этом остаётся');
  });
});
