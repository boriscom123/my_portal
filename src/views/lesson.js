// Карточка урока: описание, кнопки «смотреть на», реакции и отзывы.
// Задача — быть той страницей, ссылку на которую отправляют в мессенджер;
// поэтому заголовок, описание и обложка обязаны попасть в теги превью.
// Вызывается из src/routes/pages.js по маршруту /lesson/:slug.
import { escapeHtml } from '../lib/html.js';
import { layout } from './layout.js';
import { датаПоРусски } from './feed.js';
import { ШКАЛА } from '../lib/reactions.js';

// Как называются площадки на кнопках. Слаг площадки для человека не годится.
const НАЗВАНИЯ_ПЛОЩАДОК = {
  youtube: 'YouTube',
  vk: 'VK Видео',
  telegram: 'Telegram',
  rutube: 'RuTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  dzen: 'Дзен',
  max: 'MAX'
};

/**
 * Русское склонение после числа: 1 оценка, 2 оценки, 5 оценок.
 * Зачем: «3 оценок» на видном месте портала о качестве уроков читается как
 * небрежность. Вызывается из lessonPage.
 */
function склонение(n, [одна, две, много]) {
  const сотня = n % 100;
  if (сотня >= 11 && сотня <= 14) return много;
  const единица = n % 10;
  if (единица === 1) return одна;
  if (единица >= 2 && единица <= 4) return две;
  return много;
}

function отзыв(c) {
  const ждёт = c.status === 'pending';
  return `<li class="отзыв${ждёт ? ' ждёт' : ''}">
  <p class="автор">${escapeHtml(c.author.displayName)}
    ${ждёт ? '<span class="метка">ждёт проверки автором</span>' : ''}</p>
  <p>${escapeHtml(c.body)}</p>
</li>`;
}

export function lessonPage({
  config,
  lesson,
  comments,
  user,
  viewerReaction = null,
  rating = { total: 0, average: null }
}) {
  const кнопкиПлощадок = lesson.publications
    .filter((p) => p.url && p.state === 'published')
    .map(
      (p) =>
        `<a class="кнопка" href="${escapeHtml(p.url)}" rel="noopener" target="_blank">Смотреть на ${escapeHtml(
          НАЗВАНИЯ_ПЛОЩАДОК[p.platform] ?? p.platform
        )}</a>`
    )
    .join('');

  // Девять ступеней подряд. Подпись уходит в title и aria-label: кнопка из
  // одного смайлика непонятна и не читается программой чтения с экрана.
  const шкалаОценки = ШКАЛА.map(
    ({ значение, смайлик, описание }) =>
      `<button type="button" class="ступень${viewerReaction === значение ? ' отдана' : ''}"
        data-оценка="${значение}" title="${escapeHtml(описание)}"
        aria-label="${escapeHtml(значение)} из 9 — ${escapeHtml(описание)}">${смайлик}</button>`
  ).join('');

  const итогОценки = rating.total
    ? `<p class="итог-оценки"><b>${String(rating.average).replace('.', ',')}</b> из 9 ·
       ${rating.total} ${склонение(rating.total, ['оценка', 'оценки', 'оценок'])}</p>`
    : '<p class="итог-оценки подсказка">Оценок пока нет — поставьте первую.</p>';

  return layout({
    config,
    user,
    path: `/lesson/${encodeURIComponent(lesson.slug)}`,
    title: lesson.title,
    description: lesson.description,
    image: lesson.coverUrl,
    body: `
<article class="урок" data-урок="${lesson.id}">
  <p class="мета">${escapeHtml(lesson.publishedAt ? датаПоРусски(lesson.publishedAt) : 'черновик')}</p>
  <h1>${escapeHtml(lesson.title)}</h1>
  <p class="лид">${escapeHtml(lesson.description)}</p>

  ${
    lesson.tags.length
      ? `<p class="теги">${lesson.tags
          .map((t) => `<a class="тег" href="/tag/${encodeURIComponent(t)}">${escapeHtml(t)}</a>`)
          .join(' ')}</p>`
      : ''
  }

  <div class="площадки">
    ${кнопкиПлощадок || '<p class="подсказка">Ссылки появятся после публикации на площадках.</p>'}
  </div>

  <div class="оценка">
    <p class="мета">Как вам урок?</p>
    <div class="шкала">${шкалаОценки}</div>
    ${итогОценки}
  </div>

  <section class="отзывы">
    <h2>Отзывы</h2>
    <ul>${comments.map(отзыв).join('') || '<li class="подсказка">Пока никто не написал.</li>'}</ul>
    ${
      user
        ? `<form id="форма-отзыва" class="карточка">
      <textarea name="body" rows="3" required placeholder="Что осталось непонятным?"></textarea>
      <div class="строка">
        <span class="подсказка">Отзыв появится после проверки автором.</span>
        <button class="кнопка-знак" type="submit">Отправить</button>
      </div>
    </form>`
        : '<p class="подсказка"><a href="/login">Войдите</a>, чтобы оставить отзыв.</p>'
    }
  </section>
</article>`
  });
}
