// Страница «Обратная связь».
//
// Задача — одно место, куда человек говорит автору, чего хочет: предлагает тему
// урока, просит поправить портал или просто пишет отзыв. Виды разные, суть одна,
// поэтому форма одна с выбором вида, а не три рядом.
//
// Голосование только у идей: голосовать за чужой отзыв бессмысленно.
// Зачем статус подписывается словами: «accepted» в списке ничего не говорит
// человеку, который зашёл проголосовать.
// Вызывается из src/routes/pages.js по маршруту /feedback.
import { escapeHtml } from '../lib/html.js';
import { layout } from './layout.js';

const STATUS_LABELS = {
  new: 'новая',
  accepted: 'принята',
  in_progress: 'в работе',
  released: 'вышла'
};

/** Как называется вид обращения человеку. */
const KIND_LABELS = { idea: 'идея', wish: 'пожелание', review: 'отзыв' };

function ideaCard(idea, { votable = true } = {}) {
  const lessonLink = idea.lessonSlug
    ? ` — <a href="/lesson/${encodeURIComponent(idea.lessonSlug)}">смотреть урок</a>`
    : '';
  return `<li class="idea">
  ${
    votable
      ? `<button type="button" class="vote${idea.votedByViewer ? ' voted' : ''}"
    data-vote="${idea.id}"
    aria-label="${idea.votedByViewer ? 'Отозвать голос' : 'Проголосовать'}">
    ▲ <span>${idea.votes}</span>
  </button>`
      : `<span class="vote-kind">${escapeHtml(KIND_LABELS[idea.kind] ?? idea.kind)}</span>`
  }
  <div class="idea-text">
    <h3>${escapeHtml(idea.title)}</h3>
    ${idea.body ? `<p>${escapeHtml(idea.body)}</p>` : ''}
    <p class="meta">${STATUS_LABELS[idea.status]}${lessonLink} ·
      предложил ${escapeHtml(idea.author?.displayName ?? 'кто-то')}</p>
  </div>
</li>`;
}

export function feedbackPage({ config, ideas, mine = [], user }) {
  // Идеи — общий список, за них голосуют. Пожелания и отзывы показываются
  // человеку только свои: они адресованы автору портала, а не соседям по
  // списку, и выставлять их напоказ никто не просил.
  const board = ideas.filter((idea) => idea.kind === 'idea');

  return layout({
    config,
    user,
    path: '/feedback',
    title: 'Обратная связь — Solo AI Journey',
    description:
      'Предложить тему урока, попросить поправить портал или написать отзыв. Идеи можно поддержать голосом.',
    body: `
<h1>Обратная связь</h1>

<p class="hint">
  Тема ближайшего урока выбирается по вашим идеям — за них голосуют. Пожелания и
  отзывы о самом портале читает автор; они видны только вам.
</p>

${
  user
    ? `<form id="idea-form" class="card" data-feedback-form>
  <label>О чём речь
    <select name="kind">
      <option value="idea">Идея для урока — её увидят и поддержат другие</option>
      <option value="wish">Пожелание по порталу</option>
      <option value="review">Отзыв</option>
    </select>
  </label>
  <input name="title" placeholder="Коротко: о чём" maxlength="200" required>
  <textarea name="body" rows="3" placeholder="Подробности, если нужны"></textarea>
  <div class="form-row">
    <span class="hint">Появится в списке сразу.</span>
    <button class="button-brand" type="submit">Отправить</button>
  </div>
</form>`
    : '<p class="hint"><a href="/login">Войдите</a>, чтобы писать и голосовать.</p>'
}

${
  mine.length
    ? `<section class="card">
  <h2>Ваши обращения</h2>
  <ul class="ideas-board">${mine
    .map((idea) => ideaCard(idea, { votable: false }))
    .join('')}</ul>
</section>`
    : ''
}

<h2>Идеи будущих уроков</h2>
<ul class="ideas-board">${
      board.map((idea) => ideaCard(idea)).join('') ||
      '<li class="hint">Пока пусто. Будьте первым — тема ближайшего урока ещё не выбрана.</li>'
    }</ul>`
  });
}
