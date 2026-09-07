// Уведомления об окончании долгой работы. Копирование гигабайта, расшифровка
// часовой записи, нарезка роликов — это минуты и десятки минут: автор не сидит
// над страницей всё это время, а без уведомления узнаёт об окончании, только
// зайдя проверить.
import test from 'node:test';
import assert from 'node:assert/strict';
import { notifyJobDone } from '../src/services/notify/lesson.js';
import { saveLesson } from '../src/services/lessons.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

/** Каналы-заглушки: сеть в тесте не трогаем. */
function makeChannels() {
  const sent = [];
  return { sent, channels: { webpush: async (subs, message) => sent.push(message) } };
}

async function seed(pool) {
  const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
  );
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES ($1, 'https://push.example/1', 'k', 's')`,
    [Number(rows[0].id)]
  );
  return lesson;
}

test('об окончании работы автор узнаёт уведомлением', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await seed(pool);
    const { channels, sent } = makeChannels();
    await notifyJobDone(pool, channels, {
      lessonId: lesson.id,
      jobId: 'makeCover-1',
      title: 'Урок обработан',
      body: 'Расшифровка, субтитры и обложка готовы'
    });

    assert.equal(sent.length, 1);
    assert.equal(sent[0].title, 'Урок обработан');
    // Ссылка ведёт туда, где автор продолжит работу.
    assert.equal(sent[0].url, '/admin/lesson/urok');
  });
});

test('повторная доставка того же события не будит второй раз', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await seed(pool);
    const { channels, sent } = makeChannels();
    const once = () =>
      notifyJobDone(pool, channels, {
        lessonId: lesson.id,
        jobId: 'makeCover-1',
        title: 'Урок обработан',
        body: 'готово'
      });
    await once();
    await once();
    assert.equal(sent.length, 1);
  });
});

test('новая задача будит снова', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await seed(pool);
    const { channels, sent } = makeChannels();
    for (const jobId of ['makeClips-7', 'makeClips-8']) {
      await notifyJobDone(pool, channels, {
        lessonId: lesson.id,
        jobId,
        title: 'Ролики нарезаны',
        body: 'готово'
      });
    }
    // Пересобрал ролики второй раз — и об этом надо сказать.
    assert.equal(sent.length, 2);
  });
});

test('уведомление о пропавшем уроке никого не будит', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await seed(pool);
    const { channels, sent } = makeChannels();
    // Урок могли удалить, пока работа шла: падать на этом незачем.
    await notifyJobDone(pool, channels, {
      lessonId: 999999,
      jobId: 'makeCover-2',
      title: 'Урок обработан',
      body: 'готово'
    });
    assert.equal(sent.length, 0);
  });
});

test('воркер сообщает об итогах, а не о каждом шаге', async () => {
  const { readFile } = await import('node:fs/promises');
  const worker = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
  // Конец ищем ОТ начала списка: обработчики воркера объявлены и до него.
  const from = worker.indexOf('const DONE_MESSAGES');
  const block = worker.slice(from, worker.indexOf('worker.on(', from));

  // Итоги, после которых человек возвращается к уроку и что-то делает. Каждый
  // из этих шагов теперь запускается кнопкой и на себе же кончается — значит,
  // каждый и должен разбудить телефон.
  for (const step of ['fetchSource', 'subtitles', 'trimPauses', 'makeCover', 'makeClips']) {
    assert.match(block, new RegExp(`JOBS\\.${step}`), `нет уведомления об окончании ${step}`);
  }
  // «Звук извлечён» посреди обработки автору не нужен.
  for (const step of ['extractAudio', 'cleanupMedia']) {
    assert.ok(!block.includes(`JOBS.${step}`), `${step} будит зря`);
  }
});
