// Автор должен видеть, где урок сейчас и на чём он упал. Иначе единственный
// способ узнать это — журнал контейнера, к которому с телефона доступа нет.
// Заказчик уже жаловался ровно на это: нажал «в обработку» и полчаса не
// понимал, идёт что-нибудь или нет.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { saveLesson } from '../src/services/lessons.js';
import { stateLabel } from '../src/views/admin-home.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://soloaijourney.online',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: '', botId: '', botUsername: '' },
  google: { clientId: '', clientSecret: '' },
  vapid: { publicKey: '', privateKey: '', subject: '' },
  media: { dir: '/tmp', ttlHours: 168 }
};

async function admin(pool) {
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
  );
  return {
    Accept: 'text/html',
    Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'admin' }, config.jwtSecret)}`
  };
}

test('состояние словами называет идущий шаг', () => {
  assert.equal(
    stateLabel({ pipelineState: 'processing', pipelineJob: { name: 'transcribe' } }),
    'обрабатывается: распознаётся речь'
  );
  // Незнакомый шаг не должен превращать надпись в пустоту или в имя из кода.
  assert.equal(
    stateLabel({ pipelineState: 'processing', pipelineJob: { name: 'neizvestno' } }),
    'обрабатывается'
  );
  assert.equal(stateLabel({ pipelineState: 'review' }), 'ждёт проверки');
});

test('упавший шаг виден автору с причиной и кнопкой повтора', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    await pool.query(
      `UPDATE lessons SET pipeline_state = 'failed', pipeline_error = 'transcribe: нет модели',
                          pipeline_job = '{"name":"transcribe","data":{}}'::jsonb
        WHERE id = $1`,
      [lesson.id]
    );
    const headers = await admin(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const html = await (await fetch(`${base}/admin/lesson/urok`, { headers })).text();
      assert.match(html, /нет модели/);
      assert.match(html, /data-retry="urok"/);
    });
  });
});

test('в кабинете видно, какой шаг идёт, и страница обновляется сама', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    await pool.query(
      `UPDATE lessons SET pipeline_state = 'processing',
                          pipeline_job = '{"name":"transcribe","data":{}}'::jsonb
        WHERE id = $1`,
      [lesson.id]
    );
    const headers = await admin(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const html = await (await fetch(`${base}/admin`, { headers })).text();
      assert.match(html, /распознаётся речь/);
      // Пока идёт счёт, страница перечитывается сама: иначе автор жмёт
      // перезагрузку вручную каждые полминуты.
      assert.match(html, /http-equiv="refresh"/);
    });
  });
});

test('когда всё сделано, страница сама не дёргается', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    const headers = await admin(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const html = await (await fetch(`${base}/admin`, { headers })).text();
      assert.ok(!html.includes('http-equiv="refresh"'));
    });
  });
});

test('в ленте состояние видит автор, но не зритель', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, {
      slug: 'urok',
      title: 'Урок',
      status: 'published',
      publishedAt: new Date()
    });
    await pool.query(`UPDATE lessons SET pipeline_state = 'processing' WHERE id = $1`, [lesson.id]);
    const headers = await admin(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const forAuthor = await (await fetch(`${base}/`, { headers })).text();
      assert.match(forAuthor, /обрабатывается/i);

      // Зрителю состояние обработки не говорит ничего, а лишняя надпись на
      // витрине выглядит поломкой.
      const forGuest = await (await fetch(`${base}/`, { headers: { Accept: 'text/html' } })).text();
      assert.ok(!/обрабатывается/i.test(forGuest));
    });
  });
});

test('отказ довеска не помечает урок упавшим', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    await pool.query(`UPDATE lessons SET pipeline_state = 'review' WHERE id = $1`, [lesson.id]);
    // Так пишет отказ довеска воркер: рядом с ним, а не в состояние урока.
    await pool.query(
      `UPDATE lessons SET generated = jsonb_set(generated, '{sideError}', $1::jsonb) WHERE id = $2`,
      [JSON.stringify({ step: 'makeCoverImage', message: 'квота исчерпана' }), lesson.id]
    );
    const headers = await admin(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const html = await (await fetch(`${base}/admin/lesson/urok`, { headers })).text();
      // Урок готов и ждёт проверки: «обработка упала» из-за необязательной
      // кнопки — это вранье, на которое заказчик и пожаловался.
      assert.match(html, /ждёт проверки/);
      assert.ok(!html.includes('Обработка упала'), 'урок помечен упавшим из-за довеска');
      // Но и молчать нельзя: отказ виден там, где нажимали кнопку.
      assert.match(html, /Нарисовать не вышло: квота исчерпана/);
    });
  });
});

test('шаги конвейера отличаются от довесков', async () => {
  const { isPipelineJob, JOBS } = await import('../src/queue.js');
  // Отказ шага конвейера — это застрявший урок, и его видно как «упало».
  for (const step of [JOBS.fetchSource, JOBS.transcribe, JOBS.makeClips, JOBS.makeCover]) {
    assert.ok(isPipelineJob(step), `${step} должен вести урок по конвейеру`);
  }
  // Отказ довеска урок не ломает: обложка есть, заголовок автор напишет сам.
  for (const step of [JOBS.makeCoverImage, JOBS.suggestTexts, JOBS.cleanupMedia]) {
    assert.ok(!isPipelineJob(step), `${step} — довесок, а не шаг конвейера`);
  }
});
