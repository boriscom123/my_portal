// Готовые титры из монтажа вместо распознавания.
//
// Задача — принять файл .srt, который автор выгрузил из CapCut вместе с
// видео, и сделать из него расшифровку урока. Зачем: титры там уже вычитаны,
// а whisper дал бы текст хуже и занял бы у сервера полчаса и гигабайт памяти.
//
// Дальше урок живёт как обычный: поиск, субтитры для площадок, тексты от
// модели и правка в редакторе титров берут реплики из той же таблицы. Отличие
// одно — поставщик расшифровки 'srt', и по нему конвейер пропускает whisper.
// Вызывается из src/routes/upload.js и src/jobs/extract-audio.js.
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { parseSrt } from '../lib/srt.js';
import { mediaPath, registerAsset } from './media.js';
import { rebuildSubtitles } from './transcript.js';

/** Поставщик расшифровки для титров из файла. */
export const IMPORTED_PROVIDER = 'srt';

// Имена файлов. Исходный файл автора храним рядом: его можно скачать обратно,
// а по субтитрам, пересобранным после правки, исходник уже не восстановить.
const IMPORTED_NAME = 'imported.srt';
const BUILT_NAMES = ['subtitles.srt', 'subtitles.vtt', 'trimmed.srt', 'trimmed.vtt'];

/** Пришла ли расшифровка урока из файла, а не из распознавания. */
export async function hasImportedSubtitles(pool, lessonId) {
  const { rows } = await pool.query('SELECT provider FROM transcripts WHERE lesson_id = $1', [
    lessonId
  ]);
  return rows[0]?.provider === IMPORTED_PROVIDER;
}

/**
 * Заменяет расшифровку урока репликами из файла .srt.
 * Разбор идёт первым: битый файл не должен стереть то, что было.
 * Возвращает число реплик и конец последней — по нему видно, подходит ли файл
 * к записи.
 */
export async function importSubtitles(config, pool, lessonId, content) {
  const segments = parseSrt(content);

  await pool.query('DELETE FROM transcript_segments WHERE lesson_id = $1', [lessonId]);
  await pool.query(
    `INSERT INTO transcripts (lesson_id, text, provider) VALUES ($1, $2, $3)
     ON CONFLICT (lesson_id) DO UPDATE SET text = EXCLUDED.text,
                                           provider = EXCLUDED.provider,
                                           created_at = now()`,
    [lessonId, segments.map((segment) => segment.text).join(' '), IMPORTED_PROVIDER]
  );
  // Одним запросом: у часового урока реплик тысяча, и тысяча запросов подряд —
  // это заметная пауза в форме загрузки.
  await pool.query(
    `INSERT INTO transcript_segments (lesson_id, started_ms, ended_ms, text)
     SELECT $1, * FROM unnest($2::int[], $3::int[], $4::text[])`,
    [
      lessonId,
      segments.map((segment) => segment.startedMs),
      segments.map((segment) => segment.endedMs),
      segments.map((segment) => segment.text)
    ]
  );

  const dir = `lesson-${lessonId}`;
  await mkdir(mediaPath(config, dir), { recursive: true });
  const relative = `${dir}/${IMPORTED_NAME}`;
  await writeFile(mediaPath(config, relative), content, 'utf8');
  await registerAsset(pool, config, {
    lessonId,
    kind: 'subtitles',
    relativePath: relative,
    bytes: Buffer.byteLength(content)
  });

  // Файлы субтитров — сразу, а не по кнопке «Обработать»: титры готовы, и
  // ждать для них обработки звука незачем.
  await rebuildSubtitles(config, pool, lessonId);

  return { segments: segments.length, lastEndedMs: segments.at(-1).endedMs };
}

/**
 * Убирает титры из файла, чтобы урок снова пошёл через распознавание.
 * Только их: расшифровку от whisper этим не стереть — её заменяет повторная
 * обработка. Собранные из титров файлы субтитров уходят тоже, иначе плеер и
 * площадки получали бы текст, которого у урока больше нет.
 */
export async function removeImportedSubtitles(config, pool, lessonId) {
  if (!(await hasImportedSubtitles(pool, lessonId))) return false;

  await pool.query('DELETE FROM transcript_segments WHERE lesson_id = $1', [lessonId]);
  await pool.query('DELETE FROM transcripts WHERE lesson_id = $1', [lessonId]);

  const dir = `lesson-${lessonId}`;
  const paths = [IMPORTED_NAME, ...BUILT_NAMES].map((name) => `${dir}/${name}`);
  await pool.query(
    `DELETE FROM assets WHERE lesson_id = $1 AND kind = 'subtitles' AND path = ANY($2::text[])`,
    [lessonId, paths]
  );
  for (const relative of paths) {
    await rm(mediaPath(config, relative), { force: true });
  }
  return true;
}
