// Страница загрузки исходника.
//
// Задача — дать автору положить запись на сайт двумя способами: выбрать на
// компьютере или взять с Яндекс Диска. Запись только копируется: обработку
// автор запускает отдельно, на экране урока.
//
// Урок приходит адресом в запросе, когда автор пришёл сюда со своего урока:
// выбирать из списка то, что он только что открыл, — лишний шаг и лишний повод
// ошибиться. Список остаётся для случая, когда страницу открыли сами по себе.
// Зачем полоса выполнения обязательна:
// гигабайтный файл идёт минутами, и страница без признаков жизни выглядит
// зависшей — человек закрывает вкладку и теряет уже загруженное.
// Вызывается из src/routes/pages.js по адресу /admin/upload.
import { escapeHtml } from '../lib/html.js';
import { assetUrl } from '../lib/assets.js';
import { layout } from './layout.js';

export function adminUploadPage({
  config,
  user,
  lessons,
  diskConnected = false,
  youtubeConnected = false,
  youtubeConfigured = false,
  lesson = null,
  copying = false,
  source = null
}) {
  const options = lessons
    .map((item) => `<option value="${item.id}">${escapeHtml(item.title)}</option>`)
    .join('');

  return layout({
    config,
    user,
    path: '/admin/upload',
    title: 'Загрузка урока — Solo AI Journey',
    description: 'Загрузка исходника урока в обработку.',
    body: `
<nav class="admin-nav">
  ${
    lesson
      ? `<a class="button" href="/admin/lesson/${encodeURIComponent(lesson.slug)}">← К уроку</a>`
      : '<a class="button" href="/lessons">← Уроки</a>'
  }
</nav>

<h1>Загрузка записи</h1>
${
  lesson
    ? `<p class="lead">
         Урок: <a href="/admin/lesson/${encodeURIComponent(lesson.slug)}">${escapeHtml(lesson.title)}</a>.
         Запись только скопируется на сайт — обработку запустите там же кнопкой.
       </p>`
    : '<p class="lead">Запись только скопируется на сайт — обработку запустите на экране урока.</p>'
}

${
  lesson
    ? // Главное, ради чего сюда заходят второй раз: есть уже запись или нет.
      // Без этой строки страница молчит о том, чем кончилась прошлая попытка.
      `<p class="card${source ? '' : ' hint'}" data-source-state>
         ${
           source
             ? `Запись на сайте: ${escapeHtml(source.name)}, ${escapeHtml(source.size)}.
                Новая заменит её.
                <a href="/admin/lesson/${encodeURIComponent(lesson.slug)}">Открыть урок</a>`
             : copying
               ? 'Копирую запись с Диска — это минуты.'
               : 'Записи у урока пока нет.'
         }
       </p>`
    : ''
}
<p class="lead">Файл идёт кусками: если связь оборвётся, загрузка продолжится
с места обрыва, а не с начала. Вкладку можно свернуть, но не закрывать.</p>

${
  lessons.length
    ? ''
    : '<p class="hint">Уроков пока нет — сначала заведите урок, потом загружайте файл.</p>'
}

<form id="upload-form" class="card">
  ${
    lesson
      ? // Урок уже известен: спрашивать его второй раз незачем.
        `<input type="hidden" name="lessonId" value="${lesson.id}">`
      : `<label>Урок
    <select name="lessonId" required>
      ${options || '<option value="">сначала заведите урок</option>'}
    </select>
  </label>`
  }

  <label>Файл с компьютера
    <input type="file" name="file" accept="video/*" required>
  </label>

  <div class="form-row">
    <span class="hint" id="upload-status">Файл не выбран</span>
    <button class="button-brand" type="submit">Загрузить</button>
  </div>
  <progress id="upload-progress" max="100" value="0" hidden></progress>
</form>

<section class="card" id="disk-block"
  ${
    copying
      ? // Копирование началось раньше этой загрузки страницы: человек обновил
        // её или вернулся позже. Пометка даёт скрипту подхватить ожидание.
        `data-copy-watch="${escapeHtml(lesson.slug)}"`
      : ''
  }>
  <h2>С Яндекс Диска</h2>
  ${
    diskConnected
      ? `<p class="hint">Сервер заберёт файл сам — ноутбук можно закрыть сразу.</p>
         <ul id="disk-files"><li class="hint">Читаю список…</li></ul>`
      : `<p class="hint">Быстрее, чем с компьютера: сервер заберёт файл напрямую,
         минуя ваш домашний канал. Исходники при этом остаются у вас на Диске.</p>
         <ol class="steps">
           <li><a class="button-brand" href="/api/integrations/yandex-disk/connect"
                  target="_blank" rel="noopener">Открыть согласие Яндекса</a></li>
           <li>Разрешить доступ и скопировать код, который покажет Яндекс.</li>
           <li>Вставить код сюда:
             <form id="disk-code-form" class="form-row">
               <input name="code" inputmode="numeric" autocomplete="off"
                      placeholder="код подтверждения" required>
               <button class="button" type="submit">Подключить</button>
             </form>
           </li>
         </ol>
         <p class="hint">Код живёт несколько минут: если не успели — возьмите новый.</p>`
  }
</section>

<section class="card">
  <h2>YouTube</h2>
  ${
    !youtubeConfigured
      ? `<p class="hint">Площадка не настроена: в окружении нет ключей приложения
           Google. Как их завести — в docs/youtube-setup.md.</p>`
      : youtubeConnected
        ? `<p class="hint">Канал подключён. Отправить урок можно с его экрана
             проверки — кнопкой «Отправить на YouTube».</p>`
        : `<p class="hint">Портал зальёт запись, субтитры и обложку сам. Открыть
             ролик придётся вам: до проверки приложения в Google ролики,
             загруженные через API, принудительно остаются приватными.</p>
           <p class="form-row">
             <a class="button-brand" href="/api/integrations/youtube/connect?from=/admin/upload">
               Подключить YouTube
             </a>
           </p>`
  }
</section>

<script src="${assetUrl('/admin.js')}" type="module"></script>`
  });
}
