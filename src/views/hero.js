// Заглавная надпись портала и сменяющиеся уроки под ней.
//
// Задача — назвать портал и сразу показать, что в нём есть. Раньше под именем
// стоял рассказ о том, из чего портал сделан: верный текст, но не про то, зачем
// человек сюда пришёл.
//
// Уроки сменяют друг друга, и каждый ведёт на себя. Без скрипта видно первый:
// он помечен в разметке, а не выбирается на месте — иначе у пришедшего без
// скрипта заглавный блок оказался бы пустым.
// Вызывается из src/views/feed.js и src/views/stub.js.
import { escapeHtml } from '../lib/html.js';

// Сколько уроков крутим. Больше пяти человек не дождётся, а разметки прибавляет.
const MAX_ITEMS = 5;

/** Первое предложение описания: в заглавный блок абзац целиком не влезает. */
function firstSentence(text) {
  const clean = String(text ?? '').trim();
  if (!clean) return '';
  const end = clean.search(/[.!?](\s|$)/);
  return end > 0 ? clean.slice(0, end + 1) : clean;
}

function item(lesson, index) {
  return `<li class="hero-item${index === 0 ? ' current' : ''}">
  <a href="/lesson/${encodeURIComponent(lesson.slug)}">
    <span class="hero-item-title">${escapeHtml(lesson.title)}</span>
    ${
      lesson.description
        ? `<span class="hero-item-text">${escapeHtml(firstSentence(lesson.description))}</span>`
        : ''
    }
  </a>
</li>`;
}

export function hero({ lessons = [] } = {}) {
  // Черновики сюда не попадают, даже автору: заглавный блок — это витрина, а
  // не рабочий стол.
  const published = lessons.filter((lesson) => lesson.status === 'published').slice(0, MAX_ITEMS);

  return `<div class="hero">
  <h1 class="hero-name">
    <span class="hero-brand brand-mark">SOLO AI</span>
    <span class="hero-journey">JOURNEY</span>
  </h1>
  <p class="hero-tagline">от идеи до продукта · шаг за шагом</p>
  ${
    published.length
      ? `<ul class="hero-rotator" data-rotator>${published.map(item).join('')}</ul>`
      : `<p class="hero-empty">
           Первый урок уже собирается. Внутри — Claude Code, свой VPS и
           Telegram-бот: каждый выпуск оставляет работающий кусок системы.
         </p>`
  }
</div>`;
}
