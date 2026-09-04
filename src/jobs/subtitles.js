// Шаг конвейера: сегменты расшифровки → файлы субтитров.
//
// Задача — положить в буфер .srt и .vtt. Зачем отдельным шагом: субтитры
// нужны и площадкам при публикации, и нарезкам для вшивания, и плееру на
// карточке урока — считать их трижды незачем.
// Вызывается воркером по имени JOBS.subtitles.
import { writeFile, mkdir, stat } from 'node:fs/promises';
import { toSrt, toVtt } from '../lib/srt.js';
import { mediaPath, registerAsset } from '../services/media.js';
import { addJob } from '../queue.js';

export function makeSubtitles(config, pool, queue) {
  return async ({ lessonId }) => {
    const { rows } = await pool.query(
      `SELECT started_ms, ended_ms, text FROM transcript_segments
        WHERE lesson_id = $1 ORDER BY started_ms`,
      [lessonId]
    );
    if (!rows.length) throw new Error('нет расшифровки — субтитры делать не из чего');

    const segments = rows.map((row) => ({
      startedMs: row.started_ms,
      endedMs: row.ended_ms,
      text: row.text
    }));

    const dir = `lesson-${lessonId}`;
    await mkdir(mediaPath(config, dir), { recursive: true });

    for (const [name, content] of [
      [`${dir}/subtitles.srt`, toSrt(segments)],
      [`${dir}/subtitles.vtt`, toVtt(segments)]
    ]) {
      await writeFile(mediaPath(config, name), content, 'utf8');
      const { size } = await stat(mediaPath(config, name));
      await registerAsset(pool, config, {
        lessonId,
        kind: 'subtitles',
        relativePath: name,
        bytes: size
      });
    }

    // Следующий шаг — вертикальные нарезки: им нужны и субтитры, и реплики с
    // временами. Тексты от модели пропущены: они требовали облака, которого не
    // будет; заголовок пишет автор на экране проверки.
    await addJob(queue, 'makeClips', { lessonId });
    return { segments: segments.length };
  };
}
