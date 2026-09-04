// Сборка субтитров из сегментов расшифровки.
//
// Задача — превратить отрезки с таймкодами в два чужих формата: .srt для
// площадок и .vtt для веб-плеера. Зачем оба: YouTube и VK принимают srt, а
// браузерный <track> понимает только vtt. Форматы различаются одним знаком в
// записи времени — и на этом знаке файл молча отвергается.
// Вызывается из src/jobs/subtitles.js.

/** Время в формате srt: ЧЧ:ММ:СС,мс — именно с запятой. */
export function formatSrtTime(ms) {
  return formatTime(ms, ',');
}

/** Время в формате vtt: ЧЧ:ММ:СС.мс — именно с точкой. */
export function formatVttTime(ms) {
  return formatTime(ms, '.');
}

function formatTime(ms, separator) {
  const total = Math.max(0, Math.round(ms));
  const hours = String(Math.floor(total / 3_600_000)).padStart(2, '0');
  const minutes = String(Math.floor((total % 3_600_000) / 60_000)).padStart(2, '0');
  const seconds = String(Math.floor((total % 60_000) / 1000)).padStart(2, '0');
  const millis = String(total % 1000).padStart(3, '0');
  return `${hours}:${minutes}:${seconds}${separator}${millis}`;
}

/**
 * Схлопывает переносы внутри реплики.
 * В обоих форматах пустая строка разделяет блоки: перенос внутри текста
 * оборвал бы блок на середине, и остаток реплики стал бы мусором.
 */
function oneLine(text) {
  return String(text).replace(/\s*\n+\s*/g, '\n').trim();
}

/** Файл .srt: пронумерованные блоки, разделённые пустой строкой. */
export function toSrt(segments) {
  return segments
    .map((segment, index) =>
      [
        index + 1,
        `${formatSrtTime(segment.startedMs)} --> ${formatSrtTime(segment.endedMs)}`,
        oneLine(segment.text),
        ''
      ].join('\n')
    )
    .join('\n');
}

/** Файл .vtt: та же разметка, но с обязательной первой строкой и точкой. */
export function toVtt(segments) {
  const blocks = segments.map((segment) =>
    [
      `${formatVttTime(segment.startedMs)} --> ${formatVttTime(segment.endedMs)}`,
      oneLine(segment.text),
      ''
    ].join('\n')
  );
  return ['WEBVTT', '', ...blocks].join('\n');
}

/**
 * Дробит длинные реплики на короткие, деля время пропорционально длине.
 *
 * Whisper отдаёт реплику целым предложением — на девять секунд может прийтись
 * строка в сто знаков. В субтитрах урока это нормально, а во вертикальном
 * ролике такая строка занимает полкадра и закрывает то, что показывают.
 * Проверено на настоящем ролике: шесть строк поверх экрана записи.
 *
 * Делим по словам: разрыв посреди слова читается как опечатка.
 * Вызывается из src/jobs/make-clips.js.
 */
export function splitLongSegments(segments, maxChars = 40) {
  const result = [];

  for (const segment of segments) {
    const words = String(segment.text).split(/\s+/).filter(Boolean);
    if (!words.length) continue;

    const chunks = [];
    let current = '';
    for (const word of words) {
      if (current && `${current} ${word}`.length > maxChars) {
        chunks.push(current);
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    }
    if (current) chunks.push(current);

    // Время делим по длине кусков, а не поровну: короткий кусок читается
    // быстрее длинного, и равные доли рассинхронизировали бы подписи с речью.
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const spanMs = segment.endedMs - segment.startedMs;
    let startedMs = segment.startedMs;

    for (const [index, chunk] of chunks.entries()) {
      const endedMs =
        index === chunks.length - 1
          ? segment.endedMs
          : startedMs + Math.round((spanMs * chunk.length) / total);
      result.push({ startedMs, endedMs, text: chunk });
      startedMs = endedMs;
    }
  }

  return result;
}
