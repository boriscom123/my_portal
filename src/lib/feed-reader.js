// Чтение лент новостей: RSS и Atom.
//
// Задача — превратить чужую ленту в список записей «источник, время, заголовок,
// ссылка». Зачем своими руками, без пакета: разбор двух форматов, которые не
// менялись пятнадцать лет, — это полсотни строк, а зависимость пришлось бы
// обновлять и проверять годами.
//
// Разбор нарочно снисходительный: ленты в природе кривые — незакрытые теги,
// смесь форматов, время в трёх видах. Пропущенная запись лучше, чем отказ
// целиком: человек ждёт список анонсов, а не сообщение о чужой ошибке.
// Вызывается из src/services/announcements.js.

/** Достаёт содержимое первого такого тега. '' — тега нет. */
function tagText(xml, name) {
  const match = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return match ? decode(match[1]) : '';
}

/** Раскрывает CDATA и обычные сущности. */
function decode(text) {
  return String(text)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * Ссылка записи.
 * У RSS она текстом внутри тега, у Atom — в атрибуте href, и там же бывают
 * ссылки на комментарии и на саму ленту: берём ту, что ведёт на страницу.
 */
function itemLink(xml) {
  const plain = tagText(xml, 'link');
  if (plain && /^https?:/i.test(plain)) return plain;

  const atom = [...xml.matchAll(/<link\b[^>]*href="([^"]+)"[^>]*>/gi)].map((match) => ({
    href: decode(match[1]),
    // Без rel считаем ссылку основной: у RSS-подобных лент его просто нет, а
    // дырка в массиве ради умолчания — тот случай, когда линтер прав.
    rel: match[0].match(/rel="([^"]+)"/i)?.[1] ?? 'alternate'
  }));
  return atom.find((link) => link.rel === 'alternate')?.href ?? atom[0]?.href ?? '';
}

/** Время записи. null — не разобрали; такая запись уйдёт в конец списка. */
function itemDate(xml) {
  for (const name of ['pubDate', 'published', 'updated', 'dc:date']) {
    const raw = tagText(xml, name);
    if (!raw) continue;
    const at = new Date(raw);
    if (!Number.isNaN(at.getTime())) return at;
  }
  return null;
}

/**
 * Разбирает ленту в записи.
 * Возвращает массив; на непонятной ленте — пустой, а не исключение: один
 * сломавшийся источник не должен уносить с собой остальные восемь.
 */
export function parseFeed(xml, { source = '', limit = 10 } = {}) {
  const chunks = [
    ...String(xml ?? '').matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)
  ].map((match) => match[2]);

  return chunks
    .map((chunk) => ({
      source,
      title: tagText(chunk, 'title'),
      url: itemLink(chunk),
      publishedAt: itemDate(chunk)
    }))
    .filter((item) => item.title && item.url)
    .slice(0, limit);
}

/**
 * Читает одну ленту. Возвращает записи либо причину отказа.
 * Не бросает: список анонсов собирается из девяти источников, и падение из-за
 * одного оставило бы человека без остальных.
 */
export async function readFeed({ title, url, limit = 10, timeoutMs = 8000, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'soloaijourney-portal/1.0 (+https://soloaijourney.online)' }
    });
    if (!response.ok) return { items: [], failed: `${title}: ответил ${response.status}` };

    const items = parseFeed(await response.text(), { source: title, limit });
    return items.length
      ? { items, failed: null }
      : { items: [], failed: `${title}: лента пуста или незнакомого вида` };
  } catch (error) {
    return { items: [], failed: `${title}: ${error.name === 'TimeoutError' ? 'не ответил вовремя' : error.message}` };
  }
}
