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
import { assetUrl } from '../lib/assets.js';

function lessonRow(lesson, isAdmin) {
  const state = stateLabel(lesson);
  const published = lesson.status === 'published';

  return `<li class="admin-lesson">
  <div class="grow">
    <h3><a href="/lesson/${encodeURIComponent(lesson.slug)}">${escapeHtml(lesson.title)}</a></h3>
    <p class="meta">
      ${published ? escapeHtml(formatDate(lesson.publishedAt)) : 'черновик'}
      ${
        isAdmin
          ? ` · <span class="meta">/${escapeHtml(lesson.slug)}</span>${
              state
                ? ` · <span class="badge${lesson.pipelineState === 'failed' ? ' danger' : ''}">${escapeHtml(state)}</span>`
                : ''
            }`
          : ''
      }
    </p>
  </div>
  ${
    isAdmin
      ? `<div class="actions">
    <a class="button" href="/admin/lesson/${encodeURIComponent(lesson.slug)}">Обработка</a>
    ${
      published
        ? '<span class="badge" title="Опубликованный урок сначала снимают с витрины">на витрине</span>'
        : `<button class="button" type="button"
             data-lesson-delete="${escapeHtml(lesson.slug)}">Удалить</button>`
    }
  </div>`
      : ''
  }
</li>`;
}

export function lessonsPage({ config, user, lessons, diskConnected = false }) {
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
<h1>Уроки</h1>
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
  isAdmin
    ? `<section class="card">
  <h2>Завести урок</h2>
  <form id="new-lesson-form" data-new-lesson>
    <div class="form-row">
      <button class="button-brand" type="submit">Завести урок</button>
    </div>
  </form>
  <p class="hint">
    Название спрашивать нечего: на этом шаге его неоткуда взять. Урок получит
    временное имя с датой, а настоящее предложит модель по расшифровке — и вы
    его поправите. Дальше: загрузить запись, потом нажать «Обработать».
  </p>
</section>`
    : ''
}

${
  lessons.length
    ? `<ul class="admin-lessons">${lessons.map((lesson) => lessonRow(lesson, isAdmin)).join('')}</ul>`
    : `<p class="hint">${
        isAdmin ? 'Уроков пока нет. Заведите первый — форма выше.' : 'Уроков пока нет.'
      }</p>`
}

${isAdmin ? `<script src="${assetUrl('/admin.js')}" type="module"></script>` : ''}`
  });
}
