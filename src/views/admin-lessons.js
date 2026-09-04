// Раздел кабинета: уроки.
//
// Задача — одно место, где автор заводит урок, видит все заведённые и убирает
// лишние. Раньше урок заводился запросом к API вручную, а убрать его было
// нельзя вовсе: неудачный черновик оставался в списке навсегда вместе с
// полугигабайтом исходника в буфере.
// Вызывается из src/routes/pages.js по адресу /admin/lessons.
import { escapeHtml } from '../lib/html.js';
import { layout } from './layout.js';
import { stateLabel } from './lesson-state.js';
import { formatDate } from './feed.js';

function lessonRow(lesson) {
  const state = stateLabel(lesson);
  const published = lesson.status === 'published';

  return `<li class="admin-lesson">
  <div class="grow">
    <h3><a href="/admin/lesson/${encodeURIComponent(lesson.slug)}">${escapeHtml(lesson.title)}</a></h3>
    <p class="meta">
      ${published ? escapeHtml(formatDate(lesson.publishedAt)) : 'черновик'}
      · <span class="meta">/${escapeHtml(lesson.slug)}</span>
      ${state ? ` · <span class="badge${lesson.pipelineState === 'failed' ? ' danger' : ''}">${escapeHtml(state)}</span>` : ''}
    </p>
  </div>
  <div class="actions">
    <a class="button" href="/admin/lesson/${encodeURIComponent(lesson.slug)}">Открыть</a>
    ${
      published
        ? '<span class="badge" title="Опубликованный урок сначала снимают с витрины">на витрине</span>'
        : `<button class="button" type="button"
             data-lesson-delete="${escapeHtml(lesson.slug)}">Удалить</button>`
    }
  </div>
</li>`;
}

export function adminLessonsPage({ config, user, lessons, diskConnected = false }) {
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
    path: '/admin/lessons',
    title: 'Уроки — Solo AI Journey',
    description: 'Список уроков: завести новый, открыть или убрать черновик.',
    body: `
<h1>Уроки</h1>

<p class="hint">
  Яндекс Диск: ${
    diskConnected
      ? 'подключён — записи можно брать оттуда'
      : '<a href="/admin/upload">не подключён</a>'
  }
</p>

<section class="card">
  <h2>Завести урок</h2>
  <form id="new-lesson-form" data-new-lesson>
    <label>Заголовок
      <input name="title" required maxlength="200"
        placeholder="Можно черновой — поправите после расшифровки">
    </label>
    <div class="form-row">
      <button class="button-brand" type="submit">Завести</button>
    </div>
  </form>
  <p class="hint">
    Адрес урока соберётся из заголовка сам. Дальше загрузите запись — с
    компьютера или с Яндекс Диска, — и конвейер сделает остальное.
  </p>
</section>

${
  lessons.length
    ? `<ul class="admin-lessons">${lessons.map(lessonRow).join('')}</ul>`
    : '<p class="hint">Уроков пока нет. Заведите первый — форма выше.</p>'
}`
  });
}
