// Чтение чужих лент. В сеть не ходим: fetch подставляется.
//
// Ленты в природе кривые: незакрытые теги, смесь форматов, время в трёх видах,
// ссылки на комментарии рядом со ссылкой на статью. Разбор нарочно
// снисходительный — пропущенная запись лучше, чем отказ целиком: человек ждёт
// список анонсов, а не сообщение о чужой ошибке.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, readFeed } from '../src/lib/feed-reader.js';

const rss = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Anthropic News</title>
  <item>
    <title>Claude Opus 5 is here</title>
    <link>https://www.anthropic.com/news/opus-5</link>
    <pubDate>Tue, 09 Sep 2026 12:30:00 GMT</pubDate>
  </item>
  <item>
    <title><![CDATA[Модель & инструменты]]></title>
    <link>https://www.anthropic.com/news/tools</link>
    <pubDate>Mon, 08 Sep 2026 09:00:00 GMT</pubDate>
  </item>
</channel></rss>`;

const atom = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Node.js 26 released</title>
    <link rel="replies" href="https://nodejs.org/comments"/>
    <link rel="alternate" href="https://nodejs.org/blog/release/v26"/>
    <published>2026-09-07T10:00:00Z</published>
  </entry>
</feed>`;

test('RSS разбирается: заголовок, ссылка, время', () => {
  const items = parseFeed(rss, { source: 'Anthropic' });
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Claude Opus 5 is here');
  assert.equal(items[0].url, 'https://www.anthropic.com/news/opus-5');
  assert.equal(items[0].publishedAt.toISOString(), '2026-09-09T12:30:00.000Z');
  assert.equal(items[0].source, 'Anthropic');
});

test('CDATA и сущности раскрываются', () => {
  const items = parseFeed(rss, { source: 'Anthropic' });
  assert.equal(items[1].title, 'Модель & инструменты');
});

test('в Atom берётся ссылка на статью, а не на комментарии', () => {
  // Ссылок в записи бывает несколько, и первая — не обязательно нужная.
  const [item] = parseFeed(atom, { source: 'Node.js' });
  assert.equal(item.url, 'https://nodejs.org/blog/release/v26');
  assert.equal(item.publishedAt.toISOString(), '2026-09-07T10:00:00.000Z');
});

test('запись без заголовка или ссылки выбрасывается, остальные остаются', () => {
  const broken = `<rss><channel>
    <item><title>Без ссылки</title></item>
    <item><title>Целая</title><link>https://example.com/a</link></item>
  </channel></rss>`;
  const items = parseFeed(broken, { source: 'Тест' });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Целая');
});

test('непонятная лента даёт пустой список, а не исключение', () => {
  // Один сломавшийся источник не должен уносить с собой остальные восемь.
  assert.deepEqual(parseFeed('<html>не лента</html>', {}), []);
  assert.deepEqual(parseFeed('', {}), []);
  assert.deepEqual(parseFeed(null, {}), []);
});

test('чтение ленты возвращает записи', async () => {
  const { items, failed } = await readFeed({
    title: 'Anthropic',
    url: 'https://example.com/rss',
    fetchImpl: async () => ({ ok: true, text: async () => rss })
  });
  assert.equal(failed, null);
  assert.equal(items.length, 2);
});

test('отказ источника называется по имени, а не молчит', async () => {
  const { items, failed } = await readFeed({
    title: 'Docker',
    url: 'https://example.com/rss',
    fetchImpl: async () => ({ ok: false, status: 503, text: async () => '' })
  });
  assert.deepEqual(items, []);
  // Молча показать неполный список хуже: человек решит, что у источника просто
  // нет новостей.
  assert.match(failed, /Docker/);
  assert.match(failed, /503/);
});

test('источник, который не отвечает, не вешает остальных', async () => {
  const { failed } = await readFeed({
    title: 'Медленный',
    url: 'https://example.com/rss',
    timeoutMs: 5,
    fetchImpl: async (url, options) =>
      new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('timeout');
          error.name = 'TimeoutError';
          reject(error);
        });
      })
  });
  assert.match(failed, /не ответил вовремя/);
});

test('из записи берётся и краткое описание — без разметки', () => {
  // По одному заголовку писать нечего: модель начнёт выдумывать подробности.
  // Описание из ленты — слова самого источника, на них можно опереться.
  const withSummary = `<rss><channel><item>
    <title>Claude Opus 5</title>
    <link>https://example.com/a</link>
    <description><![CDATA[<p>Новая модель <b>быстрее</b> прежней.</p>]]></description>
  </item></channel></rss>`;
  const [item] = parseFeed(withSummary, { source: 'Anthropic' });
  assert.equal(item.summary, 'Новая модель быстрее прежней.');
});

test('описание Atom берётся из summary или content', () => {
  const atomWithSummary = `<feed><entry>
    <title>Node.js 26</title>
    <link rel="alternate" href="https://nodejs.org/a"/>
    <summary>Вышла новая версия с обновлённым V8.</summary>
  </entry></feed>`;
  const [item] = parseFeed(atomWithSummary, { source: 'Node.js' });
  assert.match(item.summary, /обновлённым V8/);
});

test('служебное описание агрегатора за материал не считается', () => {
  // Hacker News кладёт в описание адрес статьи, адрес обсуждения и число
  // голосов. Как материал это хуже пустоты: модель примет их за содержание и
  // напишет заметку о голосах.
  const hn = `<rss><channel><item>
    <title>Apple Unveils iPhone Duo</title>
    <link>https://news.ycombinator.com/item?id=49630964</link>
    <description>Article URL: https://www.apple.com/newsroom/2026/09/duo/ Comments URL: https://news.ycombinator.com/item?id=49630964 Points: 291 # Comments: 88</description>
  </item></channel></rss>`;
  const [item] = parseFeed(hn, { source: 'Hacker News' });
  assert.equal(item.summary, '', 'пусто честнее, чем адреса и голоса');
});
