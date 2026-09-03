// Запуск ffmpeg.
//
// Задача — собрать аргументы, запустить процесс и превратить его отказ в
// понятную человеку ошибку. Зачем обёрткой: ffmpeg пишет диагностику в поток
// ошибок и возвращает голый код возврата — без разбора в кабинете было бы
// написано «код 1», и автор не узнал бы, что файл повреждён.
// Вызывается из задач в src/jobs/.
import { spawn } from 'node:child_process';

// Сколько последних строк вывода сохраняем для объяснения. Больше незачем:
// причина отказа всегда в конце, а начало — это перечень кодеков на экран.
const TAIL_LINES = 12;

/** Аргументы для извлечения звуковой дорожки под распознавание. */
export function ffmpegArgsForAudio(input, output) {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', input,
    // Видео выбрасываем: сервису распознавания оно не нужно, а весит всё.
    '-vn',
    // 16 кГц моно — то, что просят сервисы распознавания. Больше не нужно:
    // лишние килогерцы увеличивают файл, но не точность.
    '-ar', '16000',
    '-ac', '1',
    '-c:a', 'libopus',
    '-b:a', '24k',
    '-y',
    output
  ];
}

/** Аргументы для кадра на обложку. */
export function ffmpegArgsForCover({ input, atSeconds, output }) {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    // Перемотка ДО -i: иначе ffmpeg читает часовой файл с начала ради одного
    // кадра из середины.
    '-ss', String(atSeconds),
    '-i', input,
    '-frames:v', '1',
    // 1280 по ширине — то, что просят площадки для превью; -2 сохраняет
    // пропорции и держит высоту чётной, иначе кодек ругается.
    '-vf', 'scale=1280:-2',
    '-q:v', '3',
    '-y',
    output
  ];
}

/** Разбирает вывод ffprobe. null, если длительность неизвестна. */
export function parseDuration(text) {
  const value = Number.parseFloat(String(text).trim());
  return Number.isFinite(value) ? value : null;
}

/** Складывает объяснение отказа из кода возврата и хвоста вывода. */
export function describeFailure(code, lines) {
  const tail = lines.slice(-TAIL_LINES).join('\n').trim();
  return `ffmpeg завершился с кодом ${code}${tail ? `:\n${tail}` : ''}`;
}

/**
 * Запускает ffmpeg и ждёт завершения.
 * nice повышает уступчивость процесса: на двух ядрах ffmpeg иначе съедает оба,
 * и портал перестаёт отвечать на запросы, пока идёт обработка.
 */
export function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('nice', ['-n', '10', 'ffmpeg', ...args]);
    const lines = [];
    child.stderr.on('data', (chunk) => {
      lines.push(...String(chunk).split('\n').filter(Boolean));
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(describeFailure(code, lines)));
    });
  });
}

/** Длительность файла в секундах через ffprobe. null, если не определилась. */
export function probeDuration(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      file
    ]);
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.on('error', reject);
    child.on('close', () => resolve(parseDuration(out)));
  });
}
