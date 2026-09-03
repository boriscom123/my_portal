// Страница борда идей. Задача — показать список тем с голосами и дать
// вошедшему предложить свою. Зачем статус подписывается словами: «accepted» в
// списке ничего не говорит человеку, который зашёл проголосовать.
// Вызывается из src/routes/pages.js по маршруту /ideas.
import { escapeHtml } from '../lib/html.js';
import { layout } from './layout.js';

const ПОДПИСИ_СТАТУСОВ = {
  new: 'новая',
  accepted: 'принята',
  in_progress: 'в работе',
  released: 'вышла'
};

function карточкаИдеи(idea) {
  const ссылкаНаУрок = idea.lessonSlug
    ? ` — <a href="/lesson/${encodeURIComponent(idea.lessonSlug)}">смотреть урок</a>`
    : '';
  return `<li class="идея">
  <button type="button" class="голос${idea.votedByViewer ? ' отдан' : ''}"
    data-голос="${idea.id}"
    aria-label="${idea.votedByViewer ? 'Отозвать голос' : 'Проголосовать'}">
    ▲ <span>${idea.votes}</span>
  </button>
  <div class="суть">
    <h3>${escapeHtml(idea.title)}</h3>
    ${idea.body ? `<p>${escapeHtml(idea.body)}</p>` : ''}
    <p class="мета">${ПОДПИСИ_СТАТУСОВ[idea.status]}${ссылкаНаУрок} ·
      предложил ${escapeHtml(idea.author?.displayName ?? 'кто-то')}</p>
  </div>
</li>`;
}

export function ideasPage({ config, ideas, user }) {
  return layout({
    config,
    user,
    path: '/ideas',
    title: 'Идеи для уроков — Solo AI Journey',
    description: 'Предложите тему следующего урока и поддержите чужие идеи голосом.',
    body: `
<h1>Идеи для уроков</h1>
<p class="лид">Предложите тему или поддержите чужую. Когда идея выйдет уроком,
всем, кто за неё голосовал, придёт уведомление.</p>

${
  user
    ? `<form id="форма-идеи" class="карточка">
  <input name="title" placeholder="О чём снять урок?" maxlength="200" required>
  <textarea name="body" rows="2" placeholder="Подробности, если нужны"></textarea>
  <div class="строка">
    <span class="подсказка">Идея появится в списке сразу.</span>
    <button class="кнопка-знак" type="submit">Предложить</button>
  </div>
</form>`
    : '<p class="подсказка"><a href="/login">Войдите</a>, чтобы предлагать идеи и голосовать.</p>'
}

<ul class="борд">${
      ideas.map(карточкаИдеи).join('') ||
      '<li class="подсказка">Пока пусто. Будьте первым — тема ближайшего урока ещё не выбрана.</li>'
    }</ul>`
  });
}
