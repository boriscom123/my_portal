// Шаг конвейера: расшифровка речи.
//
// Задача — превратить звук в текст с временами и положить в базу. Ради времён
// всё и делается: из них собираются субтитры, а поиск ведёт зрителя на нужную
// секунду урока, а не на урок целиком.
// Вызывается воркером по имени JOBS.transcribe.
import { access } from 'node:fs/promises';
import { mediaPath, assetById } from '../services/media.js';
import { addJob } from '../queue.js';

export function makeTranscribe(config, pool, queue, speech) {
  return async ({ lessonId, audioAssetId }) => {
    if (!speech) {
      throw new Error(
        'Распознавание не настроено: нет whisper-cli или модели. Проверьте WHISPER_BIN и WHISPER_MODEL.'
      );
    }

    const audio = await assetById(pool, Number(audioAssetId));
    if (!audio) throw new Error('звука для расшифровки нет в буфере');

    const input = mediaPath(config, audio.path);
    try {
      await access(input);
    } catch {
      throw new Error(
        `файла ${audio.path} нет в буфере — вероятно, он удалён по сроку; загрузите исходник заново`
      );
    }

    const { text, segments, dropped, chunks } = await speech.transcribe(input, {
      onChunk: ({ index, total }) =>
        total > 1 ? console.log(`Расшифровка: кусок ${index} из ${total} готов`) : null
    });
    if (chunks > 1) {
      // Длинная запись считается кусками по получасу — так расход памяти не
      // зависит от длины урока. В журнале это видно, чтобы «двадцать минут
      // тишины» не выглядели зависанием.
      console.log(`Расшифровка: запись посчитана ${chunks} кусками`);
    }
    if (dropped) {
      // Не молча: заготовки из титров — известное поведение модели на тишине,
      // и по их числу видно, много ли в уроке участков без речи.
      console.log(`Расшифровка: отброшено заготовок из титров — ${dropped}`);
    }

    // Повтор шага заменяет расшифровку, а не удваивает: два текста на урок
    // сделали бы поиск бессмысленным, а субтитры — вдвое длиннее записи.
    await pool.query('DELETE FROM transcript_segments WHERE lesson_id = $1', [lessonId]);
    await pool.query(
      `INSERT INTO transcripts (lesson_id, text, provider) VALUES ($1, $2, 'whisper.cpp')
       ON CONFLICT (lesson_id) DO UPDATE SET text = EXCLUDED.text,
                                             provider = EXCLUDED.provider,
                                             created_at = now()`,
      [lessonId, text]
    );

    for (const segment of segments) {
      await pool.query(
        `INSERT INTO transcript_segments (lesson_id, started_ms, ended_ms, text)
         VALUES ($1, $2, $3, $4)`,
        [lessonId, segment.startedMs, segment.endedMs, segment.text]
      );
    }

    // Речи в записи может не быть вовсе — например, урок целиком показывает
    // экран под музыку. Это не повод ронять обработку: субтитры пропускаем и
    // на этом заканчиваем, иначе урок застрял бы в «обработке» навсегда.
    if (segments.length) {
      await addJob(queue, 'subtitles', { lessonId });
    } else {
      await pool.query(
        `UPDATE lessons SET pipeline_state = 'review', pipeline_error = NULL WHERE id = $1`,
        [lessonId]
      );
    }
    return { segments: segments.length, dropped, characters: text.length };
  };
}
