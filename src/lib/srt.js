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
