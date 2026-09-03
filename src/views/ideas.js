// Страница борда идей. Задача — показать список тем с голосами и дать
// вошедшему предложить свою. Зачем статус подписывается словами: «accepted» в
// списке ничего не говорит человеку, который зашёл проголосовать.
// Вызывается из src/routes/pages.js по маршруту /ideas.
import { escapeHtml } from '../lib/html.js';
import { layout } from './layout.js';

const STATUS_LABELS = {
  new: 'новая',
  accepted: 'принята',
  in_progress: 'в работе',
  released: 'вышла'
};

function ideaCard(idea) {
  const lessonLink = idea.lessonSlug
    ? ` — <a href="/lesson/${encodeURIComponent(idea.lessonSlug)}">смотреть урок</a>`
    : '';
  return `<li class="idea">
  <button type="button" class="vote${idea.votedByViewer ? ' voted' : ''}"
    data-vote="${idea.id}"
    aria-label="${idea.votedByViewer ? 'Отозвать голос' : 'Проголосовать'}">
    ▲ <span>${idea.votes}</span>
  </button>
  <div class="idea-text">
    <h3>${escapeHtml(idea.title)}</h3>
    ${idea.body ? `<p>${escapeHtml(idea.body)}</p>` : ''}
    <p class="meta">${STATUS_LABELS[idea.status]}${lessonLink} ·
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
<p class="lead">Предложите тему или поддержите чужую. Когда идея выйдет уроком,
всем, кто за неё голосовал, придёт уведомление.</p>

${
  user
    ? `<form id="idea-form" class="card">
  <input name="title" placeholder="О чём снять урок?" maxlength="200" required>
  <textarea name="body" rows="2" placeholder="Подробности, если нужны"></textarea>
  <div class="form-row">
    <span class="hint">Идея появится в списке сразу.</span>
    <button class="button-brand" type="submit">Предложить</button>
  </div>
</form>`
    : '<p class="hint"><a href="/login">Войдите</a>, чтобы предлагать идеи и голосовать.</p>'
}

<ul class="ideas-board">${
      ideas.map(ideaCard).join('') ||
      '<li class="hint">Пока пусто. Будьте первым — тема ближайшего урока ещё не выбрана.</li>'
    }</ul>`
  });
}
