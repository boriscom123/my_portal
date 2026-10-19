// Сборка логотипа для роликов: ракета и надпись SOLO AI JOURNEY.
//
// Задача — получить картинку с прозрачным фоном, которую ffmpeg кладёт поверх
// каждого вертикального ролика: агента, нарезки из урока, снятого автором.
// Источник тот же, что у шапки сайта: ракета из src/views/rocket.js, шрифт
// Unbounded из public/fonts, цвета — фирменный перелив тёмной темы. Ролики
// почти всегда тёмные, и светлые цвета дневной темы на них тускнеют.
//
// Зачем браузер, а не rsvg: надпись набрана Unbounded, а он лежит у нас в
// woff2, который rsvg не читает. Браузер рисует знак ровно так, как его видит
// посетитель сайта.
//
// Запускается вручную после правки знака: `npm run logo`. Нужен Chromium —
// путь к нему в CHROME. Проще всего — в образе Playwright, там есть и браузер,
// и всё, что ему нужно:
//
//   docker run --rm -u "$(id -u)" -e HOME=/tmp -v "$PWD":"$PWD" -w "$PWD" \
//     mcr.microsoft.com/playwright:v1.49.0-jammy sh -c \
//     'CHROME=$(ls -d /ms-playwright/chromium-*/chrome-linux/chrome) node scripts/build-logo.mjs'
//
// Готовая картинка — public/brand/logo.png, её и берёт src/lib/logo.js.
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { inflateSync, deflateSync, crc32 } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rocket } from '../src/views/rocket.js';

const ROOT = new URL('../', import.meta.url);
const OUT_DIR = new URL('public/brand/', ROOT);
// Холст вдвое крупнее, чем знак ляжет в кадр: уменьшенный растр остаётся
// чётким, увеличенный — мылит.
const WIDTH = 760;
const HEIGHT = 290;
// Окно браузера выше холста: Chromium отнимает от высоты окна свою невидимую
// рамку, и знак без запаса обрезался снизу по пламя. Лишнее потом срезаем.
const WINDOW_EXTRA = 200;

function page() {
  const fonts = fileURLToPath(new URL('public/fonts/', ROOT));
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Unbounded; font-weight: 800; src: url(file://${fonts}unbounded-800-latin.woff2) format('woff2'); }
@font-face { font-family: Unbounded; font-weight: 400; src: url(file://${fonts}unbounded-400-latin.woff2) format('woff2'); }
html, body { margin: 0; background: transparent; }
.logo {
  width: ${WIDTH}px; height: ${HEIGHT}px;
  display: flex; align-items: center; justify-content: center; gap: 34px;
  /* Тень отделяет знак от светлого кадра: на записи экрана под ним бывает
     белое окно, и белая надпись на нём пропадает. */
  filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.55));
}
.words { display: flex; flex-direction: column; gap: 14px; }
.mark {
  font-family: Unbounded; font-weight: 800; font-size: 112px; line-height: 1;
  background: linear-gradient(96deg, #8482fd 0%, #aa5eff 45%, #e060b4 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.tail {
  font-family: Unbounded; font-weight: 400; font-size: 46px; line-height: 1;
  letter-spacing: 0.42em; color: #ffffff;
}
</style></head><body>
<div class="logo">
  ${rocket({ height: 236, id: 'logo', animated: false })}
  <div class="words"><span class="mark">SOLO AI</span><span class="tail">JOURNEY</span></div>
</div>
</body></html>`;
}

/**
 * Оставляет у PNG верхние rows строк.
 * Без библиотек: строки PNG фильтруются только по строкам ВЫШЕ себя, поэтому
 * верхние строки можно взять как есть, не раскодируя, — достаточно распаковать
 * данные, отрезать хвост и упаковать обратно.
 */
function cropRows(file, rows) {
  const chunks = [];
  for (let at = 8; at < file.length; ) {
    const length = file.readUInt32BE(at);
    chunks.push({ type: file.toString('latin1', at + 4, at + 8), data: file.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  const header = Buffer.from(chunks.find((chunk) => chunk.type === 'IHDR').data);
  const width = header.readUInt32BE(0);
  if (header[8] !== 8 || header[9] !== 6) throw new Error('ожидался PNG RGBA по 8 бит');
  const pixels = inflateSync(Buffer.concat(chunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data)));
  header.writeUInt32BE(rows, 4);
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  return Buffer.concat([
    file.subarray(0, 8),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels.subarray(0, rows * (1 + width * 4)))),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const chrome = process.env.CHROME;
if (!chrome) {
  console.error('Укажите путь к Chromium в CHROME');
  process.exit(1);
}
mkdirSync(OUT_DIR, { recursive: true });
// Страница — во временной папке: в public она ушла бы на сайт вместе с
// путями этой машины.
const html = `${tmpdir()}/solo-logo.html`;
const png = fileURLToPath(new URL('logo.png', OUT_DIR));
writeFileSync(html, page());
execFileSync(chrome, [
  '--headless=new',
  // Страница своя и локальная; без этого флага Chromium не стартует в контейнере.
  '--no-sandbox',
  '--disable-gpu',
  '--hide-scrollbars',
  '--allow-file-access-from-files',
  '--default-background-color=00000000',
  `--window-size=${WIDTH},${HEIGHT + WINDOW_EXTRA}`,
  `--screenshot=${png}`,
  `file://${html}`
]);
writeFileSync(png, cropRows(readFileSync(png), HEIGHT));
rmSync(html);
console.log('Логотип собран: public/brand/logo.png');
