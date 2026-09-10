// Новость: черновик, выпуск в свет и посты в каналах.
//
// Главное, что здесь проверяется, — что черновик НЕ виден читателю: ни в
// списке, ни по прямой ссылке, ни в канале. Ошибка в любом из трёх мест
// означает недописанную новость на витрине.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { listNews, saveNews, publishNews, getNewsBySlug } from '../src/services/news.js';
import { registerAsset } from '../src/services/media.js';
import { startPublication, newsPublications } from '../src/services/publications.js';
import { savePlatformApp } from '../src/services/platform-apps.js';
import { makePublishChannel } from '../src/jobs/publish-channel.js';
import { buildNewsAnnouncement } from '../src/services/platforms/announcement.js';
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

/** Настроенный канал: без токена и адреса кнопка отправки права не имеет. */
async function connectChannel(pool, name = 'telegram') {
  await savePlatformApp(pool, config, {
    name,
    clientId: '',
    clientSecret: 'bot-token',
    mode: 'auto',
    settings: { channel: '@kanal' }
  });
}

function adapterStub() {
  const calls = [];
  return {
    calls,
    app: async () => ({ configured: true, token: 't', channel: '@kanal' }),
    post: async (args) => (calls.push(args), { messageId: '7', url: 'https://t.me/kanal/7' }),
    edit: async () => {}
  };
}

test('новость заводится черновиком и без даты выхода', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const item = await saveNews(pool, { title: 'Черновик', body: 'Текст' });
    assert.equal(item.status, 'draft');
    // Дата выхода у черновика — ложь: он ещё не выходил.
    assert.equal(item.publishedAt, null);
  });
});

test('выпуск ставит дату, а возврат в черновик её не стирает', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const item = await saveNews(pool, { title: 'Новость дня' });
    const published = await publishNews(pool, item.slug);
    assert.equal(published.status, 'published');
    assert.ok(published.publishedAt);

    const back = await publishNews(pool, item.slug, false);
    assert.equal(back.status, 'draft');

    // Второй выпуск не поднимает старую новость наверх ленты: дата та же.
    const again = await publishNews(pool, item.slug);
    assert.equal(
      new Date(again.publishedAt).getTime(),
      new Date(published.publishedAt).getTime()
    );
  });
});

test('черновика нет в ленте, но он есть у автора', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveNews(pool, { title: 'Ещё пишется' });
    const visible = await saveNews(pool, { title: 'Уже вышла' });
    await publishNews(pool, visible.slug);

    const forReaders = await listNews(pool, {});
    assert.deepEqual(
      forReaders.map((news) => news.title),
      ['Уже вышла']
    );

    const forAuthor = await listNews(pool, { includeDrafts: true });
    assert.equal(forAuthor.length, 2);
  });
});

test('черновик по прямой ссылке — «не найдено» для читателя', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const item = await saveNews(pool, { title: 'Тайна' });
    const app = finalize(createApp({ config, pool, queue: { add: async () => {} } }));

    await withServer(app, async (base) => {
      const guest = await fetch(`${base}/news/${item.slug}`);
      assert.equal(guest.status, 404);
      // Даже заголовка не показываем: «есть, но не для вас» — это тоже утечка.
      assert.doesNotMatch(await guest.text(), /Тайна/);

      const headers = await admin(pool);
      const author = await fetch(`${base}/news/${item.slug}`, { headers });
      assert.equal(author.status, 200);
      const page = await author.text();
      assert.match(page, /черновик/i);
      // Просмотр показывает новость так, как её увидит читатель: кнопки и формы
      // живут на странице правки, рядом с остальной работой над новостью.
      assert.doesNotMatch(page, /data-news-publish/);
      assert.doesNotMatch(page, /data-news-post/);

      const edit = await fetch(`${base}/news/${item.slug}/edit`, { headers });
      assert.equal(edit.status, 200);
      const form = await edit.text();
      assert.match(form, /Опубликовать/);
      assert.match(form, /data-news-publish/);
    });
  });
});

test('кнопка выпускает новость в свет', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const item = await saveNews(pool, { title: 'Готова' });
    const headers = await admin(pool);
    const app = finalize(createApp({ config, pool, queue: { add: async () => {} } }));

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/admin/news/${item.slug}/publish`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ publish: true })
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).status, 'published');
    });

    assert.equal((await getNewsBySlug(pool, item.slug)).status, 'published');
  });
});

test('пост о черновике не ставится в очередь', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const item = await saveNews(pool, { title: 'Черновик' });
    await connectChannel(pool);
    const headers = await admin(pool);
    const queued = [];
    const app = finalize(
      createApp({ config, pool, queue: { add: async (name, data) => queued.push({ name, data }) } })
    );

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/admin/news/${item.slug}/publish/telegram`, {
        method: 'POST',
        headers
      });
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /черновик/i);
    });
    assert.equal(queued.length, 0, 'задача не должна была уйти в очередь');
  });
});

test('пост о вышедшей новости ставится в очередь с её номером', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const item = await saveNews(pool, { title: 'Вышла' });
    await publishNews(pool, item.slug);
    await connectChannel(pool);
    const headers = await admin(pool);
    const queued = [];
    const app = finalize(
      createApp({ config, pool, queue: { add: async (name, data) => queued.push({ name, data }) } })
    );

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/admin/news/${item.slug}/publish/telegram`, {
        method: 'POST',
        headers
      });
      assert.equal(response.status, 200);
    });

    assert.equal(queued.length, 1);
    assert.equal(queued[0].name, 'publishTelegram');
    assert.equal(queued[0].data.newsId, item.id);
    // Урока у поста о новости нет — и подставлять чужой нельзя.
    assert.equal(queued[0].data.lessonId, undefined);

    const [publication] = await newsPublications(pool, item.id);
    assert.equal(publication.state, 'queued');
  });
});

test('посты разных новостей не сталкиваются в одной строке', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    // Прежний уникальный ключ считал пустоту значением, и вторая новость
    // переписала бы пост первой.
    const first = await saveNews(pool, { title: 'Первая' });
    const second = await saveNews(pool, { title: 'Вторая' });
    const one = await startPublication(pool, { newsId: first.id, platform: 'telegram', mode: 'auto' });
    const two = await startPublication(pool, { newsId: second.id, platform: 'telegram', mode: 'auto' });

    assert.notEqual(one.id, two.id);
    assert.equal((await newsPublications(pool, first.id)).length, 1);
    assert.equal((await newsPublications(pool, second.id)).length, 1);
  });
});

test('новость без картинки уходит в канал текстом', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const item = await saveNews(pool, { title: 'Заметка', body: 'Две строки текста.' });
    await publishNews(pool, item.slug);
    const { id: publicationId } = await startPublication(pool, {
      newsId: item.id,
      platform: 'telegram',
      mode: 'auto'
    });
    const adapter = adapterStub();

    await makePublishChannel(config, pool, 'telegram', adapter)({
      newsId: item.id,
      publicationId
    });

    assert.equal(adapter.calls[0].photoUrl, null, 'картинки нет — и выдумывать её нечем');
    assert.equal(adapter.calls[0].filePath, null);
    assert.match(adapter.calls[0].caption, /Заметка/);
    assert.match(adapter.calls[0].caption, new RegExp(`https://portal.example/news/${item.slug}`));

    const [publication] = await newsPublications(pool, item.id);
    assert.equal(publication.state, 'published');
    assert.equal(publication.externalId, '7');
  });
});

test('в канал уходит первая картинка новости', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const item = await saveNews(pool, { title: 'С картинкой' });
    await publishNews(pool, item.slug);
    // Порядок задаёт автор: в канал едет первая, а не какая придётся.
    const second = await registerAsset(pool, config, {
      newsId: item.id,
      kind: 'image',
      relativePath: 'news-1/second.jpg',
      bytes: 10
    });
    await pool.query('UPDATE assets SET position = 2 WHERE id = $1', [second.id]);
    const first = await registerAsset(pool, config, {
      newsId: item.id,
      kind: 'image',
      relativePath: 'news-1/first.jpg',
      bytes: 10
    });
    await pool.query('UPDATE assets SET position = 1 WHERE id = $1', [first.id]);

    const { id: publicationId } = await startPublication(pool, {
      newsId: item.id,
      platform: 'max',
      mode: 'auto'
    });
    const adapter = adapterStub();
    await makePublishChannel(config, pool, 'max', adapter)({ newsId: item.id, publicationId });

    assert.equal(adapter.calls[0].photoUrl, `https://portal.example/media/asset/${first.id}`);
    assert.match(adapter.calls[0].filePath, /news-1\/first\.jpg$/);
  });
});

test('шаг очереди не отправит черновик, даже если его попросили', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    // Между нажатием и очередью автор мог вернуть новость в черновики.
    const item = await saveNews(pool, { title: 'Передумал' });
    await publishNews(pool, item.slug);
    const { id: publicationId } = await startPublication(pool, {
      newsId: item.id,
      platform: 'telegram',
      mode: 'auto'
    });
    await publishNews(pool, item.slug, false);

    const adapter = adapterStub();
    await assert.rejects(
      makePublishChannel(config, pool, 'telegram', adapter)({ newsId: item.id, publicationId }),
      /черновик/i
    );
    assert.equal(adapter.calls.length, 0);
    const [publication] = await newsPublications(pool, item.id);
    assert.equal(publication.state, 'failed');
  });
});

test('подпись поста — заголовок, начало текста и ссылка', () => {
  const caption = buildNewsAnnouncement({
    item: { slug: 'novost', title: 'Заголовок', body: 'Первое предложение. Второе предложение.' },
    publicBaseUrl: 'https://portal.example'
  });
  assert.match(caption, /^Заголовок\n\n/);
  assert.match(caption, /Первое предложение/);
  assert.ok(caption.endsWith('https://portal.example/news/novost'));
});

test('длинный текст режется, а ссылка остаётся', () => {
  const caption = buildNewsAnnouncement({
    item: { slug: 'novost', title: 'Заголовок', body: `${'Слово '.repeat(400)}конец.` },
    publicBaseUrl: 'https://portal.example'
  });
  assert.ok(caption.length <= 1024, 'подпись обязана влезать в предел Telegram');
  assert.ok(caption.endsWith('https://portal.example/news/novost'));
});
