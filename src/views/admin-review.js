// Экран проверки урока.
//
// Задача — дать автору увидеть всё, что конвейер сделал с записью, и решить:
// публиковать, доработать или повторить упавший шаг. Зачем обязательный ручной
// шаг: спека прямо запрещает выпускать урок наружу без нажатия человека —
// расшифровка ошибается в именах и терминах, а обложка иногда попадает на
// кадр с пустым экраном.
// Вызывается из src/routes/pages.js по адресу /admin/lesson/:slug.
import { escapeHtml } from '../lib/html.js';
import { assetUrl } from '../lib/assets.js';
import { layout } from './layout.js';
import { stateLabel } from './admin-home.js';
import { readSettings } from '../lib/settings.js';
import { timeLabel } from './search.js';

/** Байты человеку. Гигабайты для исходника, мегабайты для остального. */
export function humanBytes(bytes) {
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} ГБ` : `${mb.toFixed(1)} МБ`;
}

/** Длительность человеку: 1:05:30, а не 3930 секунд. */
export function humanDuration(seconds) {
  if (!seconds) return '—';
  const parts = [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60];
  return parts
    .slice(parts[0] ? 0 : 1)
    .map((value, index) => (index ? String(value).padStart(2, '0') : String(value)))
    .join(':');
}

function assetRow(asset) {
  return `<li class="form-row">
  <span>${escapeHtml(asset.kind)} <span class="meta">${escapeHtml(asset.path)}</span></span>
  <span class="meta">${humanBytes(asset.bytes)} · до ${escapeHtml(asset.expiresLabel)}</span>
</li>`;
}

export function adminReviewPage({
  config,
  user,
  lesson,
  assets,
  transcript,
  segments = [],
  covers = [],
  links
}) {
  const state = stateLabel(lesson);
  const failed = lesson.pipelineState === 'failed';
  const settings = readSettings(lesson.settings);
  // Пока конвейер работает, вторую пересборку запускать нельзя: она заняла бы
  // те же два ядра и обогнала бы первую — файлы переписывались бы вперемешку.
  const busy = ['uploading', 'processing'].includes(lesson.pipelineState);

  return layout({
    config,
    user,
    path: `/admin/lesson/${lesson.slug}`,
    title: `Проверка: ${lesson.title} — Solo AI Journey`,
    description: 'Экран проверки урока перед публикацией.',
    body: `
<nav class="admin-nav">
  <a class="button" href="/admin">← Кабинет</a>
  <a class="button-brand" href="/admin/lesson/${encodeURIComponent(lesson.slug)}/preview">Смотреть с субтитрами</a>
  <a class="button" href="/lesson/${encodeURIComponent(lesson.slug)}">Как видит зритель</a>
</nav>

<h1>${escapeHtml(lesson.title)}</h1>
<p class="meta">
  ${lesson.status === 'published' ? 'опубликован' : 'черновик'}
  ${state ? ` · <span class="badge${failed ? ' danger' : ''}">${escapeHtml(state)}</span>` : ''}
  · ${escapeHtml(humanDuration(lesson.durationSeconds))}
</p>

${
  failed
    ? `<section class="card danger-card">
  <h2>Обработка упала</h2>
  <p class="hint danger">${escapeHtml(lesson.pipelineError ?? 'причина не записана')}</p>
  ${
    lesson.pipelineJob
      ? `<p class="hint">Повтор запустит шаг «${escapeHtml(lesson.pipelineJob.name)}» заново с теми же данными.</p>
         <button class="button-brand" type="button" data-retry="${escapeHtml(lesson.slug)}">Повторить шаг</button>`
      : '<p class="hint">Повторить нечего: упавший шаг не записан. Загрузите исходник заново.</p>'
  }
</section>`
    : ''
}

<section class="card">
  <h2>Обложка</h2>
  ${
    lesson.coverUrl
      ? `<figure class="review-cover">
    <img src="${escapeHtml(lesson.coverUrl)}" alt="Обложка урока">
  </figure>`
      : '<p class="hint">Обложки пока нет.</p>'
  }
  ${
    covers.length > 1
      ? `<p class="hint">Есть несколько — выберите, какая идёт в карточку и в превью ссылки:</p>
         <ul class="cover-choice">${covers
           .map(
             (cover) => `<li>
             <img src="/media/asset/${cover.id}" alt="">
             <span class="meta">${escapeHtml(cover.label)}</span>
             ${
               lesson.coverUrl === `/media/asset/${cover.id}`
                 ? '<span class="badge">выбрана</span>'
                 : `<button class="button" type="button" data-cover="${cover.id}">
                      Сделать обложкой
                    </button>`
             }
           </li>`
           )
           .join('')}</ul>`
      : ''
  }
  <p class="form-row">
    <button class="button" type="button" data-draw-cover="${escapeHtml(lesson.slug)}"
      ${lesson.title ? '' : 'disabled title="Сначала нужен заголовок"'}>
      Нарисовать обложку
    </button>
  </p>
  <p class="hint">
    Кадр из записи берётся с десятой части урока и часто показывает экран
    редактора. Рисование идёт минуту с лишним и требует включённой оплаты на
    проекте Google: на бесплатной доле квота на картинки нулевая. Кадр при этом
    никуда не девается — к нему можно вернуться одним нажатием.
  </p>
</section>

<section class="card">
  <h2>Что видит зритель</h2>
  <form id="review-form" data-approve="${escapeHtml(lesson.slug)}">
    <label>Заголовок
      <input name="title" value="${escapeHtml(lesson.title)}" required maxlength="200">
    </label>
    <label>Описание
      <textarea name="description" rows="4" maxlength="2000">${escapeHtml(lesson.description ?? '')}</textarea>
    </label>
    <label>Теги через запятую
      <input name="tags" value="${escapeHtml(lesson.tags.join(', '))}" maxlength="200">
    </label>
    <div class="form-row">
      <button class="button" type="button" data-autofill="${escapeHtml(lesson.slug)}"
        ${segments.length ? '' : 'disabled title="Сначала нужна расшифровка"'}>
        Заполнить из расшифровки
      </button>
      <button class="button" type="submit" name="publish" value="no">Сохранить черновик</button>
      <button class="button-brand" type="submit" name="publish" value="yes">Опубликовать</button>
    </div>
  </form>
  <p class="hint">
    Заполнение читает расшифровку и предлагает заголовок, описание и теги. Это
    заготовка, а не готовый текст: поправьте её перед публикацией. Без ключа
    модели поля заполняются своими силами — заметно грубее.
  </p>
  <p class="hint">
    Публикация показывает урок на витрине и рассылает уведомление подписчикам —
    один раз: повторное сохранение никого не разбудит второй раз.
  </p>
</section>

<section class="card">
  <h2>Как готовить урок</h2>
  <form id="settings-form" data-settings="${escapeHtml(lesson.slug)}">
    <label>Толщина обводки подписей
      <input name="subtitleOutline" type="number" min="0" max="4" step="0.1"
             value="${escapeHtml(String(settings.subtitleOutline))}">
    </label>
    <label>Цвет подписей
      <input name="subtitleColor" type="color" value="${escapeHtml(settings.subtitleColor)}">
    </label>
    <label class="checkbox-row">
      <input name="cutPauses" type="checkbox" ${settings.cutPauses ? 'checked' : ''}>
      Готовить вариант с вырезанными паузами
    </label>
    <label>Пауза короче этой не режется, секунд
      <input name="minPauseSeconds" type="number" min="0.5" max="30" step="0.5"
             value="${escapeHtml(String(settings.minPauseSeconds))}">
    </label>
    <div class="form-row">
      <button class="button" type="submit">Сохранить настройки</button>
      <button class="button-brand" type="submit" name="rebuild" value="yes"
        ${busy ? 'disabled title="Пересборка уже идёт"' : ''}>
        Сохранить и пересобрать
      </button>
    </div>
  </form>
  <p class="hint">
    Настройки применяются при сборке роликов и монтаже. «Пересобрать» запускает
    её заново на уже загруженной записи — расшифровывать повторно не нужно.
    Монтаж часовой записи занимает у сервера около получаса.
  </p>
  ${
    busy
      ? `<p class="hint danger">
           Пересборка уже идёт: ${escapeHtml(state)}. Вторая такая же заняла бы
           те же ядра и обогнала бы первую — кнопка выключена, пока не закончится.
         </p>`
      : ''
  }
</section>

<section class="card">
  <h2>Расшифровка</h2>
  ${
    segments.length
      ? `<p class="hint">
           ${escapeHtml(String(segments.length))} реплик, ${escapeHtml(String(transcript?.length ?? 0))} знаков.
           Распознавание ошибается в именах и терминах — поправьте прямо здесь, и субтитры
           пересоберутся. Вертикальные ролики подписи вшивают внутрь: чтобы правка попала и
           в них, нажмите «Сохранить и пересобрать» в настройках выше.
         </p>
         <form id="transcript-form" data-transcript="${escapeHtml(lesson.slug)}">
           <ol class="segments">
             ${segments
               .map(
                 (segment) => `<li class="segment">
               <span class="meta">${escapeHtml(timeLabel(segment.startedMs))}</span>
               <input name="segment-${segment.id}" value="${escapeHtml(segment.text)}"
                      data-segment="${segment.id}" maxlength="500">
             </li>`
               )
               .join('')}
           </ol>
           <div class="form-row">
             <button class="button-brand" type="submit">Сохранить правки титров</button>
           </div>
         </form>`
      : transcript
        ? // Реплик нет, а текст есть — так бывает у расшифровки, пришедшей не
          // из нашего конвейера. Править нечего, но показать надо: иначе
          // страница врёт, что расшифровки нет вовсе.
          `<p class="hint">
             ${escapeHtml(String(transcript.length))} знаков. Реплик с временами нет,
             поэтому правка титров недоступна.
           </p>
           <pre class="transcript">${escapeHtml(transcript)}</pre>`
        : '<p class="hint">Расшифровки нет — шаг ещё не выполнен.</p>'
  }
  ${
    links.subtitles.length
      ? `<p class="hint">Субтитры (ссылка живёт час):</p>
         <ul>${links.subtitles
           .map(
             (item) =>
               `<li><a href="${escapeHtml(item.url)}">${escapeHtml(item.name)}</a></li>`
           )
           .join('')}</ul>`
      : ''
  }
</section>

${
  links.trimmed
    ? `<section class="card">
  <h2>Запись с вырезанными паузами</h2>
  <p class="hint">
    Было ${escapeHtml(humanDuration(lesson.durationSeconds))}, стало
    ${escapeHtml(links.trimmed.duration)}. Субтитры к ней свои, с пересчитанными
    временами.
  </p>
  <p class="hint">
    <strong>На площадки уйдёт именно эта запись</strong>, а не исходник. Исходник
    остаётся в буфере: из него можно смонтировать заново с другим порогом паузы.
  </p>
  <p><a class="button-brand" href="/admin/lesson/${encodeURIComponent(lesson.slug)}/preview?trimmed=1">
    Смотреть смонтированную
  </a></p>
  <ul><li><a href="${escapeHtml(links.trimmed.url)}">${escapeHtml(links.trimmed.name)}</a></li></ul>
</section>`
    : ''
}

${
  links.clips.length
    ? `<section class="card">
  <h2>Вертикальные ролики</h2>
  <p class="hint">
    Нарезаны из мест, где вы говорите плотнее всего, с вшитыми субтитрами.
    Ссылка живёт час — посмотрите и решите, годится ли.
  </p>
  <ul>${links.clips
    .map(
      (item) =>
        `<li><a href="${escapeHtml(item.url)}">${escapeHtml(item.name)}</a></li>`
    )
    .join('')}</ul>
</section>`
    : ''
}

<section class="card">
  <h2>Файлы в буфере</h2>
  ${
    assets.length
      ? `<ul>${assets.map(assetRow).join('')}</ul>
         <p class="hint">
           Файлы удаляются сами по сроку: портал не видеоархив, а на диске сервера
           место общее с другими проектами.
         </p>`
      : '<p class="hint">Буфер пуст.</p>'
  }
</section>

<script src="${assetUrl('/admin.js')}" type="module"></script>`
  });
}
