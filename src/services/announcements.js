// Свежие анонсы из официальных источников.
//
// Задача — собрать в один список то, что сегодня написали сами компании, и
// показать автору: он выберет подходящее и напишет об этом новость.
//
// Источники спрашиваются разом, а не по очереди: девять лент подряд по восемь
// секунд — это минута ожидания вместо восьми секунд.
// Вызывается из src/routes/admin.js.
import { readFeed } from '../lib/feed-reader.js';
import { listSources } from './news-sources.js';

// Сколько держим собранное. Пятнадцать минут: анонсы выходят не чаще, а десять
// нажатий подряд не должны бить по чужим сайтам.
const CACHE_MS = 15 * 60 * 1000;

// Сколько записей берём у одного источника. Больше — и лента Hacker News
// вытеснит собой всё остальное.
const PER_SOURCE = 5;

let cache = { at: 0, data: null };

/** Сбрасывает запомненное. Нужен после правки списка источников и в тестах. */
export function forgetAnnouncements() {
  cache = { at: 0, data: null };
}

/**
 * Свежие анонсы, новые сверху.
 * failed — источники, которые не ответили: показать неполный список молча
 * значит соврать, что у них нет новостей.
 */
export async function collectAnnouncements(pool, { fetchImpl = fetch, now = Date.now } = {}) {
  if (cache.data && now() - cache.at < CACHE_MS) return { ...cache.data, cached: true };

  const sources = await listSources(pool, { onlyEnabled: true });
  const results = await Promise.all(
    sources.map((source) =>
      readFeed({ title: source.title, url: source.url, limit: PER_SOURCE, fetchImpl })
    )
  );

  const items = results
    .flatMap((result) => result.items)
    // Без времени запись уходит вниз: она не «самая свежая», она непонятно
    // какая, и ставить её первой было бы враньём.
    .sort((first, second) => (second.publishedAt ?? 0) - (first.publishedAt ?? 0));

  const data = { items, failed: results.map((result) => result.failed).filter(Boolean) };
  cache = { at: now(), data };
  return { ...data, cached: false };
}
