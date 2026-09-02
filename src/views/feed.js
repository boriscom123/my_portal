// Лента: уроки и новости, свежие сверху. Задача — дать поисковику и человеку
// без приложения полноценную главную страницу.
// Вызывается из src/routes/pages.js по маршрутам / и /tag/:slug.
import { escapeHtml } from '../lib/html.js';
import { layout } from './layout.js';

/** Дата в виде, привычном читателю: «1 августа 2026». */
export function датаПоРусски(value) {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' }).format(new Date(value));
}

/** Обложка. Пока урок без картинки — фирменный градиент вместо серой заглушки. */
function обложка(lesson) {
  return lesson.coverUrl
    ? `<img src="${escapeHtml(lesson.coverUrl)}" alt="" class="обложка">`
    : '<div class="обложка кнопка-знак"></div>';
}

function карточкаУрока(lesson) {
  const дата = lesson.publishedAt ? датаПоРусски(lesson.publishedAt) : 'черновик';
  return `<article class="урок-карточка">
  <a href="/lesson/${encodeURIComponent(lesson.slug)}">${обложка(lesson)}</a>
  <div class="тело">
    <p class="мета">${escapeHtml(дата)}</p>
    <h3><a href="/lesson/${encodeURIComponent(lesson.slug)}">${escapeHtml(lesson.title)}</a></h3>
    <p class="описание">${escapeHtml(lesson.description)}</p>
    ${
      lesson.tags.length
        ? `<p class="теги">${lesson.tags
            .map(
              (t) =>
                `<a class="тег" href="/tag/${encodeURIComponent(t)}">${escapeHtml(t)}</a>`
            )
            .join(' ')}</p>`
        : ''
    }
  </div>
</article>`;
}

export function feedPage({ config, lessons, news, user, tag = null }) {
  const заголовок = tag ? `Уроки по теме «${tag}»` : 'Solo AI Journey';

  return layout({
    config,
    user,
    path: tag ? `/tag/${encodeURIComponent(tag)}` : '/',
    title: tag ? `${заголовок} — Solo AI Journey` : 'Solo AI Journey — портал видеоуроков',
    description:
      'Видеоуроки о разработке с ИИ: Claude Code, свой VPS и Telegram-бот. Уроки, новости и борд идей для будущих выпусков.',
    body: `
${
  tag
    ? `<h1>${escapeHtml(заголовок)}</h1><p><a href="/">← все уроки</a></p>`
    : `<p class="подпись-бренда">от идеи до продукта · шаг за шагом</p>
<h1>Реальные приложения<br>с ИИ, <span class="знак">в одиночку</span></h1>
<p class="лид">Claude Code, свой VPS и Telegram-бот. Каждый урок — работающий кусок системы,
а не пример из документации. Код и переписка с заказчиком лежат в открытом репозитории.</p>`
}

<section>
  <h2>Уроки</h2>
  ${
    lessons.length
      ? `<div class="сетка-уроков">${lessons.map(карточкаУрока).join('')}</div>`
      : '<p class="подсказка">Пока ни одного урока. Первый уже собирается.</p>'
  }
</section>

${
  news.length
    ? `<section class="новости">
  <h2>Новости</h2>
  ${news
    .map(
      (n) => `<article class="карточка">
    <p class="мета">${escapeHtml(датаПоРусски(n.publishedAt))}</p>
    <h3>${escapeHtml(n.title)}</h3>
    <p>${escapeHtml(n.body)}</p>
  </article>`
    )
    .join('')}
</section>`
    : ''
}`
  });
}
