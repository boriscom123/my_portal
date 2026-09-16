// Шаг по кнопке: текст ролика для площадок.
//
// Задача — расшифровать речь ролика и попросить у модели подпись для
// Instagram: первую строку, описание и хэштеги. Площадка ранжирует ролик по
// словам подписи, и написать их по делу можно только зная, что в ролике
// сказано.
//
// Зачем очередью: расшифровка идёт на тех же двух ядрах, что и всё остальное,
// а модель на бесплатной доле отвечает дольше, чем nginx держит запрос.
// Расшифровка считается один раз на файл — повторное нажатие просит у модели
// другой вариант, не трогая whisper.
//
// Отказ не бросается дальше, а ложится в заготовку: страница ждёт ответ и
// перестаёт ждать, только увидев его. Повторить автор может той же кнопкой.
// Вызывается воркером по имени JOBS.suggestShortTexts.
import { access, rm } from 'node:fs/promises';
import path from 'node:path';
import { runFfmpeg, ffmpegArgsForAudio } from '../lib/ffmpeg.js';
import { mediaPath, assetById } from '../services/media.js';
import { getShortById, normalizeHashtags } from '../services/shorts.js';
import { suggestFromTranscript } from '../lib/summary.js';

async function saveSuggestion(pool, shortId, suggested) {
  await pool.query(
    `UPDATE shorts SET generated = jsonb_set(generated, '{suggested}', $1::jsonb) WHERE id = $2`,
    [JSON.stringify({ ...suggested, at: new Date().toISOString() }), shortId]
  );
}

/** Звук ролика → текст. Временный звук удаляется сразу: он нужен одну минуту. */
async function transcribeShort(config, pool, short, { speech, ffmpeg }) {
  if (!speech) {
    throw new Error('распознавание не настроено: нет whisper-cli или модели');
  }
  const asset = await assetById(pool, short.assetId);
  if (!asset) throw new Error('файла ролика нет в учёте — загрузите его заново');

  const input = mediaPath(config, asset.path);
  try {
    await access(input);
  } catch {
    throw new Error(`файла ${asset.path} нет в буфере — загрузите ролик заново`);
  }

  // Имя с номером ролика: нарезка лежит в папке урока, и у двух роликов из
  // одного урока звук иначе лёг бы в один файл.
  const audio = mediaPath(config, `${path.dirname(asset.path)}/short-${short.id}-audio.ogg`);
  try {
    await ffmpeg(ffmpegArgsForAudio(input, audio));
    const { text } = await speech.transcribe(audio);
    return String(text ?? '').trim();
  } finally {
    await rm(audio, { force: true });
  }
}

export function makeSuggestShortTexts(config, pool, { speech, texts, ffmpeg = runFfmpeg }) {
  return async ({ shortId }) => {
    const short = await getShortById(pool, shortId);
    if (!short) return { skipped: 'ролика уже нет' };

    try {
      if (!short.assetId) throw new Error('у ролика нет файла — сначала загрузите его');

      let transcript = short.transcript;
      if (!transcript) {
        transcript = await transcribeShort(config, pool, short, { speech, ffmpeg });
        // Ролик под музыку без слов — не сбой распознавания. Писать подпись не
        // из чего, и модель честно выдумала бы её из воздуха.
        if (!transcript) throw new Error('речи в ролике не нашлось — текст писать не из чего');
        await pool.query('UPDATE shorts SET transcript = $1 WHERE id = $2', [transcript, shortId]);
      }

      let suggested;
      try {
        if (!texts) throw new Error('ключ модели не задан');
        suggested = {
          ...(await texts.suggestShort(transcript, { lessonTitle: short.lesson?.title ?? '' })),
          source: 'model'
        };
      } catch (error) {
        // Как у урока: без модели автор получает хотя бы извлечённое из текста
        // и знает, почему вышло грубее.
        console.error(`Текст ролика от модели не получен: ${error.message}`);
        const rough = suggestFromTranscript(transcript);
        suggested = {
          title: rough.title,
          description: rough.description,
          hashtags: normalizeHashtags(rough.tags).slice(0, 5),
          source: 'transcript',
          warning: `Модель не ответила (${error.message}); заполнено из расшифровки.`
        };
      }
      await saveSuggestion(pool, shortId, suggested);
      return { source: suggested.source, characters: transcript.length };
    } catch (error) {
      await saveSuggestion(pool, shortId, { error: error.message.slice(0, 300) });
      return { failed: error.message };
    }
  };
}
