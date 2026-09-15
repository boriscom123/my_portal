// Карточка урока: описание, кнопки «смотреть на», реакции и отзывы.
// Задача — быть той страницей, ссылку на которую отправляют в мессенджер;
// поэтому заголовок, описание и обложка обязаны попасть в теги превью.
// Вызывается из src/routes/pages.js по маршруту /lesson/:slug.
import { escapeHtml } from '../lib/html.js';
import { platformLinks } from './platform-links.js';
import { projectLinks } from './project-links.js';
import { layout } from './layout.js';
import { formatDate } from './feed.js';
import { seriesBlock, relatedBlock } from './series.js';
import { SCALE } from '../lib/reactions.js';

// Как называются площадки на кнопках. Слаг площадки для человека не годится.

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
  rating = { total: 0, average: null },
  seriesNav = null,
  related = []
}) {
  const platformButtons = platformLinks(lesson.publications);

  // Девять ступеней подряд. Подпись уходит в title и aria-label: кнопка из
  // одного смайлика непонятна и не читается программой чтения с экрана.
  const ratingScaleHtml = SCALE.map(
    ({ value, emoji, label }) =>
      `<button type="button" class="rating-step${viewerReaction === value ? ' chosen' : ''}"
        data-rating="${value}" title="${escapeHtml(label)}"
        aria-label="${escapeHtml(value)} из 9 — ${escapeHtml(label)}">${emoji}</button>`
  ).join('');

  // Итог — в процентах от низа шкалы: 1 — 0%, 5 — 50%, 9 — 100%. «7,5 из 9»
  // читалось хуже, а доля от максимума давала бы низу шкалы странные 11%.
  const ratingPercent = Math.round(((rating.average - 1) / 8) * 100);
  const ratingSummaryHtml = rating.total
    ? `<p class="rating-summary"><b>${ratingPercent}%</b> ·
       ${rating.total} ${plural(rating.total, ['оценка', 'оценки', 'оценок'])}</p>`
    : '<p class="rating-summary hint">Оценок пока нет — поставьте первую.</p>';

  return layout({
    config,
    user,
    path: `/lesson/${encodeURIComponent(lesson.slug)}`,
    // Урок в серии — с серией в цепочке: пришедший на середину курса видит, где
    // он, и одним нажатием попадает ко всему порядку.
    breadcrumbs: [
      { title: 'Уроки', href: '/lessons' },
      ...(seriesNav?.series
        ? [
            {
              title: `Серия «${seriesNav.series.title}»`,
              href: `/series/${encodeURIComponent(seriesNav.series.slug)}`
            }
          ]
        : []),
      { title: lesson.title }
    ],
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
  ${projectLinks(lesson.projects, '/lessons')}
  <h1>${escapeHtml(lesson.title)}${
    // Автору — значок правки у заголовка, как на странице новости: ведёт на
    // экран урока, где и поля, и обработка, и площадки.
    user?.role === 'admin'
      ? ` <a class="edit" href="/admin/lesson/${encodeURIComponent(lesson.slug)}"
         title="Открыть урок" aria-label="Открыть урок">✎</a>`
      : ''
  }</h1>
  ${
    // Где урок в курсе — сразу под заголовком, той же строкой, что на карточке
    // в «Уроках», а не только в блоке серии внизу страницы.
    seriesNav?.number
      ? `<p class="meta series-line">Серия «<a href="/series/${encodeURIComponent(
          seriesNav.series.slug
        )}">${escapeHtml(seriesNav.series.title)}</a>» · урок ${seriesNav.number} из ${seriesNav.total}</p>`
      : ''
  }
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

  <!-- Отзывы — сразу под оценкой: мысль об уроке приходит, пока его оценивают,
       а внизу, за серией и похожими, форма терялась. -->
  <!-- Без заголовка и без подписи «пока никто не написал»: оценка и отзыв —
       одно действие, заголовок его разрывал, а пустая подпись занимала место.
       Список появляется, когда отзывы есть. -->
  <section class="comments">
    ${comments.length ? `<ul>${comments.map(commentItem).join('')}</ul>` : ''}
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

  ${seriesBlock(seriesNav)}
  ${relatedBlock(related)}
</article>`
  });
}
