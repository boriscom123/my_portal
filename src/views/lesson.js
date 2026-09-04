// Карточка урока: описание, кнопки «смотреть на», реакции и отзывы.
// Задача — быть той страницей, ссылку на которую отправляют в мессенджер;
// поэтому заголовок, описание и обложка обязаны попасть в теги превью.
// Вызывается из src/routes/pages.js по маршруту /lesson/:slug.
import { escapeHtml } from '../lib/html.js';
import { layout } from './layout.js';
import { formatDate } from './feed.js';
import { SCALE } from '../lib/reactions.js';

// Как называются площадки на кнопках. Слаг площадки для человека не годится.
const PLATFORM_NAMES = {
  youtube: 'YouTube',
  vk: 'VK Видео',
  telegram: 'Telegram',
  rutube: 'RuTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  dzen: 'Дзен',
  max: 'MAX'
};

/**
 * Русское склонение после числа: 1 оценка, 2 оценки, 5 оценок.
 * Зачем: «3 оценок» на видном месте портала о качестве уроков читается как
 * небрежность. Вызывается из lessonPage.
 */
function plural(n, [one, few, many]) {
  const hundreds = n % 100;
  if (hundreds >= 11 && hundreds <= 14) return many;
  const ones = n % 10;
  if (ones === 1) return one;
  if (ones >= 2 && ones <= 4) return few;
  return many;
}

function commentItem(c) {
  const isPending = c.status === 'pending';
  return `<li class="comment${isPending ? ' pending' : ''}">
  <p class="comment-author">${escapeHtml(c.author.displayName)}
    ${isPending ? '<span class="badge">ждёт проверки автором</span>' : ''}</p>
  <p>${escapeHtml(c.body)}</p>
</li>`;
}

export function lessonPage({
  config,
  lesson,
  comments,
  user,
  viewerReaction = null,
  rating = { total: 0, average: null }
}) {
  const platformButtons = lesson.publications
    .filter((p) => p.url && p.state === 'published')
    .map(
      (p) =>
        `<a class="button" href="${escapeHtml(p.url)}" rel="noopener" target="_blank">Смотреть на ${escapeHtml(
          PLATFORM_NAMES[p.platform] ?? p.platform
        )}</a>`
    )
    .join('');

  // Девять ступеней подряд. Подпись уходит в title и aria-label: кнопка из
  // одного смайлика непонятна и не читается программой чтения с экрана.
  const ratingScaleHtml = SCALE.map(
    ({ value, emoji, label }) =>
      `<button type="button" class="rating-step${viewerReaction === value ? ' chosen' : ''}"
        data-rating="${value}" title="${escapeHtml(label)}"
        aria-label="${escapeHtml(value)} из 9 — ${escapeHtml(label)}">${emoji}</button>`
  ).join('');

  const ratingSummaryHtml = rating.total
    ? `<p class="rating-summary"><b>${String(rating.average).replace('.', ',')}</b> из 9 ·
       ${rating.total} ${plural(rating.total, ['оценка', 'оценки', 'оценок'])}</p>`
    : '<p class="rating-summary hint">Оценок пока нет — поставьте первую.</p>';

  return layout({
    config,
    user,
    path: `/lesson/${encodeURIComponent(lesson.slug)}`,
    title: lesson.title,
    description: lesson.description,
    image: lesson.coverUrl,
    body: `
<article class="lesson" data-lesson="${lesson.id}">
  ${
    lesson.coverUrl
      ? `<img class="lesson-cover" src="${escapeHtml(lesson.coverUrl)}" alt=""
             width="1280" height="720">`
      : ''
  }
  <p class="meta">${escapeHtml(lesson.publishedAt ? formatDate(lesson.publishedAt) : 'черновик')}</p>
  <h1>${escapeHtml(lesson.title)}</h1>
  <p class="lead">${escapeHtml(lesson.description)}</p>

  ${
    lesson.tags.length
      ? `<p class="tags">${lesson.tags
          .map((t) => `<a class="tag" href="/tag/${encodeURIComponent(t)}">${escapeHtml(t)}</a>`)
          .join(' ')}</p>`
      : ''
  }

  <div class="platforms">
    ${platformButtons || '<p class="hint">Ссылки появятся после публикации на площадках.</p>'}
  </div>

  <div class="rating">
    <p class="meta">Как вам урок?</p>
    <div class="rating-scale">${ratingScaleHtml}</div>
    ${ratingSummaryHtml}
  </div>

  <section class="comments">
    <h2>Отзывы</h2>
    <ul>${comments.map(commentItem).join('') || '<li class="hint">Пока никто не написал.</li>'}</ul>
    ${
      user
        ? `<form id="comment-form" class="card">
      <textarea name="body" rows="3" required placeholder="Что осталось непонятным?"></textarea>
      <div class="form-row">
        <span class="hint">Отзыв появится после проверки автором.</span>
        <button class="button-brand" type="submit">Отправить</button>
      </div>
    </form>`
        : '<p class="hint"><a href="/login">Войдите</a>, чтобы оставить отзыв.</p>'
    }
  </section>
</article>`
  });
}
