// Ссылки на площадки, где вышел урок.
//
// Задача — показать их одинаково в двух местах: на карточке урока и в ленте.
// Зачем отдельным файлом: правило «показываем только вышедшее» и названия
// площадок должны жить в одном месте. Разойдись они — и в ленте появилась бы
// ссылка на приватный ролик, которую на самой странице урока мы прячем.
// Вызывается из src/views/lesson.js и src/views/feed.js.
import { escapeHtml } from '../lib/html.js';
import { latestPerPlatform } from '../lib/latest-publications.js';

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
 * В каналах Telegram и MAX кнопка ведёт на пост с видео урока — отправку
 * частями (telegram_parts, max_parts), — а не на анонс: в анонсе видео нет, и
 * звать туда «смотреть» нечестно. Постов с видео ещё нет — кнопки канала нет.
 */
export function platformLinks(publications = [], { className = 'button', prefix = 'Смотреть на ' } = {}) {
  // Урок выложен на площадку дважды — ссылка одна, на последний вышедший ролик.
  return latestPerPlatform(
    publications.filter(
      (item) => item.url && item.state === 'published' && !ANNOUNCEMENT_PLATFORMS.has(item.platform)
    )
  )
    .map((item) => {
      // На кнопке — имя канала, а не сырое «telegram_parts».
      const platform = item.platform.replace(/_parts$/, '');
      return `<a class="${className}" href="${escapeHtml(item.url)}" rel="noopener" target="_blank">${escapeHtml(
        `${prefix}${PLATFORM_NAMES[platform] ?? platform}`
      )}</a>`;
    })
    .join('');
}

// Площадки, где у урока бывает только анонс без видео: кнопкой «смотреть» их не
// показываем — смотреть там нечего.
const ANNOUNCEMENT_PLATFORMS = new Set(['telegram', 'max']);
