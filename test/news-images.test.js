// Картинки к новостям: нарисованные и загруженные, удаление и ожидание.
// Главное — картинка встаёт в ленту новости следующей и не затирает чужой
// файл, рисование страница ждёт сама, а удалить можно каждую картинку.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { saveNews, getNewsById } from '../src/services/news.js';
import { saveDrawingSettings } from '../src/services/drawing-settings.js';
import { attachNewsImage, removeNewsImage } from '../src/services/news-images.js';
import { markDrawing, recordSideFailure } from '../src/services/cover-drawing.js';
import { makeMakeNewsImage } from '../src/jobs/make-news-image.js';
import { jobOptions } from '../src/queue.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

// Настоящая подпись PNG: вид файла определяется по первым байтам.
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16)
]);

async function makeConfig() {
  return {
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
    gemini: { apiKey: 'k', model: 'm' },
    media: { dir: await mkdtemp(path.join(tmpdir(), 'portal-news-img-')), ttlHours: 168 },
    youtube: { clientId: '', clientSecret: '', redirectUri: '', mode: 'semi' }
  };
}

async function seed(pool, config) {
  const item = await saveNews(pool, { title: 'Вышла новая модель', body: 'Текст заметки про модель.' });
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
  );
  return {
    item,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'admin' }, config.jwtSecret)}`
    }
  };
}

/** Рисование, которое запоминает запросы и отдаёт картинку. */
function recordingImages() {
  const prompts = [];
  return {
    prompts,
    isConfigured: async () => true,
    generate: async (prompt) => {
      prompts.push(prompt);
      return { bytes: PNG, type: 'png', model: 'm' };
    }
  };
}

const editPage = async (base, headers, slug) =>
  (await fetch(`${base}/news/${slug}/edit`, { headers: { ...headers, Accept: 'text/html' } })).text();

test('картинка встаёт следующей и после удаления не затирает чужую', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { item } = await seed(pool, config);
    const first = await attachNewsImage(pool, config, item.id, PNG, 'png');
    const second = await attachNewsImage(pool, config, item.id, PNG, 'png');
    await removeNewsImage(pool, config, item.id, first.assetId);
    // Имя по порядковому номеру здесь затёрло бы вторую картинку: номер
    // считался как «сколько картинок + 1».
    const third = await attachNewsImage(pool, config, item.id, PNG, 'png');

    const files = await readdir(path.join(config.media.dir, `news-${item.id}`));
    assert.equal(files.length, 2, `на диске: ${files.join(', ')}`);
    const found = await getNewsById(pool, item.id);
    assert.deepEqual(
      found.images.map((image) => image.id),
      [second.assetId, third.assetId]
    );
  });
});

test('удалить можно свою картинку, но не картинку чужой новости', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { item, headers } = await seed(pool, config);
    const other = await saveNews(pool, { title: 'Другая новость', body: '' });
    const mine = await attachNewsImage(pool, config, item.id, PNG, 'png');
    const alien = await attachNewsImage(pool, config, other.id, PNG, 'png');

    await withServer(finalize(createApp({ config, pool })), async (base) => {
      const removed = await fetch(`${base}/api/admin/news/${item.slug}/images/${mine.assetId}`, {
        method: 'DELETE',
        headers
      });
      assert.equal(removed.status, 200);
      const refused = await fetch(`${base}/api/admin/news/${item.slug}/images/${alien.assetId}`, {
        method: 'DELETE',
        headers
      });
      assert.equal(refused.status, 404);
    });
    assert.equal((await getNewsById(pool, item.id)).images.length, 0);
    assert.equal((await getNewsById(pool, other.id)).images.length, 1, 'удалилась чужая картинка');
    assert.deepEqual(await readdir(path.join(config.media.dir, `news-${item.id}`)), []);
  });
});

test('рисование ставится в очередь один раз и помечает новость', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { item, headers } = await seed(pool, config);
    const added = [];
    const app = finalize(
      createApp({ config, pool, queue: { add: async (name, data) => added.push({ name, data }) } })
    );
    await withServer(app, async (base) => {
      const draw = () =>
        fetch(`${base}/api/admin/news/${item.slug}/image`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ prompt: '  A robot arm sorting glowing parcels  ' })
        });

      const noToken = await draw();
      assert.equal(noToken.status, 409);
      assert.match((await noToken.json()).error, /токен Hugging Face/);

      await saveDrawingSettings(pool, config, { token: 'hf_secret_token', models: '' });
      assert.equal((await draw()).status, 200);
      const state = await (await fetch(`${base}/api/admin/news/${item.slug}/state`, { headers })).json();
      assert.equal(state.drawing, true);

      // Второе нажатие, пока идёт первое, — вторая картинка за те же кредиты.
      const again = await draw();
      assert.equal(again.status, 409);
      assert.match((await again.json()).error, /уже рисуется/);
    });
    assert.deepEqual(added, [
      { name: 'makeNewsImage', data: { newsId: item.id, prompt: 'A robot arm sorting glowing parcels' } }
    ]);
  });
});

test('шаг рисует по запросу автора, по Gemini без «no» и по шаблону', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { item } = await seed(pool, config);
    await markDrawing(pool, item.id, 'news');
    const images = recordingImages();

    const byAuthor = await makeMakeNewsImage(config, pool, images, null)({
      newsId: item.id,
      prompt: 'A lighthouse, no boats'
    });
    assert.equal(byAuthor.promptSource, 'author');
    const afterAuthor = await getNewsById(pool, item.id);
    assert.equal(afterAuthor.images.length, 1, 'картинка не встала в ленту');
    assert.equal(afterAuthor.drawing, null, 'отметка «рисуется» осталась');
    assert.deepEqual(afterAuthor.imagePrompt, { text: 'A lighthouse, no boats', source: 'author' });

    await makeMakeNewsImage(config, pool, images, {
      suggestImagePrompt: async () => ({ prompt: 'A robot sorting parcels, no text, soft glow', model: 't' })
    })({ newsId: item.id });
    // «no text» модель рисования прочла бы как «нарисуй надпись».
    assert.equal(images.prompts[1], 'A robot sorting parcels, soft glow');

    const byTemplate = await makeMakeNewsImage(config, pool, images, {
      suggestImagePrompt: async () => {
        throw new Error('503');
      }
    })({ newsId: item.id });
    assert.equal(byTemplate.promptSource, 'template');
    assert.match(images.prompts[2], /concrete physical scene/);
    assert.equal((await getNewsById(pool, item.id)).images.length, 3);
  });
});

test('отказ рисования снимает отметку и остаётся причиной', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { item } = await seed(pool, config);
    await markDrawing(pool, item.id, 'news');
    await recordSideFailure(pool, item.id, 'makeNewsImage', 'Модели сейчас заняты', 'news');
    const found = await getNewsById(pool, item.id);
    assert.equal(found.drawing, null);
    assert.equal(found.sideError.message, 'Модели сейчас заняты');
  });
});

test('«Составить запрос» кладёт запрос у новости уже без отрицаний', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { item, headers } = await seed(pool, config);
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({
        candidates: [
          { content: { parts: [{ text: JSON.stringify({ prompt: 'A robot arm, no text, glowing' }) }] } }
        ]
      })
    });
    await withServer(finalize(createApp({ config, pool, fetchImpl })), async (base) => {
      const response = await fetch(`${base}/api/admin/news/${item.slug}/image-prompt`, {
        method: 'POST',
        headers
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { prompt: 'A robot arm, glowing' });
    });
    assert.deepEqual((await getNewsById(pool, item.id)).imagePrompt, {
      text: 'A robot arm, glowing',
      source: 'suggested'
    });
  });
});

test('страница правки: поле, кнопки и «Удалить» у каждой картинки', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { item, headers } = await seed(pool, config);
    await saveDrawingSettings(pool, config, { token: 'hf_secret_token', models: '' });
    const image = await attachNewsImage(pool, config, item.id, PNG, 'png');
    await pool.query(
      `UPDATE news SET generated = generated || jsonb_build_object('imagePrompt',
         jsonb_build_object('text', 'A robot arm', 'source', 'suggested')) WHERE id = $1`,
      [item.id]
    );
    await withServer(finalize(createApp({ config, pool })), async (base) => {
      const page = await editPage(base, headers, item.slug);
      assert.match(page, /<label class="field">Запрос для рисования[\s\S]*?data-news-image-prompt[^>]*>A robot arm<\/textarea>/);
      assert.match(page, new RegExp(`data-news-prompt="${item.slug}"`));
      assert.match(page, new RegExp(`data-draw-news="${item.slug}"\\s*>`));
      assert.match(page, new RegExp(`data-news-image-remove="${image.assetId}"`));
      // Старая кнопка «Запрос для картинки» в форме — её заменило поле у картинок.
      assert.ok(!page.includes('data-image-prompt'), 'в форме осталась старая кнопка запроса');
    });
  });
});

test('открытая во время рисования страница ждёт его сама', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { item, headers } = await seed(pool, config);
    await saveDrawingSettings(pool, config, { token: 'hf_secret_token', models: '' });
    await markDrawing(pool, item.id, 'news');
    await withServer(finalize(createApp({ config, pool })), async (base) => {
      const page = await editPage(base, headers, item.slug);
      assert.match(page, new RegExp(`data-news-draw-watch="${item.slug}"`));
      assert.match(page, /Рисую…/);
    });
  });
});

test('рисование картинки к новости сама очередь не повторяет', () => {
  // Слой рисования уже перебирает модели на «занято», а повтор всей задачи
  // снимал бы отметку «рисуется» на первой же неудаче.
  assert.deepEqual(jobOptions('makeNewsImage'), { attempts: 1 });
});
