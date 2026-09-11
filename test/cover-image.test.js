// Шаг рисования обложки и выбор между обложками. Кадр из записи никуда не
// девается: возвращаться к нему перерисовкой значило бы тратить минуту машины
// на то, что уже лежит в буфере.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { makeMakeCoverImage } from '../src/jobs/make-cover-image.js';
import { saveLesson } from '../src/services/lessons.js';
import { registerAsset } from '../src/services/media.js';
import { saveDrawingSettings } from '../src/services/drawing-settings.js';
import { markDrawing, recordSideFailure } from '../src/services/cover-drawing.js';
import { jobOptions } from '../src/queue.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

async function makeConfig() {
  return {
    publicBaseUrl: 'https://soloaijourney.online',
    jwtSecret: 'x'.repeat(32),
    adminIdentities: [],
    telegram: { botToken: '', botId: '', botUsername: '' },
    google: { clientId: '', clientSecret: '' },
    vapid: { publicKey: '', privateKey: '', subject: '' },
    media: { dir: await mkdtemp(path.join(tmpdir(), 'portal-cover-')), ttlHours: 168 },
    tokenEncryptionKey: 'a'.repeat(64)
  };
}

async function seed(pool, config) {
  const lesson = await saveLesson(pool, { slug: 'urok', title: 'Портал на VPS' });
  await mkdir(path.join(config.media.dir, `lesson-${lesson.id}`), { recursive: true });
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
  );
  return {
    lesson,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'admin' }, config.jwtSecret)}`
    }
  };
}

const drawing = {
  isConfigured: async () => true,
  generate: async () => ({
    bytes: Buffer.from('нарисованная картинка'),
    type: 'png',
    model: 'black-forest-labs/FLUX.1-schnell'
  })
};

test('нарисованная обложка ложится в буфер и в карточку', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson } = await seed(pool, config);
    const result = await makeMakeCoverImage(config, pool, drawing)({ lessonId: lesson.id });

    const { rows: files } = await pool.query('SELECT path FROM assets WHERE id = $1', [result.assetId]);
    const file = await readFile(path.join(config.media.dir, files[0].path));
    assert.equal(file.toString(), 'нарисованная картинка');

    const { rows } = await pool.query('SELECT cover_url FROM lessons WHERE id = $1', [lesson.id]);
    assert.equal(rows[0].cover_url, `/media/asset/${result.assetId}`);
  });
});

test('без заголовка рисовать не по чему', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'pustoj', title: '' });
    await assert.rejects(
      makeMakeCoverImage(config, pool, drawing)({ lessonId: lesson.id }),
      /заголовка/
    );
  });
});

test('без настроенного рисования шаг говорит об этом внятно', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson } = await seed(pool, config);
    await assert.rejects(
      makeMakeCoverImage(config, pool, null)({ lessonId: lesson.id }),
      /не настроено/
    );
  });
});

test('повтор добавляет картинку к прежним, а не заменяет её', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson } = await seed(pool, config);
    const job = makeMakeCoverImage(config, pool, drawing);
    await job({ lessonId: lesson.id });
    await job({ lessonId: lesson.id });
    // Заказчик выбирает из нескольких: прежняя нарисованная ему может
    // понравиться больше новой.
    const { rows } = await pool.query(
      `SELECT count(*)::int n FROM assets WHERE lesson_id = $1 AND kind = 'cover'`,
      [lesson.id]
    );
    assert.equal(rows[0].n, 2);
  });
});

test('автор возвращает кадр из записи одним нажатием', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool, config);
    const frame = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'cover',
      relativePath: `lesson-${lesson.id}/cover.jpg`,
      bytes: 10
    });
    await makeMakeCoverImage(config, pool, drawing)({ lessonId: lesson.id });

    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/admin/lessons/urok/cover/${frame.id}`, {
        method: 'POST',
        headers
      });
      assert.equal(res.status, 200);
    });
    // Перерисовывать ради возврата к кадру значило бы тратить минуту машины на
    // то, что уже лежит в буфере.
    const { rows } = await pool.query('SELECT cover_url FROM lessons WHERE id = $1', [lesson.id]);
    assert.equal(rows[0].cover_url, `/media/asset/${frame.id}`);
  });
});

test('обложкой не назначить чужой файл', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool, config);
    const other = await saveLesson(pool, { slug: 'drugoj', title: 'Другой' });
    const alien = await registerAsset(pool, config, {
      lessonId: other.id,
      kind: 'cover',
      relativePath: `lesson-${other.id}/cover.jpg`,
      bytes: 10
    });
    const source = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'source',
      relativePath: `lesson-${lesson.id}/source.mp4`,
      bytes: 10
    });

    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      for (const id of [alien.id, source.id]) {
        const res = await fetch(`${base}/api/admin/lessons/urok/cover/${id}`, {
          method: 'POST',
          headers
        });
        assert.equal(res.status, 404, `назначился файл ${id}`);
      }
    });
  });
});

test('удалённая обложка исчезает и с диска, и из учёта', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool, config);
    const { writeFile } = await import('node:fs/promises');
    const relative = `lesson-${lesson.id}/cover-uploaded.png`;
    await writeFile(path.join(config.media.dir, relative), Buffer.from('картинка'));
    const asset = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'cover',
      relativePath: relative,
      bytes: 8
    });

    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/admin/lessons/urok/cover/${asset.id}`, {
        method: 'DELETE',
        headers
      });
      assert.equal(res.status, 200);
    });

    const { stat } = await import('node:fs/promises');
    await assert.rejects(stat(path.join(config.media.dir, relative)), 'файл остался на диске');
    const { rows } = await pool.query('SELECT count(*)::int n FROM assets WHERE id = $1', [
      asset.id
    ]);
    assert.equal(rows[0].n, 0);
  });
});

test('удаление выбранной обложки ставит другую', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool, config);
    const frame = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'cover',
      relativePath: `lesson-${lesson.id}/cover.jpg`,
      bytes: 10
    });
    // Нарисованная становится выбранной, и её же удаляем.
    const drawn = await makeMakeCoverImage(config, pool, drawing)({ lessonId: lesson.id });

    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      await fetch(`${base}/api/admin/lessons/urok/cover/${drawn.assetId}`, {
        method: 'DELETE',
        headers
      });
    });
    // Иначе карточка урока показывала бы битую картинку, а превью ссылки
    // приходило бы пустым.
    const { rows } = await pool.query('SELECT cover_url FROM lessons WHERE id = $1', [lesson.id]);
    assert.equal(rows[0].cover_url, `/media/asset/${frame.id}`);
  });
});

test('удаление последней обложки оставляет урок без неё, а не со ссылкой в пустоту', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool, config);
    const only = await makeMakeCoverImage(config, pool, drawing)({ lessonId: lesson.id });

    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      await fetch(`${base}/api/admin/lessons/urok/cover/${only.assetId}`, {
        method: 'DELETE',
        headers
      });
    });
    const { rows } = await pool.query('SELECT cover_url FROM lessons WHERE id = $1', [lesson.id]);
    // Витрина рисует на месте пропавшей обложки фирменный градиент — это
    // честнее, чем ссылка на удалённый файл.
    assert.equal(rows[0].cover_url, null);
  });
});

test('удалить исходник или чужую обложку этим маршрутом нельзя', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool, config);
    const source = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'source',
      relativePath: `lesson-${lesson.id}/source.mp4`,
      bytes: 10
    });
    const other = await saveLesson(pool, { slug: 'drugoj', title: 'Другой' });
    const alien = await registerAsset(pool, config, {
      lessonId: other.id,
      kind: 'cover',
      relativePath: `lesson-${other.id}/cover.jpg`,
      bytes: 10
    });

    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      for (const id of [source.id, alien.id]) {
        const res = await fetch(`${base}/api/admin/lessons/urok/cover/${id}`, {
          method: 'DELETE',
          headers
        });
        assert.equal(res.status, 404, `удалился файл ${id}`);
      }
    });
    const { rows } = await pool.query('SELECT count(*)::int n FROM assets');
    assert.equal(rows[0].n, 2, 'ни один файл удалиться не должен был');
  });
});

test('отказ рисования показывается один раз и уходит', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool, config);
    await pool.query(
      `UPDATE lessons SET generated = jsonb_set(generated, '{sideError}', $1::jsonb) WHERE id = $2`,
      [JSON.stringify({ step: 'makeCoverImage', message: 'квота исчерпана' }), lesson.id]
    );

    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const page = () =>
        fetch(`${base}/admin/lesson/urok`, {
          headers: { Accept: 'text/html', ...headers }
        }).then((response) => response.text());

      // Первый заход после попытки — отказ виден.
      assert.match(await page(), /Нарисовать не вышло: квота исчерпана/);
      // Второй — уже нет: иначе красная надпись про чужую квоту встречает
      // автора при каждом заходе, хотя нажимал он однажды.
      assert.ok(!(await page()).includes('Нарисовать не вышло'));
    });
  });
});

test('новая попытка не показывает прошлый отказ как свежий', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool, config);
    await saveDrawingSettings(pool, config, { token: 'hf_secret_token', models: '' });
    await pool.query(
      `UPDATE lessons SET generated = jsonb_set(generated, '{sideError}', $1::jsonb) WHERE id = $2`,
      [JSON.stringify({ step: 'makeCoverImage', message: 'старый отказ' }), lesson.id]
    );

    const app = finalize(createApp({ config, pool, queue: { add: async () => {} } }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/admin/lessons/urok/cover-image`, {
        method: 'POST',
        headers
      });
      assert.equal(res.status, 200);
    });
    const { rows } = await pool.query(
      `SELECT generated ? 'sideError' AS has FROM lessons WHERE id = $1`,
      [lesson.id]
    );
    assert.equal(rows[0].has, false);
  });
});

test('запрос для обложки даёт текстовая модель, а без неё — шаблон', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson } = await seed(pool, config);
    const prompts = [];
    const recording = {
      isConfigured: async () => true,
      generate: async (prompt) => {
        prompts.push(prompt);
        return { bytes: Buffer.from('картинка'), type: 'png', model: 'm' };
      }
    };

    const fromModel = await makeMakeCoverImage(config, pool, recording, {
      suggestCoverPrompt: async () => ({ prompt: 'A lighthouse made of servers', model: 't' })
    })({ lessonId: lesson.id });
    assert.equal(fromModel.promptSource, 'gemini');
    assert.equal(prompts[0], 'A lighthouse made of servers');

    // Текстовая модель отказала — рисование от неё не зависит.
    const fromTemplate = await makeMakeCoverImage(config, pool, recording, {
      suggestCoverPrompt: async () => {
        throw new Error('503');
      }
    })({ lessonId: lesson.id });
    assert.equal(fromTemplate.promptSource, 'template');
    // Шаблон держит смысл предметной сценой, а не запретами: отрицаний в нём
    // нет вовсе, модель рисования читает их наоборот.
    assert.match(prompts[1], /concrete physical scene/);
  });
});

test('без токена рисование не ставится в очередь, а кнопка это объясняет', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { headers } = await seed(pool, config);
    const added = [];
    const app = finalize(createApp({ config, pool, queue: { add: async (name) => added.push(name) } }));
    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/admin/lessons/urok/cover-image`, {
        method: 'POST',
        headers
      });
      assert.equal(response.status, 409);
      assert.match((await response.json()).error, /токен Hugging Face/);

      const page = await (
        await fetch(`${base}/admin/lesson/urok`, { headers: { Accept: 'text/html', ...headers } })
      ).text();
      assert.match(page, /data-draw-cover="urok"\s+disabled title="Добавьте токен Hugging Face в настройках"/);
      assert.match(page, /href="\/settings"/);
    });
    assert.deepEqual(added, [], 'задача ушла в очередь без токена');
  });
});

test('с токеном кнопка активна, а про квоту Google речи нет', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool, config);
    await saveDrawingSettings(pool, config, { token: 'hf_secret_token', models: '' });
    await pool.query(
      `UPDATE lessons SET generated = jsonb_set(generated, '{sideError}', $1::jsonb) WHERE id = $2`,
      [JSON.stringify({ step: 'makeCoverImage', message: 'You exceeded your current quota' }), lesson.id]
    );
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const page = await (
        await fetch(`${base}/admin/lesson/urok`, { headers: { Accept: 'text/html', ...headers } })
      ).text();
      assert.match(page, /data-draw-cover="urok"\s*>/);
      assert.ok(!page.includes('квота Google'), 'осталась подсказка про Google');
    });
  });
});

/** Приложение с очередью, которая запоминает поставленные задачи. */
function appWithQueue(config, pool, added) {
  return finalize(
    createApp({ config, pool, queue: { add: async (name, data) => added.push({ name, data }) } })
  );
}

const stateOf = async (base, headers) =>
  (await fetch(`${base}/api/admin/lessons/urok/state`, { headers })).json();

test('рисование помечает урок, и второй раз его не запустить, пока идёт первое', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { headers } = await seed(pool, config);
    await saveDrawingSettings(pool, config, { token: 'hf_secret_token', models: '' });
    const added = [];
    await withServer(appWithQueue(config, pool, added), async (base) => {
      const first = await fetch(`${base}/api/admin/lessons/urok/cover-image`, { method: 'POST', headers });
      assert.equal(first.status, 200);
      // Страница узнаёт о конце рисования только так: без отметки ей не на
      // что смотреть, и автор жмёт кнопку второй раз — так обложка и
      // нарисовалась дважды.
      assert.equal((await stateOf(base, headers)).drawing, true);

      const second = await fetch(`${base}/api/admin/lessons/urok/cover-image`, { method: 'POST', headers });
      assert.equal(second.status, 409);
      assert.match((await second.json()).error, /уже рисуется/);
    });
    assert.equal(added.length, 1, 'вторая задача ушла в очередь');
  });
});

test('поправленный автором запрос уходит в задачу и рисуется ровно по нему', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { headers } = await seed(pool, config);
    await saveDrawingSettings(pool, config, { token: 'hf_secret_token', models: '' });
    const added = [];
    const text = 'A robot arm packing film reels into parcels on a conveyor';
    await withServer(appWithQueue(config, pool, added), async (base) => {
      await fetch(`${base}/api/admin/lessons/urok/cover-image`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ prompt: `  ${text}  ` })
      });
    });
    assert.equal(added[0].data.prompt, text);

    const prompts = [];
    const recording = {
      isConfigured: async () => true,
      generate: async (prompt) => {
        prompts.push(prompt);
        return { bytes: Buffer.from('картинка'), type: 'png', model: 'm' };
      }
    };
    const result = await makeMakeCoverImage(config, pool, recording, {
      suggestCoverPrompt: async () => {
        throw new Error('запрос автора не должен уходить в Gemini');
      }
    })(added[0].data);
    assert.equal(result.promptSource, 'author');
    assert.deepEqual(prompts, [text]);
  });
});

test('готовая обложка снимает отметку и запоминает, по какому запросу нарисована', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool, config);
    await saveDrawingSettings(pool, config, { token: 'hf_secret_token', models: '' });
    await markDrawing(pool, lesson.id);
    await makeMakeCoverImage(config, pool, drawing, {
      suggestCoverPrompt: async () => ({ prompt: 'A lighthouse made of servers', model: 't' })
    })({ lessonId: lesson.id });

    await withServer(finalize(createApp({ config, pool })), async (base) => {
      assert.equal((await stateOf(base, headers)).drawing, false);
      const page = await (
        await fetch(`${base}/admin/lesson/urok`, { headers: { Accept: 'text/html', ...headers } })
      ).text();
      // Запрос виден и правится: иначе при плохой картинке непонятно, по чему
      // рисовали и что поменять.
      assert.match(page, /<textarea[^>]*data-cover-prompt[^>]*>A lighthouse made of servers<\/textarea>/);
      assert.ok(!page.includes('data-draw-watch'), 'страница ждёт уже законченное рисование');
    });
  });
});

test('отказ рисования тоже снимает отметку', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool, config);
    await markDrawing(pool, lesson.id);
    await recordSideFailure(pool, lesson.id, 'makeCoverImage', 'Модели сейчас заняты');
    await withServer(finalize(createApp({ config, pool })), async (base) => {
      // Иначе страница ждала бы конца рисования, которое уже упало.
      assert.equal((await stateOf(base, headers)).drawing, false);
    });
    const { rows } = await pool.query(`SELECT generated->'sideError' AS e FROM lessons WHERE id = $1`, [
      lesson.id
    ]);
    assert.equal(rows[0].e.message, 'Модели сейчас заняты');
  });
});

test('открытая во время рисования страница ждёт его сама', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool, config);
    await saveDrawingSettings(pool, config, { token: 'hf_secret_token', models: '' });
    await markDrawing(pool, lesson.id);
    await withServer(finalize(createApp({ config, pool })), async (base) => {
      const page = await (
        await fetch(`${base}/admin/lesson/urok`, { headers: { Accept: 'text/html', ...headers } })
      ).text();
      // Человек обновил страницу посреди рисования — кнопка всё равно занята
      // и страница сама перечитается, когда обложка будет готова.
      assert.match(page, /data-draw-watch="urok"/);
      assert.match(page, /Рисую…/);
    });
  });
});

test('давняя отметка не держит кнопку вечно', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool, config);
    await saveDrawingSettings(pool, config, { token: 'hf_secret_token', models: '' });
    // Воркер перезапустили посреди рисования — снять отметку было некому.
    await pool.query(
      `UPDATE lessons SET generated = generated || jsonb_build_object('drawing',
         jsonb_build_object('startedAt', now() - interval '11 minutes')) WHERE id = $1`,
      [lesson.id]
    );
    const added = [];
    await withServer(appWithQueue(config, pool, added), async (base) => {
      const response = await fetch(`${base}/api/admin/lessons/urok/cover-image`, { method: 'POST', headers });
      assert.equal(response.status, 200);
    });
    assert.equal(added.length, 1);
  });
});

test('рисование обложки сама очередь не повторяет', () => {
  // Слой рисования уже перебирает модели на «занято», а повтор всей задачи
  // через полминуты снимал бы отметку «рисуется» на первой же неудаче и потом
  // молча менял обложку. Повторить автор может сам — одной кнопкой.
  assert.deepEqual(jobOptions('makeCoverImage'), { attempts: 1 });
});

test('перерисовка добавляет картинку с новым адресом и не трогает выбранную обложку', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson } = await seed(pool, config);
    const job = makeMakeCoverImage(config, pool, drawing);
    // У урока обложки ещё нет — первая нарисованная ею и становится: иначе урок
    // остался бы совсем без обложки.
    const first = await job({ lessonId: lesson.id });
    const second = await job({ lessonId: lesson.id });
    // Картинку по адресу браузер держит сутки: у каждой перерисовки свой адрес.
    assert.notEqual(String(second.assetId), String(first.assetId));

    // Новая только добавляется: выбирает автор, а не рисование.
    const { rows } = await pool.query('SELECT cover_url FROM lessons WHERE id = $1', [lesson.id]);
    assert.equal(rows[0].cover_url, `/media/asset/${first.assetId}`);

    const { rows: drawn } = await pool.query(
      `SELECT id FROM assets WHERE lesson_id = $1 AND path LIKE '%cover-drawn%' ORDER BY id`,
      [lesson.id]
    );
    assert.deepEqual(drawn.map((row) => String(row.id)), [String(first.assetId), String(second.assetId)]);
    const { readdir } = await import('node:fs/promises');
    const onDisk = (await readdir(path.join(config.media.dir, `lesson-${lesson.id}`))).filter((name) =>
      name.startsWith('cover-drawn')
    );
    assert.equal(onDisk.length, 2, 'прежний нарисованный файл пропал с диска');
  });
});

test('отрицания из запроса Gemini до модели рисования не доходят', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson } = await seed(pool, config);
    const prompts = [];
    const recording = {
      isConfigured: async () => true,
      generate: async (prompt) => {
        prompts.push(prompt);
        return { bytes: Buffer.from('картинка'), type: 'png', model: 'm' };
      }
    };
    await makeMakeCoverImage(config, pool, recording, {
      suggestCoverPrompt: async () => ({
        prompt: 'A workshop with gears and a conveyor, no text, no play buttons, soft glow',
        model: 't'
      })
    })({ lessonId: lesson.id });
    // «no play buttons» модель рисования читает как «нарисуй кнопку play» —
    // так и вышла вторая обложка.
    assert.equal(prompts[0], 'A workshop with gears and a conveyor, soft glow');

    // Запрос автора уходит как есть: что писать, решает он.
    await makeMakeCoverImage(config, pool, recording, null)({
      lessonId: lesson.id,
      prompt: 'A lighthouse, no boats'
    });
    assert.equal(prompts[1], 'A lighthouse, no boats');
  });
});

test('поле запроса оформлено как остальные, и подсказка предупреждает про «no»', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { headers } = await seed(pool, config);
    await saveDrawingSettings(pool, config, { token: 'hf_secret_token', models: '' });
    await withServer(finalize(createApp({ config, pool })), async (base) => {
      const page = await (
        await fetch(`${base}/admin/lesson/urok`, { headers: { Accept: 'text/html', ...headers } })
      ).text();
      // Стили подписи над полем висят на классе: поле стоит вне формы.
      assert.match(page, /<label class="field">Запрос для рисования/);
      assert.match(page, /«no …»/);
    });
  });
});

test('список обложек виден и при одной — у каждой есть «Удалить» и время', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool, config);
    const only = await makeMakeCoverImage(config, pool, drawing)({ lessonId: lesson.id });
    await withServer(finalize(createApp({ config, pool })), async (base) => {
      const page = await (
        await fetch(`${base}/admin/lesson/urok`, { headers: { Accept: 'text/html', ...headers } })
      ).text();
      // При одной картинке списка не было — и удалить её было нечем.
      assert.match(page, new RegExp(`data-cover-remove="${only.assetId}"`));
      // Нарисованных бывает несколько: без времени их не различить.
      assert.match(page, /нарисованная · \d/);
    });
  });
});

test('подсказка у поля говорит, откуда взялся запрос и как его обновить', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { lesson, headers } = await seed(pool, config);
    await saveDrawingSettings(pool, config, { token: 'hf_secret_token', models: '' });
    await pool.query(
      `UPDATE lessons SET generated = generated || jsonb_build_object('coverPrompt',
         jsonb_build_object('text', 'A ship loading containers', 'source', 'suggested')) WHERE id = $1`,
      [lesson.id]
    );
    await withServer(finalize(createApp({ config, pool })), async (base) => {
      const page = await (
        await fetch(`${base}/admin/lesson/urok`, { headers: { Accept: 'text/html', ...headers } })
      ).text();
      assert.match(page, />A ship loading containers<\/textarea>/);
      // Поле менялось только очисткой, и догадаться об этом было нельзя.
      assert.match(page, /Запрос составлен по расшифровке урока/);
      assert.match(page, /«Заполнить из расшифровки»/);
    });
  });
});
