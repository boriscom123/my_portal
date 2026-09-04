// Кабинет автора.
//
// Задача — собрать в одном месте всё, что автор делает с уроками: список,
// состояние обработки, переходы к загрузке и проверке. Зачем: без него адреса
// приходится помнить наизусть, а состояние урока — искать в журнале
// контейнера, до которого с телефона не добраться.
// Вызывается из src/routes/pages.js по адресу /admin.
import { escapeHtml } from '../lib/html.js';
import { layout } from './layout.js';
import { formatDate } from './feed.js';

// Что происходит с уроком — словами. «processing» на экране не объясняет
// ничего человеку, который зашёл посмотреть, готово ли.
export const PIPELINE_LABELS = {
  idle: '',
  uploading: 'загружается',
  processing: 'обрабатывается',
  review: 'ждёт проверки',
  failed: 'обработка упала'
};

// Что именно сейчас считается. Расшифровка часового урока идёт полчаса, и
// «обрабатывается» всё это время не отвечает на единственный вопрос автора —
// далеко ли до конца. Заказчик уже жаловался ровно на это: «отобразилось
// сообщение — и всё, больше ничего не происходит».
export const STEP_LABELS = {
  fetchSource: 'скачивается с Диска',
  extractAudio: 'извлекается звук',
  transcribe: 'распознаётся речь',
  subtitles: 'собираются субтитры',
  makeCover: 'выбирается обложка',
  makeClips: 'режутся вертикальные ролики'
};

/** Состояние урока словами: с названием шага, если он известен. */
export function stateLabel(lesson) {
  const base = PIPELINE_LABELS[lesson.pipelineState] ?? lesson.pipelineState;
  if (lesson.pipelineState !== 'processing') return base;
  const step = STEP_LABELS[lesson.pipelineJob?.name];
  return step ? `${base}: ${step}` : base;
}

function lessonRow(lesson) {
  const state = stateLabel(lesson);
  const published = lesson.status === 'published';

  return `<li class="admin-lesson">
  <div class="grow">
    <h3><a href="/lesson/${encodeURIComponent(lesson.slug)}">${escapeHtml(lesson.title)}</a></h3>
    <p class="meta">
      ${published ? escapeHtml(formatDate(lesson.publishedAt)) : 'черновик'}
      ${state ? ` · <span class="badge${lesson.pipelineState === 'failed' ? ' danger' : ''}">${escapeHtml(state)}</span>` : ''}
    </p>
    ${lesson.pipelineError ? `<p class="hint danger">${escapeHtml(lesson.pipelineError)}</p>` : ''}
  </div>
  <div class="actions">
    ${
      lesson.pipelineState === 'review'
        ? `<a class="button-brand" href="/admin/lesson/${encodeURIComponent(lesson.slug)}">Проверить</a>`
        : `<a class="button" href="/admin/lesson/${encodeURIComponent(lesson.slug)}">Открыть</a>`
    }
  </div>
</li>`;
}

export function adminHomePage({ config, user, lessons, diskConnected }) {
  // Пока что-то считается, страница обновляется сама: иначе автор смотрит на
  // «обрабатывается» и жмёт перезагрузку вручную каждые полминуты. Форм на
  // этой странице нет, поэтому обновление ничего не сотрёт.
  const busy = lessons.some((lesson) =>
    ['uploading', 'processing'].includes(lesson.pipelineState)
  );

  return layout({
    refreshSeconds: busy ? 20 : null,
    config,
    user,
    path: '/admin',
    title: 'Кабинет — Solo AI Journey',
    description: 'Кабинет автора: уроки, загрузка, обработка.',
    body: `
<h1>Кабинет</h1>

<nav class="admin-nav">
  <a class="button-brand" href="/admin/upload">Загрузить урок</a>
  <a class="button" href="/ideas">Идеи зрителей</a>
  <a class="button" href="/">Витрина</a>
</nav>

<p class="hint">
  Яндекс Диск: ${
    diskConnected
      ? 'подключён — файлы можно брать оттуда'
      : '<a href="/admin/upload">не подключён</a>'
  }
</p>

<h2>Уроки</h2>
${
  lessons.length
    ? `<ul class="admin-lessons">${lessons.map(lessonRow).join('')}</ul>`
    : '<p class="hint">Заведите первый урок — и его можно будет загрузить в обработку.</p>'
}`
  });
}
