// Логотип поверх вертикальных роликов: ракета и SOLO AI JOURNEY.
//
// Задача — чтобы любой ролик портала говорил, откуда он, даже пересланный без
// подписи: ролик агента, нарезка из урока, ролик, снятый автором. Картинку
// собирает scripts/build-logo.mjs, здесь — только как положить её в кадр.
//
// Знак — сверху по центру: внизу его закрывают подпись и кнопки площадок, а
// по бокам — значки лайков и профиля.
// Вызывается из src/lib/ffmpeg.js и src/lib/agent-video.js.
import { fileURLToPath } from 'node:url';

export const LOGO_PATH = fileURLToPath(new URL('../../public/brand/logo.png', import.meta.url));

// Ширина знака — доля ширины кадра, а не точки: кадры бывают и 1080, и 720,
// и меньше — у автора, снявшего ролик на старый телефон.
const WIDTH_SHARE = 0.42;
// Отступ сверху — доля высоты: над знаком на площадках лежат вкладки и время.
const TOP_SHARE = 0.05;

function escapePath(file) {
  return String(file).replace(/([\\':,[\]])/g, '\\$1');
}

/**
 * Граф фильтров: цепочка chain над кадром, затем логотип поверх.
 * Знак масштабируется по ширине уже обработанного кадра — для этого кадр
 * раздваивается: одна копия идёт под знак, другая служит меркой для scale.
 *
 * input и output — метки входа и выхода: в -vf это [in] и [out], в
 * -filter_complex — номер потока вроде [0:v] и своя метка.
 */
export function withLogo(chain, { input = '[in]', output = '[out]', logo = LOGO_PATH } = {}) {
  const base = chain ? `${input}${chain},split[base][size]` : `${input}split[base][size]`;
  return [
    base,
    `movie=${escapePath(logo)}[raw]`,
    `[raw][size]scale=w=rw*${WIDTH_SHARE}:h=-1[logo]`,
    `[base][logo]overlay=x=(W-w)/2:y=H*${TOP_SHARE}${output}`
  ].join(';');
}
