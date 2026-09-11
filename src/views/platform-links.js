// Ссылки на площадки, где вышел урок.
//
// Задача — показать их одинаково в двух местах: на карточке урока и в ленте.
// Зачем отдельным файлом: правило «показываем только вышедшее» и названия
// площадок должны жить в одном месте. Разойдись они — и в ленте появилась бы
// ссылка на приватный ролик, которую на самой странице урока мы прячем.
// Вызывается из src/views/lesson.js и src/views/feed.js.
import { escapeHtml } from '../lib/html.js';

/** Как называется площадка человеку. Слаг для этого не годится. */
export const PLATFORM_NAMES = {
  youtube: 'YouTube',
  vk: 'VK Video',
  rutube: 'RuTube',
  dzen: 'Дзен',
  telegram: 'Telegram',
  max: 'MAX',
  tiktok: 'TikTok',
  instagram: 'Instagram'
};

/**
 * Ссылки на вышедшие ролики. Пустая строка — показывать нечего.
 *
 * Приватный ролик чужому человеку не открывается, а у поста в MAX нет своего
 * адреса — там ссылка ведёт на канал. Поэтому условие одно и то же: есть адрес
 * и состояние «опубликован».
 *
 * Посты с частями видео (telegram_parts, max_parts) не показываем: ссылка на
 * пост в том же канале уже есть — это анонс, и вторая «Смотреть на Telegram»
 * рядом выглядела бы ошибкой.
 */
export function platformLinks(publications = [], { className = 'button', prefix = 'Смотреть на ' } = {}) {
  return publications
    .filter((item) => item.url && item.state === 'published' && !item.platform.endsWith('_parts'))
    .map(
      (item) =>
        `<a class="${className}" href="${escapeHtml(item.url)}" rel="noopener" target="_blank">${escapeHtml(
          `${prefix}${PLATFORM_NAMES[item.platform] ?? item.platform}`
        )}</a>`
    )
    .join('');
}
