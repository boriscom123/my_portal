// Проекты на экранах: поля выбора у автора и кнопки у зрителя.
//
// Задача — показать проекты одинаково во всех местах: форма урока, новости и
// серии выбирает их одними полями, а карточки и страницы материалов ведут на
// фильтр одними кнопками. Разойдись они — и в одной форме основной проект
// оказался бы среди связанных, а в другой нет.
// Вызывается из src/views/settings.js, src/views/admin-review.js,
// src/views/news.js, src/views/lessons-page.js, src/views/feed.js и
// src/views/lesson.js.
import { escapeHtml } from '../lib/html.js';

/**
 * Поля выбора проектов: основной и галочки связанных.
 * Галочка основного спрятана — основным и связанным сразу проект не бывает;
 * при смене выбора её прячет bindProjectFields из public/ui.js.
 * locked — основной заперт (урок в серии): выключенный select форма не шлёт,
 * и сервер берёт проект серии. Текст подсказки приходит готовой разметкой.
 */
export function projectFields({ projects = [], mainId = null, relatedIds = [], locked = null }) {
  const options = projects
    .map(
      (project) =>
        `<option value="${escapeHtml(project.slug)}"${project.id === mainId ? ' selected' : ''}>${escapeHtml(
          project.title
        )}</option>`
    )
    .join('');
  const checkboxes = projects
    .map(
      (project) =>
        `<label class="checkbox-row" data-related="${escapeHtml(project.slug)}"${
          project.id === mainId ? ' hidden' : ''
        }>
      <input type="checkbox" name="relatedSlugs" value="${escapeHtml(project.slug)}"${
        relatedIds.includes(project.id) ? ' checked' : ''
      }>
      <span>${escapeHtml(project.title)}</span>
    </label>`
    )
    .join('');

  return `<label>Основной проект
    <select name="mainSlug" required${locked ? ' disabled' : ''}>
      ${mainId ? '' : '<option value="">— выберите проект —</option>'}
      ${options}
    </select>
  </label>
  ${locked ? `<p class="hint">${locked}</p>` : ''}
  ${
    !mainId && !locked
      ? '<p class="hint danger">Выберите проект: без него материал не попадёт в фильтр по проекту.</p>'
      : ''
  }
  <fieldset class="project-related">
    <legend>Связанные проекты</legend>
    ${checkboxes}
  </fieldset>`;
}
