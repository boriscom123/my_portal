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
 * Краткое описание записи: в лентах оно лежит под тремя разными именами и почти
 * всегда с разметкой внутри.
 *
 * Зачем оно нам: по одному заголовку писать новость нечего — модель начнёт
 * выдумывать подробности. Описание из ленты — это слова самого источника, и на
 * них уже можно опереться.
 */
function itemSummary(xml, limit = 700) {
  for (const name of ['description', 'summary', 'content']) {
    const raw = tagText(xml, name);
    if (!raw) continue;
    const text = decode(raw.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    // Ленты-агрегаторы кладут в описание не суть, а служебные строки: адрес
    // статьи, адрес обсуждения, число голосов. Как материал для текста это
    // хуже пустоты — модель примет их за содержание и напишет о голосах.
    const clean = text
      .replace(/(Article|Comments) URL:\s*\S+/gi, '')
      .replace(/Points:\s*\d+/gi, '')
      .replace(/#\s*Comments:?\s*\d*/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    // Порог длины — только для описаний, из которых мы что-то вычистили: у
    // обычной ленты короткое описание это по-прежнему описание, а у
    // агрегатора остаток в пару слов — обрывок служебной строки.
    const wasNoise = clean !== text;
    if (clean && (!wasNoise || clean.length > 40)) return clean.slice(0, limit);
  }
  return '';
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
      summary: itemSummary(chunk),
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
