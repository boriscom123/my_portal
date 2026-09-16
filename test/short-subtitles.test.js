// Титры ролика: правка реплик и вшивание в картинку.
//
// Главное здесь — вшивать с чистого файла, а не поверх прежних титров, и не
// терять правки автора при повторной расшифровке.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { saveLesson } from '../src/services/lessons.js';
import { registerAsset, assetById } from '../src/services/media.js';
import {
  saveShort,
  setShortFile,
  getShortById,
  editShortSegments,
  shortFromClip
} from '../src/services/shorts.js';
import { runFfmpeg, ffmpegArgsForBurnedSubtitles, probeFrameSize } from '../src/lib/ffmpeg.js';
import { makeBurnShortSubtitles } from '../src/jobs/burn-short-subtitles.js';
import { makeSuggestShortTexts } from '../src/jobs/suggest-short-texts.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const hasFfmpeg = await new Promise((resolve) => {
  const child = spawn('ffmpeg', ['-version']);
  child.on('error', () => resolve(false));
  child.on('close', (code) => resolve(code === 0));
});

const config = {
  publicBaseUrl: 'https://portal.example',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: '', botId: '', botUsername: '' },
  google: { clientId: '', clientSecret: '' },
  vapid: { publicKey: '', privateKey: '', subject: '' },
  redis: { url: 'redis://redis:6379', prefix: 'portal:' },
  yandex: { apiKey: '', folderId: '' },
  yandexOauth: { clientId: '', clientSecret: '' },
  tokenEncryptionKey: 'a'.repeat(64),
  media: { dir: '/tmp/portal-short-subtitles-test', ttlHours: 168 },
  youtube: { clientId: '', clientSecret: '', redirectUri: '/back', mode: 'semi' }
};

const SEGMENTS = [
  { startedMs: 0, endedMs: 1500, text: 'Анонсы уходят в каналы нахлитель и вам' },
  { startedMs: 1500, endedMs: 3000, text: 'Подписывайтесь' }
];

/** Ролик с файлом и расшифровкой. Файл пустышка, если не просили настоящий. */
async function shortWithSegments(pool, { video = null } = {}) {
  const short = await saveShort(pool, { title: 'Ролик' });
  const relative = `short-${short.id}/vertical.mp4`;
  await mkdir(path.join(config.media.dir, `short-${short.id}`), { recursive: true });
  if (video) await video(path.join(config.media.dir, relative));
  else await writeFile(path.join(config.media.dir, relative), 'не видео, но файл');
  const asset = await registerAsset(pool, config, {
    shortId: short.id,
    kind: 'vertical',
    relativePath: relative,
    bytes: 1024
  });
  await setShortFile(pool, short.id, { assetId: asset.id });
  await pool.query('UPDATE shorts SET segments = $1::jsonb, transcript = $2 WHERE id = $3', [
    JSON.stringify(SEGMENTS),
    SEGMENTS.map((segment) => segment.text).join(' '),
    short.id
  ]);
  return { short: await getShortById(pool, short.id), asset };
}

/** ffmpeg-заглушка: запоминает вызов, кладёт выходной файл и копию субтитров. */
function ffmpegStub() {
  const calls = [];
  return {
    calls,
    run: async (args) => {
      const subtitles = /subtitles=(.+?):force_style/.exec(args[args.indexOf('-vf') + 1])[1];
      calls.push({ input: args[args.indexOf('-i') + 1], srt: await readFile(subtitles, 'utf8') });
      await writeFile(args.at(-1), 'видео с титрами');
    }
  };
}

test('правка реплик меняет и титры, и текст для модели', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { short } = await shortWithSegments(pool);
    const changed = await editShortSegments(pool, short.id, [
      { index: 0, text: 'Анонсы уходят в каналы\nTelegram и MAX' },
      // Пустая реплика — дыра в титрах, не правка.
      { index: 1, text: '  ' },
      { index: 7, text: 'нет такой' }
    ]);
    assert.equal(changed, 1);
    const saved = await getShortById(pool, short.id);
    assert.equal(saved.segments[0].text, 'Анонсы уходят в каналы Telegram и MAX');
    assert.equal(saved.segments[0].endedMs, 1500);
    assert.equal(saved.segments[1].text, 'Подписывайтесь');
    assert.match(saved.transcript, /Telegram и MAX Подписывайтесь/);
  });
});

test('повторная расшифровка не стирает правки автора', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { short } = await shortWithSegments(pool);
    await editShortSegments(pool, short.id, [{ index: 0, text: 'Исправлено' }]);
    const speech = { transcribe: async () => assert.fail('whisper не должен запускаться') };
    const texts = { suggestShort: async () => ({ title: 'Т', description: 'О', hashtags: [] }) };
    await makeSuggestShortTexts(config, pool, { speech, texts, ffmpeg: async () => {} })({
      shortId: short.id
    });
    assert.equal((await getShortById(pool, short.id)).segments[0].text, 'Исправлено');
  });
});

test('титры вшиваются с чистого файла, прежний вшитый удаляется', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { short, asset } = await shortWithSegments(pool);
    const ffmpeg = ffmpegStub();
    const burn = makeBurnShortSubtitles(config, pool, { ffmpeg: ffmpeg.run });

    await burn({ shortId: short.id });
    const first = await getShortById(pool, short.id);
    assert.equal(first.sourceAssetId, asset.id);
    assert.notEqual(first.assetId, asset.id);
    assert.match(ffmpeg.calls[0].input, /vertical\.mp4$/);
    assert.match(ffmpeg.calls[0].srt, /нахлитель/);

    await editShortSegments(pool, short.id, [{ index: 0, text: 'Анонсы уходят в Telegram и MAX' }]);
    await burn({ shortId: short.id });
    const second = await getShortById(pool, short.id);

    // Второй раз — снова с чистого файла, а не с первого вшитого.
    assert.match(ffmpeg.calls[1].input, /vertical\.mp4$/);
    assert.match(ffmpeg.calls[1].srt, /Telegram и MAX/);
    assert.equal(second.sourceAssetId, asset.id);
    assert.equal(await assetById(pool, first.assetId), null);
    const oldFile = path.join(config.media.dir, `short-${short.id}`, path.basename(ffmpeg.calls[0].input));
    await access(oldFile);

    const { rows } = await pool.query(`SELECT generated->'subtitles' AS s FROM shorts WHERE id = $1`, [
      short.id
    ]);
    assert.equal(rows[0].s.state, 'done');
  });
});

test('отказ вшивания виден странице, ролик остаётся прежним', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { short, asset } = await shortWithSegments(pool);
    await makeBurnShortSubtitles(config, pool, {
      ffmpeg: async () => {
        throw new Error('шрифт не найден');
      }
    })({ shortId: short.id });
    const saved = await getShortById(pool, short.id);
    assert.equal(saved.assetId, asset.id);
    assert.equal(saved.sourceAssetId, null);
    const { rows } = await pool.query(`SELECT generated->'subtitles' AS s FROM shorts WHERE id = $1`, [
      short.id
    ]);
    assert.equal(rows[0].s.state, 'failed');
    assert.match(rows[0].s.error, /шрифт/);
  });
});

test('новый файл забывает реплики и чистый исходник', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { short } = await shortWithSegments(pool);
    await makeBurnShortSubtitles(config, pool, { ffmpeg: ffmpegStub().run })({ shortId: short.id });
    const other = await registerAsset(pool, config, {
      shortId: short.id,
      kind: 'vertical',
      relativePath: `short-${short.id}/other.mp4`,
      bytes: 1
    });
    await setShortFile(pool, short.id, { assetId: other.id });
    const saved = await getShortById(pool, short.id);
    assert.deepEqual(saved.segments, []);
    assert.equal(saved.sourceAssetId, null);
  });
});

test('страница правки: реплики для правки и кнопка вшивания', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { rows } = await pool.query(
      `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
    );
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'admin' }, config.jwtSecret)}`
    };
    const { short } = await shortWithSegments(pool);

    // Нарезка из урока: титры уже вшиты, второй раз не вшиваем.
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок', status: 'draft' });
    const clip = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'clip',
      relativePath: 'lesson-x/clip-1.mp4',
      bytes: 1
    });
    const fromClip = await shortFromClip(pool, { assetId: clip.id, lesson, title: 'Фрагмент' });
    await pool.query('UPDATE shorts SET segments = $1::jsonb WHERE id = $2', [
      JSON.stringify(SEGMENTS),
      fromClip.id
    ]);

    const added = [];
    const app = finalize(
      createApp({ config, pool, queue: { add: async (...args) => added.push(args) } })
    );
    await withServer(app, async (base) => {
      const page = await (
        await fetch(`${base}/short/${short.slug}/edit`, { headers: { ...headers, Accept: 'text/html' } })
      ).text();
      assert.match(page, /data-short-segment="0"[^>]*>Анонсы уходят в каналы нахлитель и вам</);
      assert.match(page, /data-short-burn=/);

      const saved = await fetch(`${base}/api/admin/shorts/${short.slug}/segments`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ segments: [{ index: 1, text: 'Подписывайтесь на канал' }] })
      });
      assert.deepEqual(await saved.json(), { changed: 1 });

      const url = `${base}/api/admin/shorts/${short.slug}/subtitles`;
      assert.equal((await fetch(url, { method: 'POST', headers })).status, 200);
      assert.equal(added[0][0], 'burnShortSubtitles');
      assert.equal((await (await fetch(url, { headers })).json()).state, 'burning');

      assert.equal(
        (await fetch(`${base}/api/admin/shorts/${fromClip.slug}/subtitles`, { method: 'POST', headers }))
          .status,
        409
      );
    });
  });
});

test(
  'настоящий ffmpeg вшивает титры в вертикальный ролик',
  { skip: hasFfmpeg ? false : 'нет ffmpeg' },
  async () => {
    const dir = path.join(config.media.dir, 'real');
    await mkdir(dir, { recursive: true });
    const input = path.join(dir, 'in.mp4');
    const srt = path.join(dir, 'in.srt');
    const output = path.join(dir, 'out.mp4');
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=blue:s=360x640:d=2',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-c:v', 'libx264', '-c:a', 'aac', '-shortest', '-y', input
    ]);
    await writeFile(srt, '1\n00:00:00,000 --> 00:00:02,000\nТитры по-русски\n', 'utf8');
    await runFfmpeg(ffmpegArgsForBurnedSubtitles({ input, subtitles: srt, output }), {
      failOn: /fontconfig|failed to find any fallback|Glyph 0x/i
    });
    // Кадр не режется: ролик уже вертикальный, его снял автор.
    assert.deepEqual(await probeFrameSize(output), { width: 360, height: 640 });
  }
);
