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

/**
 * Аргументы для распаковки звука в wav под whisper.cpp.
 * Зачем отдельно от ffmpegArgsForAudio: в буфере звук лежит в opus — час урока
 * весит пару мегабайт, — а whisper.cpp читает только несжатый wav 16 кГц моно,
 * и это уже сто мегабайт в час. Поэтому wav делается временно, на время счёта,
 * и удаляется сразу после.
 */
export function ffmpegArgsForWav(input, output) {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', input,
    '-vn',
    '-ar', '16000',
    '-ac', '1',
    '-c:a', 'pcm_s16le',
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

/**
 * Аргументы для вертикальной нарезки со вшитыми субтитрами.
 *
 * Кадр режется по центру в 9:16, а не сжимается: сжатый горизонтальный кадр
 * даёт чёрные поля сверху и снизу, и на площадке коротких роликов такой ролик
 * выглядит перезалитым с другого сервиса.
 *
 * Субтитры вшиваются в картинку: площадки коротких роликов отдельный файл
 * субтитров не принимают, а без подписей ролик смотрят без звука и не понимают.
 * Файл субтитров сюда приходит уже подрезанный под фрагмент и сдвинутый к
 * нулю — перемотка до -i обнуляет времена, и общий файл показывал бы реплики
 * не в такт.
 */
export function ffmpegArgsForClip({
  input,
  subtitles,
  startSeconds,
  durationSeconds,
  output,
  style = {}
}) {
  // Запятые и двоеточия в пути ffmpeg считает разделителями фильтра, а
  // одинарная кавычка обрывает имя. Экранируем — иначе урок с двоеточием в
  // имени файла уронил бы нарезку.
  const escaped = String(subtitles).replace(/([\\':,[\]])/g, '\\$1');
  const filter = [
    // Из кадра берётся центральная колонка шириной 9/16 высоты — то, что
    // остаётся, если из горизонтали вырезать вертикаль.
    'crop=ih*9/16:ih',
    'scale=1080:1920',
    // Шрифт называем явно: без имени libass просит Arial, которого в образе
    // нет, и подписи молча не рисуются.
    // Размер и отступ libass считает от условной высоты кадра в 288 точек, а
    // не от настоящих 1920 — всё здесь умножается примерно на семь. Первый
    // прогон с Fontsize=18 дал буквы в шестую часть экрана и шесть строк
    // поверх записи, а MarginV=90 поднял подпись на шестьсот точек, в середину
    // кадра. Десять и сорок — это буквы в семьдесят точек внизу кадра:
    // читается с телефона, не закрывает показываемое и не лезет под кнопки
    // площадки.
    `subtitles=${escaped}:force_style='FontName=DejaVu Sans,Fontsize=10,` +
      `PrimaryColour=${style.color ?? '&HFFFFFF'},Outline=${style.outline ?? 0.8},` +
      `Shadow=0,Alignment=2,MarginV=40'`
  ].join(',');

  return [
    '-hide_banner',
    '-loglevel', 'error',
    // Перемотка ДО -i: иначе ffmpeg читает часовой файл с начала на каждом
    // фрагменте, и пять нарезок занимают машину на час.
    '-ss', String(startSeconds),
    '-i', input,
    '-t', String(durationSeconds),
    '-vf', filter,
    // Пресет быстрее обычного: на двух ядрах медленный отнимает машину
    // вчетверо дольше, а разница в весе ролика на минуту незаметна.
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    '-y',
    output
  ];
}

/**
 * Аргументы для склейки кусков записи по списку.
 *
 * Пересжатие обязательно: куски начинаются в произвольных местах, а без
 * пересжатия склейка возможна только по опорным кадрам — срез уехал бы на
 * секунды и попал в середину фразы.
 * genpts нужен, потому что у склеенных кусков времена начинаются заново, и без
 * их пересчёта плеер показывает запись с рывками.
 */
export function ffmpegArgsForTrim({ listPath, output }) {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-fflags', '+genpts',
    '-f', 'concat',
    // Список составляем мы сами, а не человек: путь в нём наш собственный.
    '-safe', '0',
    '-i', listPath,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    '-y',
    output
  ];
}

/**
 * Разбирает вывод silencedetect в промежутки тишины.
 * Вынесено отдельно от запуска: разбор чужого вывода — то место, где ошибка
 * тихая, а проверить её без ffmpeg можно только так.
 */
export function parseSilences(lines) {
  const silences = [];
  for (const line of lines) {
    const start = line.match(/silence_start:\s*([\d.]+)/);
    if (start) {
      silences.push({ startMs: Math.round(Number(start[1]) * 1000), endMs: null });
      continue;
    }
    const end = line.match(/silence_end:\s*([\d.]+)/);
    if (end && silences.length) {
      silences.at(-1).endMs = Math.round(Number(end[1]) * 1000);
    }
  }
  // Последний промежуток может остаться без конца, если запись кончается
  // тишиной: закрываем его на конце записи, а не выбрасываем.
  return silences;
}

/**
 * Находит паузы в звуковой дорожке.
 *
 * Зачем измерять звук, а не брать промежутки между репликами расшифровки: у
 * реплик после отсечения тишины границы крупные — реплика может длиться
 * полминуты, и пауза сидит внутри неё. Первый монтаж по репликам вырезал из
 * пятидесяти двух минут семь секунд, тогда как тишины в записи оказалась
 * половина.
 */
export function detectSilence(file, { minPauseSeconds = 2, noiseDb = -40 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('nice', [
      '-n', '10', 'ffmpeg',
      '-hide_banner',
      '-i', file,
      '-af', `silencedetect=noise=${noiseDb}dB:d=${minPauseSeconds}`,
      '-f', 'null', '-'
    ]);
    const lines = [];
    child.stderr.on('data', (chunk) => {
      lines.push(...String(chunk).split('\n').filter(Boolean));
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(parseSilences(lines));
      else reject(new Error(describeFailure(code, lines)));
    });
  });
}

/** Разбирает вывод ffprobe. null, если длительность неизвестна. */
export function parseDuration(text) {
  const value = Number.parseFloat(String(text).trim());
  return Number.isFinite(value) ? value : null;
}

/**
 * Ищет в выводе назначенную жалобу.
 *
 * Не всякая беда ffmpeg — ненулевой код возврата. Пропавший шрифт он считает
 * мелочью: пишет предупреждение, рисует ролик без единой подписи и выходит
 * успешно. Обнаружить такое можно только глазами на готовом ролике, поэтому
 * назначенные предупреждения считаются отказом.
 */
export function findComplaint(lines, failOn) {
  if (!failOn) return null;
  const line = lines.find((item) => failOn.test(item));
  return line ? line.trim() : null;
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
export function runFfmpeg(args, { failOn = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('nice', ['-n', '10', 'ffmpeg', ...args]);
    const lines = [];
    child.stderr.on('data', (chunk) => {
      lines.push(...String(chunk).split('\n').filter(Boolean));
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(describeFailure(code, lines)));
        return;
      }
      const complaint = findComplaint(lines, failOn);
      if (complaint) reject(new Error(complaint));
      else resolve();
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
