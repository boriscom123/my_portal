// Серия уроков: страница серии и блоки связей под уроком.
//
// Задача — показать зрителю, что урок не сам по себе: перед ним есть
// предыдущий, за ним следующий, а рядом — похожие. Человек, пришедший из
// поиска на середину курса, иначе посмотрит один ролик и уйдёт, так и не
// узнав, что остальное существует.
// Вызывается из src/views/lesson.js и src/routes/pages.js.
import { escapeHtml } from '../lib/html.js';
import { layout } from './layout.js';
import { formatDate } from './feed.js';

/** Обложка карточки. Нет своей — фирменный градиент, а не серая заглушка. */
function cover(lesson) {
  return lesson.coverUrl
    ? `<img class="cover" src="${escapeHtml(lesson.coverUrl)}" alt="" loading="lazy">`
    : '<div class="cover button-brand"></div>';
}

/**
 * Короткая карточка урока для блоков связей.
 * badge — «Следующий», «Урок 2» и прочее: без него три одинаковых карточки под
 * уроком не объясняют, чем они друг от друга отличаются.
 */
export function lessonMiniCard(lesson, badge = '') {
  const link = `/lesson/${encodeURIComponent(lesson.slug)}`;
  return `<article class="lesson-card">
  <a href="${link}">${cover(lesson)}</a>
  <div class="card-body">
    <p class="meta">${
      badge ? `<span class="badge">${escapeHtml(badge)}</span> · ` : ''
    }${escapeHtml(lesson.publishedAt ? formatDate(lesson.publishedAt) : 'черновик')}</p>
    <h3><a href="${link}">${escapeHtml(lesson.title)}</a></h3>
    <p class="card-text">${escapeHtml(lesson.description).slice(0, 160)}</p>
  </div>
</article>`;
}

/**
 * Блок «Дальше по серии» под уроком.
 * Следующий урок стоит первым и с пометкой: он и есть то, ради чего блок.
 * Предыдущий — следом, для пришедшего из поиска на середину.
 */
export function seriesBlock(navigation) {
  if (!navigation?.number) return '';
  const { series, number, total, previous, next } = navigation;
  const cards = [
    next ? lessonMiniCard(next, 'следующий') : '',
    previous ? lessonMiniCard(previous, 'предыдущий') : ''
  ].join('');

  return `<section class="series-block">
  <h2>Серия «${escapeHtml(series.title)}»</h2>
  <p class="meta">
    Урок ${number} из ${total} ·
    <a href="/series/${encodeURIComponent(series.slug)}">вся серия по порядку</a>
  </p>
  ${
    cards
      ? `<div class="lessons-grid">${cards}</div>`
      : `<p class="hint">Пока это единственный вышедший урок серии — следующий будет здесь.</p>`
  }
</section>`;
}

/** Блок «Похожие уроки». Пустой не показывается: незачем занимать место. */
export function relatedBlock(lessons = []) {
  if (!lessons.length) return '';
  return `<section class="series-block">
  <h2>Похожие уроки</h2>
  <div class="lessons-grid">${lessons.map((lesson) => lessonMiniCard(lesson)).join('')}</div>
</section>`;
}

/** Строка урока в списке серии: с номером, а у автора — со стрелками. */
function seriesRow(lesson, index, total, isAdmin) {
  return `<li class="admin-lesson">
  <div class="grow">
    <h3><span class="series-number">${index + 1}.</span>
      <a href="/lesson/${encodeURIComponent(lesson.slug)}">${escapeHtml(lesson.title)}</a></h3>
    <p class="meta">${escapeHtml(
      lesson.publishedAt ? formatDate(lesson.publishedAt) : 'черновик'
    )}</p>
  </div>
  ${
    isAdmin
      ? `<div class="actions">
    <button class="button" type="button" title="Выше" aria-label="Поднять урок в серии"
      data-series-move="up" value="${escapeHtml(lesson.slug)}"
      ${index === 0 ? 'disabled' : ''}>↑</button>
    <button class="button" type="button" title="Ниже" aria-label="Опустить урок в серии"
      data-series-move="down" value="${escapeHtml(lesson.slug)}"
      ${index === total - 1 ? 'disabled' : ''}>↓</button>
  </div>`
      : ''
  }
</li>`;
}

/** Страница серии: описание и все её уроки по порядку. */
export function seriesPage({ config, user, series }) {
  const isAdmin = user?.role === 'admin';
  const lessons = series.lessons ?? [];

  return layout({
    config,
    user,
    path: `/series/${series.slug}`,
    title: `${series.title} — Solo AI Journey`,
    description: series.description || `Серия уроков «${series.title}» по порядку.`,
    body: `
<p><a href="/lessons">← Уроки</a></p>
<h1>${escapeHtml(series.title)}</h1>
${series.description ? `<p class="lead">${escapeHtml(series.description)}</p>` : ''}
<p class="meta">${lessons.length} ${plural(lessons.length, ['урок', 'урока', 'уроков'])} по порядку</p>

${
  lessons.length
    ? `<ul class="admin-lessons">${lessons
        .map((lesson, index) => seriesRow(lesson, index, lessons.length, isAdmin))
        .join('')}</ul>`
    : '<p class="hint">В серии пока нет вышедших уроков.</p>'
}

${
  isAdmin
    ? `<section class="card">
  <h2>Серия</h2>
  <form data-series-form="${escapeHtml(series.slug)}">
    <label>Название
      <input name="title" value="${escapeHtml(series.title)}" maxlength="200" required>
    </label>
    <label>Описание
      <textarea name="description" rows="3" maxlength="1000">${escapeHtml(
        series.description
      )}</textarea>
    </label>
    <p class="hint">
      Порядок уроков задаётся стрелками в списке выше. Урок попадает в серию на
      своём экране обработки — там же его оттуда и убирают.
    </p>
    <div class="form-row">
      <button class="button-brand" type="submit">Сохранить</button>
      <button class="button" type="button"
        data-series-delete="${escapeHtml(series.slug)}">Удалить серию</button>
    </div>
  </form>
</section>`
    : ''
}`
  });
}

/** Русское склонение после числа. Своё, чтобы не тянуть его из карточки урока. */
function plural(n, [one, few, many]) {
  const hundreds = n % 100;
  if (hundreds >= 11 && hundreds <= 14) return many;
  const ones = n % 10;
  if (ones === 1) return one;
  if (ones >= 2 && ones <= 4) return few;
  return many;
}
