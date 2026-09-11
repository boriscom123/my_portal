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
import { stateLabel } from './lesson-state.js';
import { PUBLICATION_STATES } from './publication-state.js';
import { readSettings } from '../lib/settings.js';
import { chaptersBlock, validChapters } from '../lib/chapters.js';
import { timeLabel } from './search.js';
import { isDrawing } from '../services/cover-drawing.js';

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
  sideError = null,
  drawingReady = false,
  publications = [],
  platforms = [],
  series = [],
  shorts = [],
  links
}) {
  const state = stateLabel(lesson);
  const durationMs = (lesson.durationSeconds ?? 0) * 1000 || Infinity;
  const failed = lesson.pipelineState === 'failed';
  const settings = readSettings(lesson.settings);
  // Пока записи нет, главное действие — загрузить её. Когда есть, предлагать
  // загрузку как главное действие значит звать сделать то, что уже сделано.
  const hasSource = assets.some((asset) => asset.kind === 'source' || asset.kind === 'trimmed');
  // Обложка рисуется прямо сейчас: кнопка занята, страница ждёт конца сама.
  const drawingNow = isDrawing(lesson.drawing);
  // Обработана ли запись: по субтитрам видно надёжнее, чем по состоянию —
  // состояние сбрасывается, а файлы остаются.
  const processed = assets.some((asset) => asset.kind === 'subtitles');
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
  <a class="button" href="/lessons">← Уроки</a>
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
  <h2>Запись</h2>
  ${
    hasSource
      ? `<p class="hint">
           Запись на сайте${
             lesson.durationSeconds
               ? `, длительность ${escapeHtml(humanDuration(lesson.durationSeconds))}`
               : ''
           }. ${
             processed
               ? 'Речь распознана: расшифровка и субтитры есть.'
               : 'Обработка ещё не запускалась — расшифровки и субтитров нет.'
           }
         </p>
         <p class="form-row">
           <a class="button-brand" href="/admin/lesson/${encodeURIComponent(lesson.slug)}/preview">
             Проверить запись
           </a>
           <a class="button" href="/admin/upload?lesson=${encodeURIComponent(lesson.slug)}">Заменить запись</a>
         </p>`
      : `<p class="hint">
           Записи ещё нет. Загрузите её с компьютера или возьмите с Яндекс Диска;
           обработка, монтаж и нарезки — отдельными кнопками, когда файл будет здесь.
         </p>
         <p class="form-row">
           <a class="button-brand" href="/admin/upload?lesson=${encodeURIComponent(lesson.slug)}">Загрузить запись</a>
         </p>`
  }
</section>

<section class="card">
  <h2>Обработка звука</h2>
  <p class="hint">
    Снимает звуковую дорожку, распознаёт речь и собирает субтитры. Больше
    ничего: монтаж, обложку и вертикальные ролики вы запускаете отдельными
    кнопками ниже — каждое занимает минуты, и нужны они не всякому уроку.
    На часовой записи это около получаса; по окончании придёт уведомление.
  </p>
  ${
    hasSource
      ? `<p class="form-row">
           <button class="${processed ? 'button' : 'button-brand'}" type="button"
             data-process="${escapeHtml(lesson.slug)}" ${busy ? 'disabled title="Идёт другая работа"' : ''}>
             ${processed ? 'Обработать заново' : 'Обработать'}
           </button>
         </p>
         ${
           processed
             ? '<p class="hint">Субтитры уже есть — повтор перезапишет их.</p>'
             : '<p class="hint">Субтитров пока нет.</p>'
         }`
      : '<p class="hint">Сначала загрузите запись — обрабатывать нечего.</p>'
  }
</section>

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
    covers.length
      ? `<p class="hint">
           Выберите, какая идёт в карточку и в превью ссылки. Новая нарисованная
           только добавляется сюда — обложкой её делаете вы.
         </p>
         <ul class="cover-choice">${covers
           .map(
             (cover) => `<li>
             <img src="/media/asset/${cover.id}" alt="">
             <span class="meta">${escapeHtml(cover.label)}</span>
             <span class="form-row">
               ${
                 lesson.coverUrl === `/media/asset/${cover.id}`
                   ? '<span class="badge">выбрана</span>'
                   : `<button class="button" type="button" data-cover="${cover.id}">
                        Сделать обложкой
                      </button>`
               }
               <button class="button" type="button" data-cover-remove="${cover.id}"
                 title="Убрать эту обложку">Удалить</button>
             </span>
           </li>`
           )
           .join('')}</ul>`
      : ''
  }
  <div class="form-row">
    <button class="button" type="button" data-cover-frame="${escapeHtml(lesson.slug)}"
      ${hasSource ? '' : 'disabled title="Сначала загрузите запись"'}>
      Взять кадр из записи
    </button>
    <button class="button" type="button" data-draw-cover="${escapeHtml(lesson.slug)}"
      ${
        !lesson.title
          ? 'disabled title="Сначала нужен заголовок"'
          : !drawingReady
            ? 'disabled title="Добавьте токен Hugging Face в настройках"'
            : drawingNow
              ? `disabled data-draw-watch="${escapeHtml(lesson.slug)}"`
              : ''
      }>
      ${drawingNow ? 'Рисую…' : 'Нарисовать обложку'}
    </button>
    <label class="button" for="cover-file">Загрузить с компьютера</label>
    <input id="cover-file" type="file" accept="image/png,image/jpeg,image/webp" hidden
      data-cover-upload="${escapeHtml(lesson.slug)}">
  </div>
  ${
    drawingReady
      ? `<label class="field">Запрос для рисования — по-английски
           <textarea rows="3" maxlength="1000" data-cover-prompt
             placeholder="Пусто — запрос составит Gemini по заголовку и описанию урока">${escapeHtml(lesson.coverPrompt?.text ?? '')}</textarea>
         </label>
         <p class="hint">
           ${
             lesson.coverPrompt?.source === 'suggested'
               ? 'Запрос составлен по расшифровке урока. Поправьте, если нужно, и нажмите «Нарисовать обложку».'
               : lesson.coverPrompt
                 ? 'Последняя обложка нарисована по этому запросу.'
                 : 'Поле можно оставить пустым: запрос составит Gemini по заголовку и описанию.'
           }
           Запрос обновляется кнопкой «Заполнить из расшифровки»; очистите поле — его
           составит Gemini по заголовку и описанию. Пишите по-английски и только то,
           что должно быть на картинке: «no …» модель читает как «нарисуй …».
         </p>`
      : `<p class="hint">
           Рисование выключено: <a href="/settings">добавьте токен Hugging Face в настройках</a>.
         </p>`
  }
  ${
    sideError && sideError.step === 'makeCoverImage'
      ? `<p class="hint danger">
           Нарисовать не вышло: ${escapeHtml(sideError.message)}
         </p>`
      : ''
  }
  <p class="hint">
    Кадр из записи берётся с десятой части урока и часто показывает экран
    редактора. Готовую картинку можно загрузить со своего компьютера — png,
    jpeg или webp до десяти мегабайт. Рисование прямо здесь требует включённой
    оплаты на проекте Google: на бесплатной доле квота на картинки нулевая.
    Что бы вы ни выбрали, кадр из записи остаётся — к нему можно вернуться
    одним нажатием.
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
    <label>Главы — по строке, «0:00 Название»
      <textarea name="chapters" rows="6">${escapeHtml(chaptersBlock(lesson.chapters ?? []))}</textarea>
    </label>
    ${
      (lesson.chapters ?? []).length && !validChapters(lesson.chapters, durationMs).length
        ? `<p class="hint danger">Площадка такие главы не покажет — ни одной.
             Первая обязана начинаться с 0:00, глав нужно не меньше трёх, между
             соседними не меньше десяти секунд.</p>`
        : `<p class="hint">Первая глава — 0:00, дальше по смене темы. Меньше трёх
             глав YouTube не показывает вовсе.</p>`
    }
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
  <p class="form-row">
    <a class="button" href="/lesson/${encodeURIComponent(lesson.slug)}">
      Открыть страницу урока
    </a>
    ${
      // Удаление живёт здесь, рядом с остальной работой над уроком, — как и у
      // новости. В списке ему не место: там оно стоит вплотную к соседним
      // урокам, а промах необратим.
      lesson.status === 'published'
        ? `<span class="badge" title="Опубликованный урок сначала снимают с витрины">на витрине</span>`
        : `<button class="button" type="button"
             data-lesson-delete="${escapeHtml(lesson.slug)}">Удалить урок</button>`
    }
  </p>
</section>

<section class="card">
  <h2>Серия</h2>
  <p class="hint">
    Уроки, идущие курсом, связываются серией: под уроком появятся предыдущий и
    следующий, а у серии будет своя страница со всем порядком. Урок встаёт в
    конец серии — переставить его можно стрелками там же.
  </p>
  <form data-lesson-series="${escapeHtml(lesson.slug)}">
    <label>Серия
      <select name="seriesSlug">
        <option value="">— вне серии —</option>
        ${series
          .map(
            (item) =>
              `<option value="${escapeHtml(item.slug)}"${
                item.id === lesson.seriesId ? ' selected' : ''
              }>${escapeHtml(item.title)}</option>`
          )
          .join('')}
      </select>
    </label>
    <label>…или новая серия — впишите название
      <input name="title" maxlength="200" placeholder="Портал с нуля">
    </label>
    <div class="form-row">
      <button class="button-brand" type="submit">Сохранить серию</button>
      ${
        lesson.seriesId
          ? `<a class="button" href="/series/${escapeHtml(
              series.find((item) => item.id === lesson.seriesId)?.slug ?? ''
            )}">Открыть серию</a>`
          : ''
      }
    </div>
  </form>
</section>

<section class="card">
  <h2>Площадки</h2>
  ${
    platforms.length
      ? platforms
          .map((platform) => {
            const publication = publications.find((item) => item.platform === platform.name);
            // Кнопка остаётся только там, где ей есть что делать. Ролик и пост,
            // которые уже ушли, вторым нажатием не обновятся — уедет вторая
            // копия, и убирать её придётся руками на самой площадке.
            const sendable = !publication || publication.state === 'failed';
            // Части видео идут следом за анонсом: без него пост с частями
            // оказался бы в канале без представления урока.
            const announced =
              !platform.needsAnnouncement ||
              publications.some(
                (item) => item.platform === platform.needsAnnouncement && item.state === 'published'
              );

            return `<div class="platform-row">
              <p><strong>${escapeHtml(platform.title)}</strong>: ${
                publication
                  ? escapeHtml(PUBLICATION_STATES[publication.state] ?? publication.state)
                  : 'не отправляли'
              }${
                publication?.url && publication.state !== 'failed'
                  ? ` — <a href="${escapeHtml(publication.url)}" rel="noopener" target="_blank">открыть</a>`
                  : ''
              }</p>
              ${
                publication?.error
                  ? `<p class="hint danger">${escapeHtml(publication.error)}</p>`
                  : ''
              }
              ${
                platform.name === 'youtube' && publication?.state === 'ready'
                  ? `<p class="hint">Ролик лежит на канале приватным — таковы правила Google,
                       пока приложение не прошло проверку. Откройте его в студии и нажмите
                       «Проверить»: тогда ссылка появится и на странице урока, и в постах
                       каналов.</p>
                     <p class="form-row">
                       <button class="button" type="button"
                         data-youtube-check="${escapeHtml(lesson.slug)}">Проверить</button>
                     </p>`
                  : ''
              }
              ${
                sendable
                  ? `<p class="form-row">
                       <button class="button" type="button"
                         data-publish="${escapeHtml(platform.name)}"
                         value="${escapeHtml(lesson.slug)}"
                         ${
                           !announced
                             ? 'disabled title="Сначала отправьте анонс в этот канал"'
                             : platform.needsCover && !lesson.coverUrl
                             ? 'disabled title="Сначала нужна обложка"'
                             : hasSource
                               ? busy
                                 ? 'disabled title="Идёт обработка — дождитесь её конца"'
                                 : ''
                               : 'disabled title="Сначала загрузите запись"'
                         }>
                         ${publication?.state === 'failed' ? 'Отправить заново' : platform.action}
                       </button>
                     </p>`
                  : ''
              }
            </div>`;
          })
          .join('')
      : `<p class="hint">Ни одна площадка не настроена. Ключи и каналы заводятся в
           <a href="/settings">настройках</a>.</p>`
  }
  <p class="hint">
    На YouTube уезжает смонтированная запись, если вы её собрали, иначе исходник;
    субтитры идут отдельным треком. В каналы уходит анонс — обложка, описание и
    ссылки, — и он дополняется сам, когда ролик выходит на площадках.
  </p>
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
    <label class="checkbox-row">
      <input name="burnedSubtitles" type="checkbox" ${settings.burnedSubtitles ? 'checked' : ''}>
      На записи уже есть наложенные титры
    </label>
    <p class="hint">
      Если титры уже на записи, в вертикальные ролики свои вшиваться не будут:
      иначе выйдут две строки подписей друг под другом.
    </p>
    <label>Пауза короче этой не режется, секунд
      <input name="minPauseSeconds" type="number" min="0.5" max="30" step="0.5"
             value="${escapeHtml(String(settings.minPauseSeconds))}">
    </label>
    <div class="form-row">
      <button class="button" type="submit">Сохранить настройки</button>
      <button class="button-brand" type="submit" name="rebuild" value="yes"
        ${busy ? 'disabled title="Идёт другая работа"' : ''}>
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
           Сейчас идёт другая работа: ${escapeHtml(state)}. Пока она не
           закончится, пересобирать нельзя — вторая заняла бы те же два ядра и
           переписывала бы те же файлы вперемешку.
         </p>`
      : ''
  }
</section>

<section class="card">
  <h2>Вертикальные ролики</h2>
  <p class="hint">
    Нарезаются из мест, где вы говорите плотнее всего, а подписи вшиваются
    внутрь видео. Поэтому собирать их стоит ПОСЛЕ того, как поправите титры:
    иначе придётся резать заново. Сборка занимает пару минут.
  </p>
  ${
    links.clips.length
      ? `<ul class="clip-list">${links.clips
          .map((item) => {
            const short = shorts.find((made) => made.assetId === item.id);
            return `<li>
              <a href="${escapeHtml(item.url)}">${escapeHtml(item.name)}</a>
              ${
                short
                  ? ` — <a href="/short/${encodeURIComponent(short.slug)}/edit">ролик «${escapeHtml(
                      short.title
                    )}»</a>`
                  : `<button class="button" type="button" data-make-short="${item.id}"
                       value="${escapeHtml(lesson.slug)}">Сделать роликом</button>`
              }
            </li>`;
          })
          .join('')}</ul>
         <p class="hint">
           Ссылка живёт час — посмотрите и решите, годится ли. «Сделать роликом»
           заводит его в разделе «Коротко»: файл при этом остаётся здесь и
           перестаёт стареть.
         </p>`
      : ''
  }
  <p class="form-row">
    <button class="${links.clips.length ? 'button' : 'button-brand'}" type="button"
      data-clips="${escapeHtml(lesson.slug)}" ${segments.length ? '' : 'disabled title="Сначала нужна расшифровка"'}>
      ${links.clips.length ? 'Пересобрать ролики' : 'Собрать ролики'}
    </button>
  </p>
</section>

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
