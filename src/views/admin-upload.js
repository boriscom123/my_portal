// Страница загрузки исходника.
//
// Задача — дать автору положить файл в обработку двумя способами: выбрать на
// компьютере или взять с Яндекс Диска. Зачем полоса выполнения обязательна:
// гигабайтный файл идёт минутами, и страница без признаков жизни выглядит
// зависшей — человек закрывает вкладку и теряет уже загруженное.
// Вызывается из src/routes/pages.js по адресу /admin/upload.
import { escapeHtml } from '../lib/html.js';
import { layout } from './layout.js';

export function adminUploadPage({ config, user, lessons, diskConnected = false }) {
  const options = lessons
    .map((lesson) => `<option value="${lesson.id}">${escapeHtml(lesson.title)}</option>`)
    .join('');

  return layout({
    config,
    user,
    path: '/admin/upload',
    title: 'Загрузка урока — Solo AI Journey',
    description: 'Загрузка исходника урока в обработку.',
    body: `
<h1>Загрузка урока</h1>
<p class="lead">Файл идёт кусками: если связь оборвётся, загрузка продолжится
с места обрыва, а не с начала. Вкладку можно свернуть, но не закрывать.</p>

${
  lessons.length
    ? ''
    : '<p class="hint">Уроков пока нет — сначала заведите урок, потом загружайте файл.</p>'
}

<form id="upload-form" class="card">
  <label>Урок
    <select name="lessonId" required>
      ${options || '<option value="">сначала заведите урок</option>'}
    </select>
  </label>

  <label>Файл с компьютера
    <input type="file" name="file" accept="video/*" required>
  </label>

  <div class="form-row">
    <span class="hint" id="upload-status">Файл не выбран</span>
    <button class="button-brand" type="submit">Загрузить</button>
  </div>
  <progress id="upload-progress" max="100" value="0" hidden></progress>
</form>

<section class="card" id="disk-block">
  <h2>С Яндекс Диска</h2>
  ${
    diskConnected
      ? `<p class="hint">Сервер заберёт файл сам — ноутбук можно закрыть сразу.</p>
         <ul id="disk-files"><li class="hint">Читаю список…</li></ul>`
      : `<p class="hint">Быстрее, чем с компьютера: сервер заберёт файл напрямую,
         минуя ваш домашний канал. Исходники при этом остаются у вас на Диске.</p>
         <p><a class="button-brand" href="/api/integrations/yandex-disk/connect">Подключить Диск</a></p>`
  }
</section>

<script src="/admin.js" type="module"></script>`
  });
}
