// Пережатие обложки настоящим ffmpeg. Проверять его заглушкой значило бы не
// проверять ничего: аргументы можно написать верно по виду и всё равно получить
// файл прежнего размера — а узнали бы мы об этом отказом площадки, у которой
// обложка не влезла в предел.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { runFfmpeg, shrinkThumbnail } from '../src/lib/ffmpeg.js';

/** Есть ли ffmpeg. В образе он есть, на чужой машине может не быть. */
const hasFfmpeg = await new Promise((resolve) => {
  const child = spawn('ffmpeg', ['-version']);
  child.on('error', () => resolve(false));
  child.on('close', (code) => resolve(code === 0));
});
const skipWithoutFfmpeg = { skip: hasFfmpeg ? false : 'ffmpeg не установлен' };

/** Ширина картинки по ffprobe. */
function probeWidth(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width',
      '-of', 'default=nw=1:nk=1',
      file
    ]);
    let out = '';
    child.stdout.on('data', (chunk) => (out += String(chunk)));
    child.on('error', reject);
    child.on('close', () => resolve(Number(out.trim())));
  });
}

test('пережатая обложка легче и уже исходной', skipWithoutFfmpeg, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'thumb-'));
  const big = path.join(dir, 'cover.jpg');
  // Крупный шумный кадр: на однотонном jpeg сжимать нечего, и проверка вышла бы
  // ни о чём.
  await runFfmpeg([
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=3840x2160:duration=1:rate=1',
    '-frames:v', '1', '-q:v', '1', '-y', big
  ]);

  const before = (await stat(big)).size;
  const smaller = await shrinkThumbnail(big);
  const after = (await stat(smaller)).size;

  assert.ok(after < before, `пережатая (${after}) должна быть легче исходной (${before})`);
  assert.ok(after < 2_000_000, `пережатая (${after}) должна укладываться в предел площадки`);
  assert.equal(await probeWidth(smaller), 1280);
  assert.notEqual(smaller, big, 'исходную обложку портить нельзя — она нужна витрине');
});
