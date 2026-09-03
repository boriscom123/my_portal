// Знак проекта — ракета, вектором.
//
// Задача — дать один источник для трёх мест сразу: шапка сайта, иконка
// приложения, будущие обложки. Зачем вектором, а не картинкой: растянутый
// растр мылит на большом экране, а разделённая на части ракета позволяет
// оживить одно только пламя, не трогая остальное — этого и просил заказчик.
//
// Части названы и вынесены классами: .rocket-nose, .rocket-body,
// .rocket-fin, .rocket-flame. Оформление живёт в public/styles.css,
// здесь только геометрия.
//
// Вызывается из src/views/layout.js (шапка) и из скрипта сборки иконок
// (scripts/build-icons.mjs).

/**
 * Отдаёт разметку ракеты.
 *
 * Идентификаторы градиентов уникальны на страницу: два знака на одной
 * странице с одинаковыми id склеились бы в один градиент, и второй знак
 * перекрасился бы вслед за первым.
 *
 * @param {object} параметры
 * @param {number} параметры.height — высота в пикселях; ширина считается сама
 * @param {string} параметры.id — приставка к идентификаторам градиентов
 * @param {boolean} параметры.живое — нужен ли класс, включающий перелив пламени
 */
export function rocket({ height = 34, id = 'brand', animated = true } = {}) {
  const width = Math.round((height * 48) / 116);
  const ref = (name) => `${id}-${name}`;

  return `<svg class="rocket${animated ? ' animated' : ''}" width="${width}" height="${height}"
  viewBox="0 0 48 116" role="img" aria-label="Ракета Solo AI Journey" focusable="false">
<defs>
  <linearGradient id="${ref('nose')}" x1="0" y1="0" x2="1" y2="0.4">
    <stop offset="0" stop-color="#8A4BD6"/>
    <stop offset="0.55" stop-color="#B45CE8"/>
    <stop offset="1" stop-color="#E88A7A"/>
  </linearGradient>
  <linearGradient id="${ref('body')}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#29BDE8"/>
    <stop offset="0.5" stop-color="#5B9BE0"/>
    <stop offset="1" stop-color="#A38DE2"/>
  </linearGradient>
  <linearGradient id="${ref('fin')}" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#9B5CF0"/>
    <stop offset="1" stop-color="#7B3BC4"/>
  </linearGradient>
  <linearGradient id="${ref('flame')}" x1="0" y1="0" x2="0" y2="1">
    <stop class="flame-top" offset="0" stop-color="#FF6B3D"/>
    <stop class="flame-mid" offset="0.55" stop-color="#FFB336"/>
    <stop class="flame-bottom" offset="1" stop-color="#FFE08A"/>
  </linearGradient>
</defs>
<path class="rocket-fin" d="M16.5 57 Q4.5 69 4.5 88 Q10 76 16.5 72 Z" fill="url(#${ref('fin')})"/>
<path class="rocket-fin" d="M31.5 57 Q43.5 69 43.5 88 Q38 76 31.5 72 Z" fill="url(#${ref('fin')})"/>
<path class="rocket-body" d="M19 26 H29 V79 Q29 87 24 90 Q19 87 19 79 Z" fill="url(#${ref('body')})"/>
<path class="rocket-nose" d="M24 2 L35.5 35 Q24 25.5 12.5 35 Z" fill="url(#${ref('nose')})"/>
<path class="rocket-flame" d="M24 88 Q28.5 95 26 102 Q24.8 107 24 109 Q23.2 107 22 102 Q19.5 95 24 88 Z" fill="url(#${ref('flame')})"/>
</svg>`;
}
