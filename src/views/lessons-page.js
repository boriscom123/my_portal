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
import { projectLinks } from './project-links.js';

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
  ${projectLinks(lesson.projects, '/lessons')}
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

export function lessonsPage({
  config,
  user,
  lessons,
  project = null,
  unknownProject = false
}) {
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
    // У отфильтрованного списка свой адрес: для поисковика это отдельная страница.
    path: project ? `/lessons?project=${encodeURIComponent(project.slug)}` : '/lessons',
    breadcrumbs: project
      ? [{ title: 'Уроки', href: '/lessons' }, { title: `Проект «${project.title}»` }]
      : [{ title: 'Уроки' }],
    title: project ? `Уроки проекта «${project.title}» — Solo AI Journey` : 'Уроки — Solo AI Journey',
    description: 'Все видеоуроки портала: от идеи до продукта, шаг за шагом.',
    body: `
<h1>${project ? `Уроки проекта «${escapeHtml(project.title)}»` : 'Уроки'}${
  isAdmin
    ? ` <a class="add" href="/lessons/new" title="Завести урок" aria-label="Завести урок">+</a>`
    : ''
}</h1>
${project ? '<p><a href="/lessons">все уроки</a></p>' : ''}
${unknownProject ? '<p class="hint">Такого проекта нет — показаны все уроки.</p>' : ''}
<!-- Состояние Яндекс Диска здесь больше не показывается: оно живёт в
     настройках, рядом с самим подключением. В списке уроков это была строка,
     которая ничего не давала сделать. -->

<!-- Отдельного блока серий здесь нет: серия видна на карточке урока строкой
     «Серия «…» · урок N из M», а второй раз её показывать незачем. -->

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
