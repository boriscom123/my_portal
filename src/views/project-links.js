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
export function projectFields({
  projects = [],
  mainId = null,
  relatedIds = [],
  locked = null,
  collapsible = false
}) {
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

  // Проект необязателен: «Без проекта» — законный выбор и стоит первым.
  const mainBlock = `<label>Основной проект
    <select name="mainSlug"${locked ? ' disabled' : ''}>
      <option value=""${mainId ? '' : ' selected'}>Без проекта</option>
      ${options}
    </select>
  </label>
  ${locked ? `<p class="hint">${locked}</p>` : ''}`;
  const relatedBlock = `<fieldset class="project-related">
    <legend>Связанные проекты</legend>
    ${checkboxes}
  </fieldset>`;

  if (!collapsible) return `${mainBlock}\n  ${relatedBlock}`;

  // Свёрнуто за кнопками — в форме новости, где проект нужен не всякой
  // заметке, а открытые поля отнимали место у текста. Блок с уже выбранным
  // проектом открыт сразу: иначе не видно, что стоит. details, а не свой
  // скрипт: раскрывается и без него, а поля внутри уходят с формой как обычно.
  return `<details class="project-picker"${mainId ? ' open' : ''}>
    <summary class="button">Добавить основной проект</summary>
    ${mainBlock}
  </details>
  <details class="project-picker"${relatedIds.length ? ' open' : ''}>
    <summary class="button">Добавить связанные проекты</summary>
    ${relatedBlock}
  </details>`;
}

/**
 * Кнопки проектов под материалом. Основной — фирменным цветом, связанные —
 * обычными. base — список, куда ведёт кнопка: с урока в «Уроки», с новости в
 * «Новости». Проектов нет — пустая строка.
 */
export function projectLinks(projects, base) {
  const main = projects?.main ?? null;
  const related = projects?.related ?? [];
  if (!main && !related.length) return '';
  const link = (project, className) =>
    `<a class="${className}" href="${base}?project=${encodeURIComponent(project.slug)}">${escapeHtml(
      project.title
    )}</a>`;
  return `<p class="project-links">${main ? link(main, 'project-link main') : ''}${related
    .map((project) => link(project, 'project-link'))
    .join('')}</p>`;
}
