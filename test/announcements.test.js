// Сбор анонсов из официальных источников. В сеть не ходим.
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectAnnouncements, forgetAnnouncements } from '../src/services/announcements.js';
import { listSources, addSource, removeSource, toggleSource } from '../src/services/news-sources.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const feedOf = (title, date) => `<rss><channel><item>
  <title>${title}</title><link>https://example.com/${encodeURIComponent(title)}</link>
  <pubDate>${date}</pubDate>
</item></channel></rss>`;

test('начальный набор источников заложен миграцией', async () => {
  // Проверяем сам текст миграции, а не базу: тестовая база чистит таблицы
  // перед каждым тестом, и начальные строки в ней не переживают уборку.
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile(
    new URL('../migrations/020_news_sources.sql', import.meta.url),
    'utf8'
  );
  for (const source of ['Anthropic', 'OpenAI', 'GitHub', 'Docker', 'Node.js', 'PostgreSQL']) {
    assert.match(sql, new RegExp(source.replace('.', '\\.')));
  }
});

test('источники заводятся, выключаются и удаляются', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const added = await addSource(pool, { title: 'NVIDIA', url: 'https://nvidia.com/rss' });
    assert.equal(added.title, 'NVIDIA');

    // Выключенный остаётся в списке: заводить заново, когда он снова
    // понадобится, не приходится.
    await toggleSource(pool, added.id, false);
    assert.equal((await listSources(pool, { onlyEnabled: true })).some((s) => s.id === added.id), false);
    assert.equal((await listSources(pool)).some((s) => s.id === added.id), true);

    assert.equal(await removeSource(pool, added.id), true);
  });
});

test('адрес без http не принимается', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await assert.rejects(addSource(pool, { title: 'Кто-то', url: 'nvidia.com' }), /http/);
  });
});

test('анонсы собираются со всех источников и идут свежими сверху', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    forgetAnnouncements();
    await pool.query('DELETE FROM news_sources');
    await addSource(pool, { title: 'Первый', url: 'https://a.example/rss' });
    await addSource(pool, { title: 'Второй', url: 'https://b.example/rss' });

    const fetchImpl = async (url) => ({
      ok: true,
      text: async () =>
        String(url).includes('a.example')
          ? feedOf('Старая новость', 'Mon, 01 Sep 2026 10:00:00 GMT')
          : feedOf('Свежая новость', 'Tue, 09 Sep 2026 10:00:00 GMT')
    });

    const { items, failed } = await collectAnnouncements(pool, { fetchImpl });
    assert.deepEqual(items.map((item) => item.title), ['Свежая новость', 'Старая новость']);
    assert.deepEqual(failed, []);
    assert.equal(items[0].source, 'Второй');
  });
});

test('молчащий источник назван, а остальные показаны', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    forgetAnnouncements();
    await pool.query('DELETE FROM news_sources');
    await addSource(pool, { title: 'Живой', url: 'https://a.example/rss' });
    await addSource(pool, { title: 'Молчун', url: 'https://b.example/rss' });

    const fetchImpl = async (url) =>
      String(url).includes('a.example')
        ? { ok: true, text: async () => feedOf('Есть новость', 'Tue, 09 Sep 2026 10:00:00 GMT') }
        : { ok: false, status: 500, text: async () => '' };

    const { items, failed } = await collectAnnouncements(pool, { fetchImpl });
    assert.equal(items.length, 1);
    // Показать неполный список молча — значит соврать, что у Молчуна нет новостей.
    assert.equal(failed.length, 1);
    assert.match(failed[0], /Молчун/);
  });
});

test('второе обращение подряд чужие сайты не беспокоит', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    forgetAnnouncements();
    await pool.query('DELETE FROM news_sources');
    await addSource(pool, { title: 'Один', url: 'https://a.example/rss' });

    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return { ok: true, text: async () => feedOf('Новость', 'Tue, 09 Sep 2026 10:00:00 GMT') };
    };

    await collectAnnouncements(pool, { fetchImpl });
    const second = await collectAnnouncements(pool, { fetchImpl });
    assert.equal(calls, 1, 'десять нажатий подряд не должны бить по чужим сайтам');
    assert.equal(second.cached, true);

    // Через пятнадцать минут — спрашиваем заново.
    const later = Date.now() + 16 * 60 * 1000;
    await collectAnnouncements(pool, { fetchImpl, now: () => later });
    assert.equal(calls, 2);
  });
});
