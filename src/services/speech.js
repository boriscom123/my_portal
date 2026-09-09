// Слой распознавания речи.
//
// Задача — дать конвейеру одну функцию transcribe и спрятать за ней то, чем
// именно считается расшифровка. Зачем слой при одном поставщике: шаг конвейера
// не должен знать ни про временные wav-файлы, ни про то, что модель качается в
// том. А когда поставщик сменится, правится этот файл, а не шаг.
//
// Считаем на самом сервере (whisper.cpp): облачного поставщика в проекте не
// будет — решение заказчика.
// Вызывается из src/worker.js.
import { rm } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import {
  runFfmpeg,
  ffmpegArgsForWav,
  ffmpegArgsForWavPart,
  detectSilence,
  probeDuration
} from '../lib/ffmpeg.js';
import { planChunks, mergeChunkResults } from '../lib/chunks.js';
import { whisperArgs, runWhisper, parseWhisperJson, jsonPathFor } from '../lib/whisper.js';

/**
 * Собирает распознаватель или возвращает null.
 * null — не ошибка: портал должен подниматься и работать без расшифровки,
 * витрина и отзывы от неё не зависят. Шаг конвейера скажет об этом внятно.
 */
export function createSpeech(config) {
  const { bin, model, language, threads, vadModel, chunkMinutes } = config.whisper ?? {};
  if (!bin || !model) return null;

  return {
    /**
     * Расшифровывает файл буфера. На вход — абсолютный путь к звуку в opus.
     * Временный wav живёт только на время счёта: час урока это сто мегабайт,
     * и оставлять их на диске рядом с буфером нельзя.
     */
    async transcribe(audioPath, { onChunk = null } = {}) {
      const durationSeconds = await probeDuration(audioPath);
      const durationMs = Math.round((durationSeconds ?? 0) * 1000);

      // Тишина ищется по звуку, а не по видео: она же потом определяет, где
      // резать. Своим поиском не занимаемся — он в портале уже есть, им
      // работает вырезание пауз.
      const silences = durationMs ? await detectSilence(audioPath).catch(() => []) : [];
      const chunks = planChunks({
        durationMs,
        silences,
        ...(chunkMinutes ? { targetMs: chunkMinutes * 60 * 1000 } : {})
      });

      const parts = [];

      for (const [index, chunk] of chunks.entries()) {
        const wav = `${audioPath}.${index}.wav`;
        const json = jsonPathFor(wav);
        try {
          // Один кусок — просто весь файл: лишняя перемотка на коротком уроке
          // ничего не даёт, а ошибиться в ней можно.
          await runFfmpeg(
            chunks.length === 1
              ? ffmpegArgsForWav(audioPath, wav)
              : ffmpegArgsForWavPart({ input: audioPath, output: wav, ...chunk })
          );
          await runWhisper(bin, whisperArgs({ model, input: wav, language, threads, vadModel }));

          parts.push({ startMs: chunk.startMs, result: parseWhisperJson(await readFile(json, 'utf8')) });
          if (onChunk) onChunk({ index: index + 1, total: chunks.length });
        } finally {
          // force: true — файлов может не быть, если упало раньше их создания.
          await rm(wav, { force: true });
          await rm(json, { force: true });
        }
      }

      return { ...mergeChunkResults(parts), chunks: chunks.length };
    }
  };
}
