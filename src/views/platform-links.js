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
 */
export function platformLinks(publications = [], { className = 'button', prefix = 'Смотреть на ' } = {}) {
  return publications
    .filter((item) => item.url && item.state === 'published')
    .map(
      (item) =>
        `<a class="${className}" href="${escapeHtml(item.url)}" rel="noopener" target="_blank">${escapeHtml(
          `${prefix}${PLATFORM_NAMES[item.platform] ?? item.platform}`
        )}</a>`
    )
    .join('');
}
