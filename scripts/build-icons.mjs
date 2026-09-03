// Сборка иконок приложения из векторного знака.
//
// Задача — получить все размеры из одного источника, чтобы они не разошлись
// при первой же правке ракеты. Зачем скриптом, а не руками в редакторе:
// иконок пять, и любая ручная операция здесь однажды будет пропущена.
//
// Запускается вручную после правки ракеты: `npm run icons`.
// Требует питона с cairosvg — берётся из контейнера, ставить в систему нечего.
import { writeFileSync, mkdirSync } from 'node:fs';
import { rocket } from '../src/views/rocket.js';

const OUT_DIR = new URL('../public/icons/', import.meta.url);
const BACKGROUND = '#0C0A20';

/**
 * Собирает квадратную картинку: ракета по центру тёмного фона.
 * Прозрачный фон здесь не годится — iOS кладёт иконку на чёрный квадрат, и
 * ракета зависла бы в пустоте.
 *
 * @param {number} доля — какую часть высоты занимает ракета
 * @param {number} скругление — радиус углов; 0 для maskable, её режет система
 */
function canvas(share, radius) {
  const side = 512;
  const height = side * share;
  const width = (height * 48) / 116;
  const x = (side - width) / 2;
  const y = (side - height) / 2;
  const mark = rocket({ height: height, id: 'icon', animated: false })
    // На картинке анимации нет, поэтому размеры задаём трансформацией:
    // так ракета остаётся одним и тем же вектором, без второго описания.
    .replace(/^<svg[^>]*>/, '')
    .replace('</svg>', '');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" width="${side}" height="${side}">
<rect width="${side}" height="${side}" rx="${radius}" fill="${BACKGROUND}"/>
<g transform="translate(${x} ${y}) scale(${height / 116})">${mark}</g>
</svg>`;
}

mkdirSync(OUT_DIR, { recursive: true });
// Обычная иконка: ракета занимает две трети — так она читается на мелком
// значке. Maskable: система обрежет края по своей маске, поэтому запас больше.
writeFileSync(new URL('icon.svg', OUT_DIR), canvas(0.86, 0));
writeFileSync(new URL('icon-maskable.svg', OUT_DIR), canvas(0.62, 0));
console.log('Векторы иконок собраны в public/icons/');
