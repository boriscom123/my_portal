// Сборка иконок приложения из векторного знака.
//
// Задача — получить все размеры из одного источника, чтобы они не разошлись
// при первой же правке ракеты. Зачем скриптом, а не руками в редакторе:
// иконок пять, и любая ручная операция здесь однажды будет пропущена.
//
// Запускается вручную после правки ракеты: `npm run icons`. Скрипт пишет только
// векторы; растр из них делается отдельной командой — рисовалка живёт в чужом
// образе, ставить её в систему и в образ проекта незачем:
//
//   docker run --rm -v "$PWD":/w -w /w alpine sh -c \
//     'apk add --no-cache rsvg-convert >/dev/null &&
//      rsvg-convert -w 512 -h 512 public/icons/icon.svg -o public/icons/icon-512.png &&
//      rsvg-convert -w 120 -h 120 public/icons/icon.svg -o public/icons/logo-120.png'
//
// logo-120.png — знак для чужих экранов согласия: Google просит квадрат 120
// точек и файл легче мегабайта.
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

/**
 * Значок вкладки: одна ракета, фон прозрачный.
 * Зачем отдельно от иконки приложения: во вкладке значок ложится на цвет темы
 * браузера, и тёмный квадрат там смотрится заплаткой. У иконки приложения
 * наоборот — фон обязателен: iOS кладёт прозрачную иконку на чёрное.
 * Вызывается ниже, при сборке.
 */
function favicon() {
  const side = 64;
  const height = side * 0.94;
  const width = (height * 48) / 116;
  const mark = rocket({ height, id: 'favicon', animated: false })
    .replace(/^<svg[^>]*>/, '')
    .replace('</svg>', '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" width="${side}" height="${side}">
<g transform="translate(${(side - width) / 2} ${(side - height) / 2}) scale(${height / 116})">${mark}</g>
</svg>`;
}

mkdirSync(OUT_DIR, { recursive: true });
// Обычная иконка: ракета занимает две трети — так она читается на мелком
// значке. Maskable: система обрежет края по своей маске, поэтому запас больше.
writeFileSync(new URL('icon.svg', OUT_DIR), canvas(0.86, 0));
writeFileSync(new URL('icon-maskable.svg', OUT_DIR), canvas(0.62, 0));
writeFileSync(new URL('favicon.svg', OUT_DIR), favicon());
console.log('Векторы иконок собраны в public/icons/');
