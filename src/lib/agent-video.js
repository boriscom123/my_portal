// Сборка вертикального ролика агента из голоса и титров.
//
// Задача — сделать ролик без единого чужого кадра: фон рисует сам ffmpeg
// (медленный градиент в цветах портала), сверху логотип, под ним крупный
// заголовок на первые секунды, по центру — титры. Чужие картинки и видео на
// монетизируемых площадках — жалобы правообладателей, поэтому их здесь нет.
//
// Кадр 1080×1920, 30 кадров в секунду — то, что берут все площадки коротких
// видео без пересжатия с потерями.
// Здесь же — сборка из видео, которое снял сам автор («Сниму сам»).
// Вызывается из src/jobs/agent.js.
import { withLogo } from './logo.js';
import { subtitlesFilter } from './ffmpeg.js';

export const FRAME = { width: 1080, height: 1920, fps: 30 };

// Шрифты из образа (font-dejavu): в них есть кириллица, а без шрифта drawtext
// не нарисует ничего.
const FONT_BOLD = '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf';

// Сколько держится заголовок в начале ролика. Три секунды — зритель успевает
// прочитать пять слов, и они не мешают титрам дальше.
const HEADLINE_SECONDS = 3;

// Пауза между предложениями голоса. Без неё синтезатор читает подряд, без
// дыхания, и титры сменяют друг друга быстрее, чем их успевают прочесть.
export const SENTENCE_GAP_MS = 250;

/** Экранирование пути для фильтров ffmpeg: двоеточие и кавычка там — разделители. */
function escapePath(file) {
  return String(file).replace(/([\\':,[\]])/g, '\\$1');
}

/**
 * Раскладка реплик по предложениям: начало и конец каждого — по настоящей
 * длительности его звука, плюс пауза между ними. Так титры совпадают с
 * голосом без распознавания речи.
 */
export function layoutSentences(sentences, durationsMs, gapMs = SENTENCE_GAP_MS) {
  if (sentences.length !== durationsMs.length) {
    throw new Error('предложений и звуковых кусков должно быть поровну');
  }
  let at = 0;
  return sentences.map((text, index) => {
    const startedMs = at;
    const endedMs = at + Math.round(durationsMs[index]);
    at = endedMs + gapMs;
    return { startedMs, endedMs, text };
  });
}

/**
 * Аргументы ffmpeg для склейки кусков голоса с паузами между ними.
 * Каждый кусок, кроме последнего, дополняется тишиной (apad) и обрезается
 * ровно до своей длины плюс паузы — так шкала титров из layoutSentences
 * совпадает со звуком до миллисекунды.
 */
export function ffmpegArgsForVoice({ inputs, durationsMs, output, gapMs = SENTENCE_GAP_MS }) {
  const filters = inputs.map((_, index) => {
    const last = index === inputs.length - 1;
    const total = (durationsMs[index] + (last ? 0 : gapMs)) / 1000;
    return `[${index}:a]aresample=48000,aformat=channel_layouts=mono,apad,atrim=0:${total.toFixed(3)}[a${index}]`;
  });
  const chain = inputs.map((_, index) => `[a${index}]`).join('');
  return [
    '-hide_banner',
    '-loglevel', 'error',
    ...inputs.flatMap((file) => ['-i', file]),
    '-filter_complex', `${filters.join(';')};${chain}concat=n=${inputs.length}:v=0:a=1[out]`,
    '-map', '[out]',
    '-c:a', 'pcm_s16le',
    '-y',
    output
  ];
}

/**
 * Аргументы ffmpeg для самого ролика.
 * headlineFile — файл с текстом: так в drawtext не приходится экранировать
 * кавычки и двоеточия заголовка, а они в новостях бывают всегда.
 */
export function ffmpegArgsForAgentVideo({ audio, subtitles, headlineFile, durationSeconds, output }) {
  const { width, height, fps } = FRAME;
  const seconds = Math.max(1, durationSeconds).toFixed(3);
  // Тёмный фон в цветах портала: глубокий синий в фиолетовый. Медленно:
  // быстрое движение утомляет за сорок секунд.
  const background =
    `gradients=s=${width}x${height}:r=${fps}:d=${seconds}:speed=0.008:` +
    'c0=0x0b1026:c1=0x2a1b6b:c2=0x0f3a5f:n=3';
  const chain = [
    'format=yuv420p',
    // Заголовок — в верхней трети под логотипом, крупно, первые секунды.
    `drawtext=fontfile=${FONT_BOLD}:textfile=${escapePath(headlineFile)}:fontsize=84:` +
      'fontcolor=white:line_spacing=18:text_align=center:x=(w-text_w)/2:y=h*0.18:' +
      'box=1:boxcolor=0x000000@0.35:boxborderw=28:' +
      `enable='lt(t\\,${HEADLINE_SECONDS})'`,
    // Титры по центру кадра: внизу их закрывают кнопки площадок. Alignment=10
    // — середина кадра в старой нумерации SSA, которой libass читает стиль у
    // srt; по «цифровой клавиатуре» (5) титры уехали в левый верхний угол —
    // проверено на кадре.
    `subtitles=${escapePath(subtitles)}:force_style='FontName=DejaVu Sans,Bold=1,Fontsize=13,` +
      "PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=1.4,Shadow=0,Alignment=10,MarginL=20,MarginR=20'"
  ].join(',');
  // Логотип — всё время: ролик, пересланный без подписи, всё равно говорит,
  // откуда он. Он и заменил прежнюю строку с именем канала внизу кадра.
  const video = withLogo(chain, { input: '[0:v]', output: '[v]' });

  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'lavfi',
    '-i', background,
    '-i', audio,
    '-filter_complex', video,
    '-map', '[v]',
    '-map', '1:a',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-shortest',
    '-movflags', '+faststart',
    '-y',
    output
  ];
}

/**
 * Аргументы ffmpeg для ролика из видео автора.
 *
 * Кадр приводится к 1080×1920: вертикальное видео телефона просто
 * масштабируется, горизонтальное или квадратный кружок режется по центру —
 * чёрные поля выглядят перезаливом с другого сервиса. Титры — внизу, как у
 * нарезок из уроков: в середине кадра лицо автора. Сверху — логотип.
 * Поворот, записанный телефоном пометкой, ffmpeg применяет при чтении сам.
 */
export function ffmpegArgsForAuthorFilm({ input, subtitles, output, style = {} }) {
  const { width, height, fps } = FRAME;
  const chain = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    'setsar=1',
    `fps=${fps}`,
    subtitlesFilter(subtitles, style)
  ].join(',');
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', input,
    '-vf', withLogo(chain),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    '-y',
    output
  ];
}

/**
 * Делит заголовок на строки по словам: drawtext сам не переносит, а строка в
 * тридцать знаков шрифтом 84 вылезает за край кадра.
 */
export function wrapHeadline(text, maxChars = 16) {
  const lines = [];
  let current = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (current && `${current} ${word}`.length > maxChars) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines.join('\n');
}
