// Просмотр урока с субтитрами перед публикацией.
//
// Задача — дать автору увидеть, как подписи ложатся на запись, не скачивая
// исходник. Полчаса видео весит полгигабайта, и «скачайте и посмотрите в
// плеере» — это полчаса ожидания ради проверки, которая занимает минуту.
// Браузер тянет файл кусками по мере перемотки, а дорожку субтитров
// накладывает сам: вшивать их ради просмотра незачем.
// Вызывается из src/routes/pages.js по адресу /admin/lesson/:slug/preview.
import { escapeHtml } from '../lib/html.js';
import { layout } from './layout.js';

export function adminPreviewPage({ config, user, lesson, videoUrl, subtitlesUrl }) {
  return layout({
    config,
    user,
    path: `/admin/lesson/${lesson.slug}/preview`,
    title: `Просмотр: ${lesson.title} — Solo AI Journey`,
    description: 'Просмотр урока с субтитрами перед публикацией.',
    body: `
<nav class="admin-nav">
  <a class="button" href="/admin/lesson/${encodeURIComponent(lesson.slug)}">← К проверке</a>
</nav>

<h1>${escapeHtml(lesson.title)}</h1>
<p class="hint">
  Запись из рабочего буфера с дорожкой субтитров. Подписи включаются кнопкой в
  плеере. Ссылки живут час — если плеер перестал отвечать, обновите страницу.
</p>

${
  videoUrl
    ? `<video class="preview-video" controls preload="metadata" playsinline
         ${lesson.coverUrl ? `poster="${escapeHtml(lesson.coverUrl)}"` : ''}>
  <source src="${escapeHtml(videoUrl)}">
  ${
    subtitlesUrl
      ? `<track kind="subtitles" srclang="ru" label="Русские субтитры"
              src="${escapeHtml(subtitlesUrl)}" default>`
      : ''
  }
  Ваш браузер не умеет показывать видео.
</video>
${
  subtitlesUrl
    ? ''
    : '<p class="hint danger">Субтитров ещё нет — показывается только запись.</p>'
}`
    : '<p class="hint danger">Исходника нет в буфере: он удалён по сроку или ещё не загружен.</p>'
}`
  });
}
