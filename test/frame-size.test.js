// Размер кадра с учётом поворота.
//
// Заказчик 2026-09-16 снял ролик телефоном и получил отказ «Ролик
// горизонтальный (1920×1080)», хотя ролик вертикальный. Телефон пишет кадр
// как есть — 1920×1080, — а рядом кладёт пометку поворота на 90°, и по ней
// проигрыватель показывает видео вертикально. Читать только ширину и высоту
// значит не верить самому файлу.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseFrameSize, probeFrameSize, runFfmpeg } from '../src/lib/ffmpeg.js';

test('поворот на 90° и 270° меняет стороны местами', () => {
  // Так выглядит вывод ffprobe: ширина, высота и поворот.
  assert.deepEqual(parseFrameSize('1920,1080,90'), { width: 1080, height: 1920 });
  assert.deepEqual(parseFrameSize('1920,1080,-90'), { width: 1080, height: 1920 });
  assert.deepEqual(parseFrameSize('1920,1080,270'), { width: 1080, height: 1920 });
});

test('поворот на 0° и 180° сторон не меняет', () => {
  assert.deepEqual(parseFrameSize('1920,1080,0'), { width: 1920, height: 1080 });
  assert.deepEqual(parseFrameSize('1920,1080,180'), { width: 1920, height: 1080 });
  assert.deepEqual(parseFrameSize('1080,1920,180'), { width: 1080, height: 1920 });
});

test('пометки поворота нет — размер как записан', () => {
  // Старые файлы и запись с экрана: третьего числа в выводе просто не будет.
  assert.deepEqual(parseFrameSize('1920,1080'), { width: 1920, height: 1080 });
  assert.deepEqual(parseFrameSize('1080,1920\n'), { width: 1080, height: 1920 });
});

test('не видео — размера нет', () => {
  assert.equal(parseFrameSize(''), null);
  assert.equal(parseFrameSize('N/A,N/A'), null);
  assert.equal(parseFrameSize('0,0'), null);
});

const hasFfmpeg = await new Promise((resolve) => {
  const child = spawn('ffmpeg', ['-version']);
  child.on('error', () => resolve(false));
  child.on('close', (code) => resolve(code === 0));
});

test('на настоящем ffmpeg: ролик с телефона считается вертикальным', async (t) => {
  if (!hasFfmpeg) return t.skip('ffmpeg не установлен');
  const dir = await mkdtemp(path.join(tmpdir(), 'portal-rotation-'));
  const plain = path.join(dir, 'plain.mp4');
  const rotated = path.join(dir, 'rotated.mp4');

  // Кадр записан горизонтально, как его и пишет телефон.
  await runFfmpeg([
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=25:duration=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', plain
  ]);
  // Пометка поворота рядом с кадром — то, что делает ролик вертикальным.
  await runFfmpeg([
    '-hide_banner', '-loglevel', 'error',
    '-display_rotation', '90', '-i', plain, '-c', 'copy', '-y', rotated
  ]);

  assert.deepEqual(await probeFrameSize(plain), { width: 1920, height: 1080 });
  assert.deepEqual(
    await probeFrameSize(rotated),
    { width: 1080, height: 1920 },
    'ролик с пометкой поворота считается горизонтальным — его отказываются принимать'
  );
});
