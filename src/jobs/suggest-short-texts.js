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
// другой вариант, не трогая whisper и не стирая правки автора в репликах.
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
  // Звук берём из файла без титров: он тот же, но вшитый файл могли и удалить.
  const asset = await assetById(pool, short.sourceAssetId ?? short.assetId);
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
    const { text, segments = [] } = await speech.transcribe(audio);
    return {
      text: String(text ?? '').trim(),
      segments: segments
        .map((segment) => ({
          startedMs: Number(segment.startedMs),
          endedMs: Number(segment.endedMs),
          text: String(segment.text ?? '').trim()
        }))
        .filter((segment) => segment.text)
    };
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

      // Считаем заново, только если реплик нет: иначе повторное нажатие стёрло
      // бы правки автора. Ролик, расшифрованный до появления титров, реплик не
      // имеет — его пересчитываем.
      let transcript = short.transcript;
      if (!short.segments.length) {
        const heard = await transcribeShort(config, pool, short, { speech, ffmpeg });
        transcript = heard.text;
        // Ролик под музыку без слов — не сбой распознавания. Писать подпись не
        // из чего, и модель честно выдумала бы её из воздуха.
        if (!transcript) throw new Error('речи в ролике не нашлось — текст писать не из чего');
        await pool.query('UPDATE shorts SET transcript = $1, segments = $2::jsonb WHERE id = $3', [
          transcript,
          JSON.stringify(heard.segments),
          shortId
        ]);
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
