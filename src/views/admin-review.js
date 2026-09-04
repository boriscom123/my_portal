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

export function adminReviewPage({ config, user, lesson, assets, transcript, links }) {
  const state = stateLabel(lesson);
  const failed = lesson.pipelineState === 'failed';

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

${
  lesson.coverUrl
    ? `<figure class="review-cover">
  <img src="${escapeHtml(lesson.coverUrl)}" alt="Обложка урока">
  <figcaption class="hint">Кадр взят с десятой части урока. Не подошёл — повторите шаг обложки.</figcaption>
</figure>`
    : '<p class="hint">Обложки пока нет.</p>'
}

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
      <button class="button" type="submit" name="publish" value="no">Сохранить черновик</button>
      <button class="button-brand" type="submit" name="publish" value="yes">Опубликовать</button>
    </div>
  </form>
  <p class="hint">
    Публикация показывает урок на витрине и рассылает уведомление подписчикам —
    один раз: повторное сохранение никого не разбудит второй раз.
  </p>
</section>

<section class="card">
  <h2>Расшифровка</h2>
  ${
    transcript
      ? `<p class="hint">
           ${escapeHtml(String(transcript.length))} знаков. Прокрутите, чтобы прочитать целиком.
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
