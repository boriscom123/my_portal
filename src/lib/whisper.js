// Расшифровка речи на самом сервере: whisper.cpp.
//
// Задача — собрать аргументы, запустить счёт и разобрать вывод. Зачем на
// сервере, а не в облаке: облачного поставщика в проекте не будет — решение
// заказчика. Опыт на этой машине показал 2× реального времени на модели small
// в квантованном виде и полтора гигабайта памяти на пике: часовой урок
// считается полчаса, и это терпимо для одного автора.
//
// Модель качается один раз в том, а не кладётся в образ: 182 МБ в каждой
// сборке — это минуты на сборщике GitHub при каждом коммите и лишний трафик у
// того, кто раздаёт модель бесплатно.
// Вызывается из src/services/speech.js.
import { spawn } from 'node:child_process';
import { stat, rename, mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { describeFailure } from './ffmpeg.js';

/**
 * Заготовки, которые Whisper выдаёт на тишине.
 *
 * Это не наша ошибка и не поломка модели: обученная на видео с субтитрами, на
 * участке без речи она уверенно выдаёт самую частую строку из титров. Первый
 * же прогон на беззвучном файле дал «Субтитры субтитров Н.Новикова» — попади
 * такое в субтитры урока, автор получил бы чужую подпись на видео.
 *
 * Звание титра стоит в начале строки, имя после него каждый раз новое, поэтому
 * список — из начал, а не из целых фраз.
 */
const CREDIT_PREFIXES = [
  'субтитры',
  'редактор субтитров',
  'корректор',
  'перевод'
];

/**
 * Длина строки титра в словах. Титр короткий: слово-звание и имя.
 *
 * Порог нужен, потому что уроки этого проекта — про субтитры и перевод в том
 * числе: «Субтитры мы сделаем сами, дальше по конвейеру» — это речь автора, а
 * «Корректор В.Сухиашвили» — титр. Отличаются они длиной, а не словом.
 */
const CREDIT_MAX_WORDS = 5;

/** Заготовки, которые узнаются целиком, где бы в строке ни стояли. */
const JUNK_PHRASES = [
  'продолжение следует',
  'подписывайтесь на канал',
  'спасибо за просмотр',
  'dimatorzok'
];

/**
 * Сколько одинаковых реплик подряд считаем залипанием.
 *
 * На настоящем уроке заказчика звук пропал на тринадцатой минуте, и модель до
 * конца записи — ещё сорок минут — печатала «Корректор В.Сухиашвили»: 895
 * одинаковых строк из 1077. Список заготовок такого не ловит, имя в титрах
 * каждый раз новое. Ловит повтор: человек не произносит одну и ту же фразу
 * дословно четыре раза подряд с одинаковым промежутком, а модель на тишине
 * только так и делает.
 */
const REPEAT_LIMIT = 4;

/** Приводит строку к виду, в котором её можно сравнивать: без регистра и знаков. */
export function normalizeText(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Похоже ли это на заготовку из титров, а не на речь автора.
 * Проверяется вхождение, а не равенство: модель дописывает к заготовке имя,
 * год и точки в произвольном порядке.
 */
export function isHallucination(text) {
  const normalized = normalizeText(text);
  if (!normalized) return true;
  if (JUNK_PHRASES.some((phrase) => normalized.includes(phrase))) return true;

  // Титр обязан и начинаться со звания, и быть коротким: иначе под нож пошла
  // бы речь автора об этих же самых субтитрах.
  const words = normalized.split(' ');
  return (
    words.length <= CREDIT_MAX_WORDS &&
    CREDIT_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  );
}

/**
 * Аргументы whisper-cli. Вывод — JSON рядом с входным файлом.
 *
 * Отсечение тишины (vad) здесь не украшение, а лекарство от настоящей беды.
 * На уроке заказчика модель сорвалась на тринадцатой минуте и до конца записи
 * печатала одну строку из титров: 895 повторов из 1077 реплик. Причина — не
 * пропавший звук, как показалось сперва, а длинные паузы: на них модель
 * додумывает текст и залипает в нём. Перенос контекста между окнами тут ни при
 * чём, проверено — с `-mc 0` петля осталась.
 *
 * Отсечение убирает причину: тишина до модели просто не доходит. На восьми
 * минутах записи повторы исчезли полностью, а счёт стал вдвое быстрее —
 * молчание больше не считается.
 */
export function whisperArgs({ model, input, language = 'ru', threads = 2, vadModel = '' }) {
  return [
    '-m', model,
    '-f', input,
    '-l', language,
    '-t', String(threads),
    ...(vadModel ? ['--vad', '-vm', vadModel] : []),
    // Служебные токены вроде [музыка] в субтитрах не нужны, а модель их
    // выдаёт охотно.
    '--suppress-nst',
    // JSON, а не текст: нужны времена начала и конца каждой реплики, из них
    // потом собираются субтитры и поиск по уроку.
    '--output-json',
    // Печать в поток вывода не нужна: результат читается из файла, а лишние
    // мегабайты в журнале контейнера мешают искать настоящие ошибки.
    '--no-prints'
  ];
}

/** Куда whisper-cli положит JSON: к имени входного файла добавляется .json. */
export function jsonPathFor(input) {
  return `${input}.json`;
}

/**
 * Выбрасывает залипшие повторы: длинные вереницы одной и той же реплики.
 * Убирается вся вереница, а не всё кроме первой: это не речь, а след тишины,
 * и одна такая строка в субтитрах урока так же не нужна, как девятьсот.
 */
export function dropRepeats(segments, limit = REPEAT_LIMIT) {
  const result = [];
  let run = [];

  const flush = () => {
    if (run.length && run.length < limit) result.push(...run);
    run = [];
  };

  for (const segment of segments) {
    if (run.length && normalizeText(run[0].text) === normalizeText(segment.text)) {
      run.push(segment);
      continue;
    }
    flush();
    run = [segment];
  }
  flush();
  return result;
}

/**
 * Разбирает JSON whisper.cpp в сегменты с временами в миллисекундах.
 * Заготовки из титров отсеиваются здесь же: дальше по конвейеру они попали бы
 * и в субтитры, и в поиск, и в описание урока.
 */
export function parseWhisperJson(raw) {
  let body;
  try {
    body = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return { text: '', segments: [], dropped: 0 };
  }

  const all = Array.isArray(body?.transcription) ? body.transcription : [];
  const kept = [];
  let dropped = 0;

  for (const item of all) {
    const text = String(item?.text ?? '').trim();
    if (isHallucination(text)) {
      dropped += 1;
      continue;
    }
    kept.push({
      startedMs: Number(item?.offsets?.from ?? 0),
      endedMs: Number(item?.offsets?.to ?? 0),
      text
    });
  }

  const segments = dropRepeats(kept);
  return {
    text: segments.map((segment) => segment.text).join(' '),
    segments,
    dropped: dropped + (kept.length - segments.length)
  };
}

/**
 * Считает расшифровку. Возвращает содержимое JSON строкой.
 * nice -n 10 — как и у ffmpeg: на двух ядрах счёт занимает оба, и без
 * понижения приоритета портал перестаёт открываться на всё время работы.
 */
export function runWhisper(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('nice', ['-n', '10', bin, ...args]);
    const lines = [];
    const collect = (chunk) => lines.push(...String(chunk).split('\n').filter(Boolean));
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(describeFailure(code, lines)));
    });
  });
}

/**
 * Скачивает модель, если её ещё нет.
 * Пишет во временный файл и переименовывает: оборванная закачка иначе
 * останется на диске под правильным именем, и следующий запуск примет
 * половину файла за модель.
 * Вызывается из src/worker.js при старте.
 */
export async function ensureModel({ model, modelUrl, fetchImpl = fetch }) {
  const existing = await stat(model).catch(() => null);
  if (existing?.size > 0) return { downloaded: false, bytes: existing.size };

  await mkdir(path.dirname(model), { recursive: true });
  const response = await fetchImpl(modelUrl);
  if (!response.ok) throw new Error(`Модель не скачалась: ${response.status} ${modelUrl}`);

  const partial = `${model}.part`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  await rename(partial, model);

  const { size } = await stat(model);
  return { downloaded: true, bytes: size };
}
