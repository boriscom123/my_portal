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
import { runFfmpeg, ffmpegArgsForWav } from '../lib/ffmpeg.js';
import { whisperArgs, runWhisper, parseWhisperJson, jsonPathFor } from '../lib/whisper.js';

/**
 * Собирает распознаватель или возвращает null.
 * null — не ошибка: портал должен подниматься и работать без расшифровки,
 * витрина и отзывы от неё не зависят. Шаг конвейера скажет об этом внятно.
 */
export function createSpeech(config) {
  const { bin, model, language, threads } = config.whisper ?? {};
  if (!bin || !model) return null;

  return {
    /**
     * Расшифровывает файл буфера. На вход — абсолютный путь к звуку в opus.
     * Временный wav живёт только на время счёта: час урока это сто мегабайт,
     * и оставлять их на диске рядом с буфером нельзя.
     */
    async transcribe(audioPath) {
      const wav = `${audioPath}.wav`;
      const json = jsonPathFor(wav);
      try {
        await runFfmpeg(ffmpegArgsForWav(audioPath, wav));
        await runWhisper(bin, whisperArgs({ model, input: wav, language, threads }));
        return parseWhisperJson(await readFile(json, 'utf8'));
      } finally {
        // force: true — файлов может не быть, если упало раньше их создания.
        await rm(wav, { force: true });
        await rm(json, { force: true });
      }
    }
  };
}
