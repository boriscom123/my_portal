// Раздел «Уроки».
//
// Задача — одно место, где зритель видит все уроки, а автор их заводит и
// убирает. Одна страница на обоих намеренно: раньше их было две — публичной не
// было вовсе, а кабинетная жила по своему адресу, — и они неизбежно разошлись
// бы в мелочах.
// Вызывается из src/routes/pages.js по адресу /lessons.
import { escapeHtml } from '../lib/html.js';
import { layout } from './layout.js';
import { stateLabel } from './lesson-state.js';
import { formatDate } from './feed.js';

/** Русское склонение после числа: 1 урок, 2 урока, 5 уроков. */
function plural(n, [one, few, many]) {
  const hundreds = n % 100;
  if (hundreds >= 11 && hundreds <= 14) return many;
  const ones = n % 10;
  if (ones === 1) return one;
  if (ones >= 2 && ones <= 4) return few;
  return many;
}

/**
 * Урок карточкой — так же, как новость в своём разделе.
 * Значок правки ведёт на экран урока: там и поля, и обработка, и площадки.
 * Отдельной кнопки «Обработка» больше нет — она вела туда же, а два входа в
 * одно место заставляют выбирать там, где выбора нет.
 */
function lessonCard(lesson, isAdmin) {
  const state = stateLabel(lesson);
  const published = lesson.status === 'published';
  const link = `/lesson/${encodeURIComponent(lesson.slug)}`;

  return `<article class="card news-card">
  <p class="meta">
    ${published ? escapeHtml(formatDate(lesson.publishedAt)) : '<span class="badge">черновик</span>'}
    ${
      isAdmin && state
        ? ` · <span class="badge${lesson.pipelineState === 'failed' ? ' danger' : ''}">${escapeHtml(state)}</span>`
        : ''
    }
  </p>
  <h2><a href="${link}">${escapeHtml(lesson.title)}</a>${
    isAdmin
      ? ` <a class="edit" href="/admin/lesson/${encodeURIComponent(lesson.slug)}"
             title="Открыть урок" aria-label="Открыть урок">✎</a>`
      : ''
  }</h2>
  <!-- Обложка — как картинка у новости. Своей нет — фирменный градиент, а не
       дыра: карточки в списке иначе скакали бы по высоте. Ссылка дублирует
       заголовок, поэтому из порядка табуляции и для чтеца экрана убрана. -->
  <a class="lesson-list-cover" href="${link}" tabindex="-1" aria-hidden="true">${
    lesson.coverUrl
      ? `<img class="cover" src="${escapeHtml(lesson.coverUrl)}" alt="" loading="lazy">`
      : '<div class="cover button-brand"></div>'
  }</a>
  ${
    lesson.description
      ? `<p class="card-text">${escapeHtml(lesson.description).slice(0, 400)}</p>`
      : ''
  }
  ${
    // Внизу — место в серии: пришедший на середину курса видит, что урок не
    // сам по себе, и одним нажатием попадает ко всему порядку.
    lesson.series
      ? `<p class="meta series-line">Серия «<a href="/series/${encodeURIComponent(
          lesson.series.slug
        )}">${escapeHtml(lesson.series.title)}</a>» · урок ${lesson.series.number} из ${
          lesson.series.total
        }</p>`
      : ''
  }
</article>`;
}

export function lessonsPage({ config, user, lessons, series = [], diskConnected = false }) {
  const isAdmin = user?.role === 'admin';
  // Пока что-то считается, страница перечитывается сама: иначе автор смотрит
  // на «обрабатывается» и жмёт перезагрузку вручную каждые полминуты. Форма
  // заведения урока при этом пустая — стирать нечего.
  const busy = lessons.some((lesson) =>
    ['uploading', 'processing'].includes(lesson.pipelineState)
  );

  return layout({
    refreshSeconds: busy ? 20 : null,
    config,
    user,
    path: '/lessons',
    title: 'Уроки — Solo AI Journey',
    description: 'Все видеоуроки портала: от идеи до продукта, шаг за шагом.',
    body: `
<h1>Уроки${
  isAdmin
    ? ` <a class="add" href="/lessons/new" title="Завести урок" aria-label="Завести урок">+</a>`
    : ''
}</h1>
${
  isAdmin
    ? `<p class="hint">
  Яндекс Диск: ${
    diskConnected
      ? 'подключён — записи можно брать оттуда'
      : '<a href="/admin/upload">не подключён</a>'
  }
</p>`
    : ''
}



${
  series.length
    ? `<section class="series-block">
  <h2>Серии</h2>
  <p class="hint">Уроки, которые идут по порядку: с первого до последнего.</p>
  <ul class="series-list">${series
    .map(
      (item) => `<li>
    <a href="/series/${encodeURIComponent(item.slug)}">${escapeHtml(item.title)}</a>
    <span class="meta">${item.lessonCount} ${plural(item.lessonCount, [
      'урок',
      'урока',
      'уроков'
    ])}</span>
  </li>`
    )
    .join('')}</ul>
</section>`
    : ''
}

${
  lessons.length
    ? lessons.map((lesson) => lessonCard(lesson, isAdmin)).join('')
    : `<p class="hint">${
        isAdmin ? 'Уроков пока нет. Заведите первый — плюсом в заголовке.' : 'Уроков пока нет.'
      }</p>`
}
`
  });
}
