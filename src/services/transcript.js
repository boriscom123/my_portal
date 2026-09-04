// Пересборка субтитров после правки титров.
//
// Задача — переписать файлы субтитров по исправленным репликам. Зачем сразу, а
// не следующей сборкой: автор правит титры, скачивает файл и получает старый
// текст — и обнаруживает это уже на площадке.
//
// Пересобираются обе пары: субтитры исходной записи и субтитры смонтированной,
// если она есть. У смонтированной своя шкала времени, и брать для неё файл
// исходной нельзя — подписи опаздывали бы тем сильнее, чем дальше к концу.
// Вызывается из src/routes/admin.js.
import { writeFile, stat } from 'node:fs/promises';
import { toSrt, toVtt } from '../lib/srt.js';
import { keepRanges, remapSegments } from '../lib/trim.js';
import { detectSilence } from '../lib/ffmpeg.js';
import { readSettings } from '../lib/settings.js';
import { mediaPath, registerAsset } from '../services/media.js';

export async function rebuildSubtitles(config, pool, lessonId) {
  const { rows } = await pool.query(
    `SELECT started_ms, ended_ms, text FROM transcript_segments
      WHERE lesson_id = $1 ORDER BY started_ms`,
    [lessonId]
  );
  if (!rows.length) return [];

  const segments = rows.map((row) => ({
    startedMs: Number(row.started_ms),
    endedMs: Number(row.ended_ms),
    text: row.text
  }));

  // Цельный текст держим в согласии с репликами: по нему идёт заполнение полей
  // и он же показывается на экране проверки.
  await pool.query('UPDATE transcripts SET text = $1 WHERE lesson_id = $2', [
    segments.map((segment) => segment.text).join(' '),
    lessonId
  ]);

  const dir = `lesson-${lessonId}`;
  const written = [];

  const write = async (name, content) => {
    const relative = `${dir}/${name}`;
    await writeFile(mediaPath(config, relative), content, 'utf8');
    const { size } = await stat(mediaPath(config, relative));
    await registerAsset(pool, config, {
      lessonId,
      kind: 'subtitles',
      relativePath: relative,
      bytes: size
    });
    written.push(name);
  };

  await write('subtitles.srt', toSrt(segments));
  await write('subtitles.vtt', toVtt(segments));

  // Смонтированная запись есть — значит есть и её субтитры, и их надо
  // переписать по той же шкале, по которой её резали.
  const { rows: trimmed } = await pool.query(
    `SELECT 1 FROM assets WHERE lesson_id = $1 AND kind = 'trimmed'`,
    [lessonId]
  );
  if (!trimmed.length) return written;

  const { rows: lessons } = await pool.query(
    'SELECT duration_seconds, settings FROM lessons WHERE id = $1',
    [lessonId]
  );
  const { rows: audio } = await pool.query(
    `SELECT path FROM assets WHERE lesson_id = $1 AND kind = 'audio' ORDER BY id DESC LIMIT 1`,
    [lessonId]
  );
  if (!audio.length) return written;

  const settings = readSettings(lessons[0].settings);
  const silences = await detectSilence(mediaPath(config, audio[0].path), {
    minPauseSeconds: settings.minPauseSeconds
  });
  const ranges = keepRanges(silences, { durationSeconds: lessons[0].duration_seconds });
  const moved = remapSegments(segments, ranges);

  await write('trimmed.srt', toSrt(moved));
  await write('trimmed.vtt', toVtt(moved));
  return written;
}
