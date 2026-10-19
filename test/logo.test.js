// Логотип поверх вертикальных роликов.
//
// Знак должен быть на каждом ролике портала: агента, нарезке из урока, ролике
// автора. Пропавший файл картинки ffmpeg превращает в отказ сборки, поэтому
// проверяем и сам файл.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LOGO_PATH, withLogo } from '../src/lib/logo.js';
import { ffmpegArgsForClip, ffmpegArgsForBurnedSubtitles } from '../src/lib/ffmpeg.js';
import { ffmpegArgsForAgentVideo, ffmpegArgsForAuthorFilm } from '../src/lib/agent-video.js';

test('картинка логотипа лежит в репозитории и это PNG с прозрачностью', async () => {
  const file = await readFile(LOGO_PATH);
  assert.equal(file.subarray(1, 4).toString(), 'PNG');
  // Тип цвета 6 — RGBA: без прозрачности знак лёг бы на кадр прямоугольником.
  assert.equal(file[25], 6);
});

test('знак масштабируется по ширине кадра и стоит сверху по центру', () => {
  const graph = withLogo('scale=1080:1920');
  assert.match(graph, /^\[in\]scale=1080:1920,split\[base\]\[size\]/);
  assert.match(graph, /\[raw\]\[size\]scale=w=rw\*0\.42:h=-1\[logo\]/);
  assert.match(graph, /overlay=x=\(W-w\)\/2:y=H\*0\.05\[out\]$/);
  assert.match(withLogo(''), /^\[in\]split/, 'без цепочки кадр идёт прямо под знак');
});

test('логотип есть у всех вертикальных роликов', () => {
  const graphs = [
    ffmpegArgsForClip({ input: 'a.mp4', subtitles: 'a.srt', startSeconds: 0, durationSeconds: 5, output: 'b.mp4' }),
    ffmpegArgsForClip({ input: 'a.mp4', subtitles: null, startSeconds: 0, durationSeconds: 5, output: 'b.mp4' }),
    ffmpegArgsForBurnedSubtitles({ input: 'a.mp4', subtitles: 'a.srt', output: 'b.mp4' }),
    ffmpegArgsForAuthorFilm({ input: 'a.mp4', subtitles: 'a.srt', output: 'b.mp4' }),
    ffmpegArgsForAgentVideo({ audio: 'a.wav', subtitles: 'a.srt', headlineFile: 'h.txt', durationSeconds: 5, output: 'b.mp4' })
  ].map((args) => args[args.findIndex((arg) => arg === '-vf' || arg === '-filter_complex') + 1]);
  for (const graph of graphs) assert.ok(graph.includes(`movie=${LOGO_PATH}`), graph);
});

test('ролик автора приводится к 1080×1920 обрезкой, а не полями', () => {
  const args = ffmpegArgsForAuthorFilm({ input: 'a.mp4', subtitles: 'a.srt', output: 'b.mp4' });
  const graph = args[args.indexOf('-vf') + 1];
  assert.match(graph, /scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920/);
  assert.match(graph, /Alignment=2/, 'титры внизу: в середине кадра лицо автора');
});
