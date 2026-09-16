// Текст ролика для площадок: расшифровка и заготовка от модели.
//
// Проверяется то, что ломается на деле: расшифровка не пересчитывается на
// каждое нажатие, отказ модели не оставляет автора ни с чем, замена файла
// забывает текст старого, а хэштеги доезжают до подписи Instagram.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { registerAsset } from '../src/services/media.js';
import {
  saveShort,
  setShortFile,
  getShortById,
  publishShort,
  normalizeHashtags,
  instagramCaption
} from '../src/services/shorts.js';
import { buildShortPrompt, parseShortResponse } from '../src/services/texts.js';
import { makeSuggestShortTexts } from '../src/jobs/suggest-short-texts.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

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
  media: { dir: '/tmp/portal-short-texts-test', ttlHours: 168 },
  youtube: { clientId: '', clientSecret: '', redirectUri: '/back', mode: 'semi' }
};

/** Ролик с загруженным файлом. Звук из «файла» не извлекается: ffmpeg подменён. */
async function shortWithFile(pool) {
  const short = await saveShort(pool, { title: 'Черновой заголовок' });
  const relative = `short-${short.id}/vertical.mp4`;
  await mkdir(path.join(config.media.dir, `short-${short.id}`), { recursive: true });
  await writeFile(path.join(config.media.dir, relative), 'не видео, но файл');
  const asset = await registerAsset(pool, config, {
    shortId: short.id,
    kind: 'vertical',
    relativePath: relative,
    bytes: 1024
  });
  await setShortFile(pool, short.id, { assetId: asset.id });
  return { short, asset };
}

function speechStub(text = 'Сегодня подключаем докер к порталу и смотрим логи') {
  const calls = [];
  return {
    calls,
    transcribe: async (input) => (calls.push(input), { text, segments: [] })
  };
}

const noFfmpeg = async () => {};

test('хэштеги приводятся к виду, который примет площадка', () => {
  // Пробел внутри тега Instagram считает концом тега, решётку модель ставит
  // через раз, а повтор ничего не добавляет к охвату.
  assert.deepEqual(normalizeHashtags('#Docker, nginx  #docker, свой сервер'), [
    'docker',
    'nginx',
    'свойсервер'
  ]);
  assert.deepEqual(normalizeHashtags(['#AI', '', 'ai']), ['ai']);
});

test('подпись Instagram: крючок, текст и хэштеги отдельной строкой', () => {
  const caption = instagramCaption({
    title: 'Докер за минуту',
    description: 'Как поднять контейнер.',
    hashtags: ['docker', 'devops']
  });
  assert.equal(caption, 'Докер за минуту\n\nКак поднять контейнер.\n\n#docker #devops');
  assert.equal(instagramCaption({ title: 'Т', description: '', hashtags: [] }), 'Т');
});

test('запрос к модели — про Instagram и с расшифровкой', () => {
  const prompt = buildShortPrompt('поднимаем докер', { lessonTitle: 'Урок про VPS' });
  assert.match(prompt, /Instagram/);
  assert.match(prompt, /поднимаем докер/);
  assert.match(prompt, /Урок про VPS/);
});

test('ответ модели разбирается в заголовок, описание и хэштеги', () => {
  const parsed = parseShortResponse({
    candidates: [
      {
        content: {
          parts: [
            {
              text: JSON.stringify({
                title: ' Докер за минуту ',
                description: 'Текст.',
                hashtags: ['#Docker', 'dev ops', 'a', 'b', 'c', 'd', 'e']
              })
            }
          ]
        }
      }
    ]
  });
  assert.equal(parsed.title, 'Докер за минуту');
  // Больше пяти площадка не запрещает, но ранжирует хуже: список обрезаем.
  assert.deepEqual(parsed.hashtags, ['docker', 'devops', 'a', 'b', 'c']);
  assert.throws(() => parseShortResponse({}), /пустой/);
});

test('хэштеги сохраняются вместе с роликом', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const short = await saveShort(pool, { title: 'Ролик', hashtags: '#Docker, nginx' });
    assert.deepEqual(short.hashtags, ['docker', 'nginx']);
    const saved = await saveShort(pool, { slug: short.slug, title: 'Ролик', hashtags: [] });
    assert.deepEqual(saved.hashtags, []);
  });
});

test('заготовка ложится в ролик, расшифровка считается один раз', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { short } = await shortWithFile(pool);
    const speech = speechStub();
    const texts = {
      suggestShort: async (transcript) => ({
        title: 'Докер за минуту',
        description: `По тексту: ${transcript.slice(0, 7)}`,
        hashtags: ['docker'],
        model: 'test'
      })
    };
    const job = makeSuggestShortTexts(config, pool, { speech, texts, ffmpeg: noFfmpeg });

    await job({ shortId: short.id });
    const { rows } = await pool.query(
      `SELECT transcript, generated->'suggested' AS suggested FROM shorts WHERE id = $1`,
      [short.id]
    );
    assert.match(rows[0].transcript, /докер/);
    assert.equal(rows[0].suggested.title, 'Докер за минуту');
    assert.deepEqual(rows[0].suggested.hashtags, ['docker']);
    assert.equal(rows[0].suggested.source, 'model');
    assert.ok(rows[0].suggested.at);

    // Повторное нажатие просит у модели другой вариант, а не гоняет whisper
    // заново: звук тот же, и минута двух ядер ушла бы впустую.
    await job({ shortId: short.id });
    assert.equal(speech.calls.length, 1);
  });
});

test('отказ модели — заготовка из расшифровки с объяснением', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { short } = await shortWithFile(pool);
    const texts = {
      suggestShort: async () => {
        throw new Error('квота');
      }
    };
    await makeSuggestShortTexts(config, pool, { speech: speechStub(), texts, ffmpeg: noFfmpeg })({
      shortId: short.id
    });
    const { rows } = await pool.query(
      `SELECT generated->'suggested' AS suggested FROM shorts WHERE id = $1`,
      [short.id]
    );
    assert.equal(rows[0].suggested.source, 'transcript');
    assert.match(rows[0].suggested.warning, /квота/);
    assert.ok(rows[0].suggested.title);
  });
});

test('ролик без речи — отказ словами, а не вечное ожидание', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { short } = await shortWithFile(pool);
    await makeSuggestShortTexts(config, pool, {
      speech: speechStub('  '),
      texts: null,
      ffmpeg: noFfmpeg
    })({ shortId: short.id });
    const { rows } = await pool.query(
      `SELECT generated->'suggested' AS suggested FROM shorts WHERE id = $1`,
      [short.id]
    );
    // Страница ждёт заготовку и перестаёт ждать, только увидев ответ.
    assert.match(rows[0].suggested.error, /речи/);
  });
});

test('новый файл забывает расшифровку и заготовку старого', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { short, asset } = await shortWithFile(pool);
    await pool.query(
      `UPDATE shorts SET transcript = 'старый текст',
              generated = '{"suggested": {"title": "Старое"}}' WHERE id = $1`,
      [short.id]
    );
    // Тот же файл — ничего не забываем: заставка переснимается без смены видео.
    await setShortFile(pool, short.id, { assetId: asset.id });
    assert.equal((await getShortById(pool, short.id)).transcript, 'старый текст');

    const other = await registerAsset(pool, config, {
      shortId: short.id,
      kind: 'vertical',
      relativePath: `short-${short.id}/vertical-2.mp4`,
      bytes: 1024
    });
    await setShortFile(pool, short.id, { assetId: other.id });
    const { rows } = await pool.query('SELECT transcript, generated FROM shorts WHERE id = $1', [
      short.id
    ]);
    assert.equal(rows[0].transcript, null);
    assert.deepEqual(rows[0].generated, {});
  });
});

test('кнопка ставит задачу, а страница ждёт ответ', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { rows } = await pool.query(
      `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
    );
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'admin' }, config.jwtSecret)}`
    };
    const empty = await saveShort(pool, { title: 'Без файла' });
    const { short } = await shortWithFile(pool);
    await publishShort(pool, short.slug, false);

    const added = [];
    const queue = { add: async (...args) => added.push(args) };
    const app = finalize(createApp({ config, pool, queue }));

    await withServer(app, async (base) => {
      const url = (slug) => `${base}/api/admin/shorts/${slug}/suggest`;
      // Без файла расшифровывать нечего — говорим сразу, а не из очереди.
      assert.equal((await fetch(url(empty.slug), { method: 'POST', headers })).status, 409);

      await pool.query(
        `UPDATE shorts SET generated = '{"suggested": {"title": "Старое"}}' WHERE id = $1`,
        [short.id]
      );
      const started = await fetch(url(short.slug), { method: 'POST', headers });
      assert.equal(started.status, 200);
      assert.equal(added[0][0], 'suggestShortTexts');
      assert.deepEqual(added[0][1], { shortId: short.id });

      // Прошлая заготовка убрана: иначе страница приняла бы её за новую.
      assert.deepEqual(await (await fetch(url(short.slug), { headers })).json(), { pending: true });

      await pool.query(
        `UPDATE shorts SET transcript = 'текст', generated = '{"suggested": {"title": "Новое"}}'
          WHERE id = $1`,
        [short.id]
      );
      const ready = await (await fetch(url(short.slug), { headers })).json();
      assert.equal(ready.title, 'Новое');
      assert.equal(ready.transcript, 'текст');
    });
  });
});
