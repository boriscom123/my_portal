// Титры из монтажа: файл .srt из CapCut вместо распознавания речи.
//
// Главное здесь — не потерять вычитанное автором: битый файл не стирает
// расшифровку, а готовую расшифровку файл заменяет только с подтверждения.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { saveLesson } from '../src/services/lessons.js';
import { readSettings } from '../src/lib/settings.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const SRT = '﻿1\r\n00:00:01,000 --> 00:00:02,500\r\nпервая\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nвторая\r\n';

async function makeConfig() {
  return {
    publicBaseUrl: 'https://soloaijourney.online',
    jwtSecret: 'x'.repeat(32),
    adminIdentities: [],
    telegram: { botToken: '', botId: '', botUsername: '' },
    google: { clientId: '', clientSecret: '' },
    vapid: { publicKey: '', privateKey: '', subject: '' },
    redis: { url: 'redis://redis:6379', prefix: 'portal:' },
    yandex: { apiKey: '', folderId: '' },
    media: { dir: await mkdtemp(path.join(tmpdir(), 'portal-srt-')), ttlHours: 168 }
  };
}

function asAdmin(config, userId) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${signSession({ userId, role: 'admin' }, config.jwtSecret)}`
  };
}

async function seed(pool) {
  const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
  );
  return { lessonId: Number(lesson.id), adminId: Number(rows[0].id) };
}

async function withApp(run) {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const ids = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, (base) => {
      const put = (body, query = '') =>
        fetch(`${base}/api/upload/subtitles/${ids.lessonId}${query}`, {
          method: 'PUT',
          headers: asAdmin(config, ids.adminId),
          body
        });
      return run({ base, pool, config, put, ...ids });
    });
  });
}

const segmentsOf = async (pool, lessonId) =>
  (
    await pool.query(
      'SELECT started_ms, ended_ms, text FROM transcript_segments WHERE lesson_id = $1 ORDER BY started_ms',
      [lessonId]
    )
  ).rows;

test('гость титры не загрузит', skipWithoutDb, async () => {
  await withApp(async ({ base, lessonId }) => {
    const res = await fetch(`${base}/api/upload/subtitles/${lessonId}`, {
      method: 'PUT',
      headers: { Accept: 'application/json' },
      body: SRT
    });
    assert.equal(res.status, 401);
  });
});

test('srt становится расшифровкой урока и сразу даёт файлы субтитров', skipWithoutDb, async () => {
  await withApp(async ({ pool, config, put, lessonId }) => {
    const res = await put(SRT);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { segments: 2, lastEndedMs: 4000 });

    assert.deepEqual(await segmentsOf(pool, lessonId), [
      { started_ms: 1000, ended_ms: 2500, text: 'первая' },
      { started_ms: 3000, ended_ms: 4000, text: 'вторая' }
    ]);
    const { rows } = await pool.query('SELECT text, provider FROM transcripts WHERE lesson_id = $1', [
      lessonId
    ]);
    assert.deepEqual(rows[0], { text: 'первая вторая', provider: 'srt' });

    const dir = path.join(config.media.dir, `lesson-${lessonId}`);
    // Исходный файл автора — как был, его можно скачать обратно.
    assert.equal(await readFile(path.join(dir, 'imported.srt'), 'utf8'), SRT);
    assert.match(await readFile(path.join(dir, 'subtitles.vtt'), 'utf8'), /^WEBVTT/);
    await access(path.join(dir, 'subtitles.srt'));
  });
});

test('битый файл — 422 с номером блока, и прежняя расшифровка цела', skipWithoutDb, async () => {
  await withApp(async ({ pool, put, lessonId }) => {
    await put(SRT);
    const res = await put('1\n00:00:05,000 --> 00:00:04,000\nплохо\n', '?replace=1');
    assert.equal(res.status, 422);
    assert.match((await res.json()).error, /блок 1/);
    assert.equal((await segmentsOf(pool, lessonId)).length, 2);
  });
});

test('готовую расшифровку файл заменяет только с подтверждением', skipWithoutDb, async () => {
  await withApp(async ({ pool, put, lessonId }) => {
    await pool.query(
      `INSERT INTO transcripts (lesson_id, text, provider) VALUES ($1, 'от whisper', 'whisper.cpp')`,
      [lessonId]
    );
    const refused = await put(SRT);
    assert.equal(refused.status, 409);
    assert.match((await refused.json()).error, /Подтвердите замену/);

    const accepted = await put(SRT, '?replace=1');
    assert.equal(accepted.status, 200);
    assert.equal((await segmentsOf(pool, lessonId)).length, 2);
  });
});

test('пока урок обрабатывается, титры не принимаются', skipWithoutDb, async () => {
  await withApp(async ({ pool, put, lessonId }) => {
    await pool.query(`UPDATE lessons SET pipeline_state = 'processing' WHERE id = $1`, [lessonId]);
    assert.equal((await put(SRT)).status, 409);
  });
});

test('убрать загруженные титры — расшифровка и её файлы уходят', skipWithoutDb, async () => {
  await withApp(async ({ base, pool, config, put, lessonId, adminId }) => {
    await put(SRT);
    const res = await fetch(`${base}/api/upload/subtitles/${lessonId}`, {
      method: 'DELETE',
      headers: asAdmin(config, adminId)
    });
    assert.deepEqual(await res.json(), { removed: true });
    assert.equal((await segmentsOf(pool, lessonId)).length, 0);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM assets WHERE lesson_id = $1 AND kind = 'subtitles'`,
      [lessonId]
    );
    assert.equal(rows[0].n, 0);
    await assert.rejects(
      access(path.join(config.media.dir, `lesson-${lessonId}`, 'subtitles.vtt'))
    );
  });
});

test('расшифровку от whisper «убрать загруженные титры» не трогает', skipWithoutDb, async () => {
  await withApp(async ({ base, pool, config, lessonId, adminId }) => {
    await pool.query(
      `INSERT INTO transcripts (lesson_id, text, provider) VALUES ($1, 'от whisper', 'whisper.cpp')`,
      [lessonId]
    );
    const res = await fetch(`${base}/api/upload/subtitles/${lessonId}`, {
      method: 'DELETE',
      headers: asAdmin(config, adminId)
    });
    assert.deepEqual(await res.json(), { removed: false });
    const { rows } = await pool.query('SELECT 1 FROM transcripts WHERE lesson_id = $1', [lessonId]);
    assert.equal(rows.length, 1);
  });
});

test('отметка «вшиты» сохраняется, не сбрасывая другие настройки', skipWithoutDb, async () => {
  await withApp(async ({ base, pool, config, lessonId, adminId }) => {
    await pool.query(
      `UPDATE lessons SET settings = '{"subtitleColor": "#ff0000", "cutPauses": true}' WHERE id = $1`,
      [lessonId]
    );
    const res = await fetch(`${base}/api/upload/burned/${lessonId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...asAdmin(config, adminId) },
      body: JSON.stringify({ burned: true })
    });
    assert.equal(res.status, 200);
    const { rows } = await pool.query('SELECT settings FROM lessons WHERE id = $1', [lessonId]);
    const settings = readSettings(rows[0].settings);
    assert.equal(settings.burnedSubtitles, true);
    assert.equal(settings.subtitleColor, '#ff0000');
    assert.equal(settings.cutPauses, true);
  });
});
