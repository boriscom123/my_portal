// Экран проверки — обязательный ручной шаг: наружу ничего не уходит, пока
// автор не нажал. Здесь проверяется, что он видит работу конвейера, может
// поправить тексты, опубликовать и повторить упавший шаг.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { saveLesson } from '../src/services/lessons.js';
import { parseTags } from '../src/routes/admin.js';
import { humanDuration, humanBytes } from '../src/views/admin-review.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://soloaijourney.online',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: '', botId: '', botUsername: '' },
  google: { clientId: '', clientSecret: '' },
  vapid: { publicKey: '', privateKey: '', subject: '' },
  redis: { url: 'redis://redis:6379', prefix: 'portal:' },
  yandex: { apiKey: '', folderId: '' },
  yandexOauth: { clientId: '', clientSecret: '' },
  tokenEncryptionKey: 'a'.repeat(64),
  media: { dir: '/tmp', ttlHours: 168 }
};

/** Урок, доведённый конвейером до проверки: обложка, субтитры, расшифровка. */
async function seed(pool, { failed = false } = {}) {
  const lesson = await saveLesson(pool, {
    slug: 'urok',
    title: 'Черновик',
    durationSeconds: 3930
  });
  const { rows: assets } = await pool.query(
    `INSERT INTO assets (lesson_id, kind, path, bytes, expires_at) VALUES
       ($1, 'source', 'lesson-1/source.mp4', 20000000, now() + interval '7 days'),
       ($1, 'subtitles', 'lesson-1/subtitles.srt', 900, now() + interval '70 days')
     RETURNING id, kind`,
    [lesson.id]
  );
  await pool.query(
    `INSERT INTO transcripts (lesson_id, text, provider) VALUES ($1, $2, 'whisper')`,
    [lesson.id, 'Здравствуйте, сегодня разбираем docker compose.']
  );
  // Реплики с временами: их правит автор прямо на экране проверки, и без них
  // проверялся бы запасной путь, а не рабочий.
  await pool.query(
    `INSERT INTO transcript_segments (lesson_id, started_ms, ended_ms, text)
     VALUES ($1, 0, 4000, 'Здравствуйте, сегодня разбираем docker compose.')`,
    [lesson.id]
  );
  await pool.query(
    `UPDATE lessons SET pipeline_state = $2, pipeline_error = $3, pipeline_job = $4,
                        cover_url = '/media/asset/7'
      WHERE id = $1`,
    [
      lesson.id,
      failed ? 'failed' : 'review',
      failed ? 'makeCover: ffmpeg вышел с кодом 1' : null,
      failed ? JSON.stringify({ name: 'makeCover', data: { lessonId: lesson.id } }) : null
    ]
  );

  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
  );
  return { lesson, adminId: Number(rows[0].id), assets };
}

function asAdmin(adminId) {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${signSession({ userId: adminId, role: 'admin' }, config.jwtSecret)}`
  };
}

test('длительность и размер показываются человеку, а не в секундах и байтах', () => {
  assert.equal(humanDuration(3930), '1:05:30');
  assert.equal(humanDuration(65), '1:05');
  assert.equal(humanDuration(null), '—');
  assert.equal(humanBytes(20 * 1024 * 1024), '20.0 МБ');
  assert.equal(humanBytes(3 * 1024 * 1024 * 1024), '3.00 ГБ');
});

test('теги разбираются из строки формы', () => {
  assert.deepEqual(parseTags(' Docker , vps,, '), ['docker', 'vps']);
  assert.deepEqual(parseTags(''), []);
});

test('автор видит обложку, расшифровку и файлы буфера', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { adminId } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const html = await (
        await fetch(`${base}/admin/lesson/urok`, {
          headers: { Accept: 'text/html', ...asAdmin(adminId) }
        })
      ).text();
      assert.match(html, /1:05:30/, 'длительность');
      assert.match(html, /media\/asset\/7/, 'обложка');
      assert.match(html, /docker compose/, 'расшифровка');
      // Расшифровка не просто показывается, а правится: распознавание
      // ошибается в именах и терминах, и правит их автор здесь же.
      assert.match(html, /data-transcript="urok"/);
      assert.match(html, /data-segment="/);
      // И заполнение полей из неё — чтобы автор правил готовое, а не сочинял
      // заголовок с чистого листа.
      assert.match(html, /data-autofill="urok"/);
      assert.match(html, /source\.mp4/, 'файлы буфера');
      // Субтитры лежат в буфере: наружу они смотрят только подписанной
      // ссылкой, прямого адреса на странице быть не должно.
      assert.match(html, /href="https:\/\/soloaijourney\.online\/media\/[\w.-]{20,}"/);
    });
  });
});

test('посторонний на экран проверки не попадает', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await seed(pool);
    const { rows } = await pool.query(
      `INSERT INTO users (display_name, role) VALUES ('Зритель', 'user') RETURNING id`
    );
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/admin/lesson/urok`, {
        headers: {
          Accept: 'text/html',
          Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'user' }, config.jwtSecret)}`
        }
      });
      assert.equal(res.status, 403);
    });
  });
});

test('до нажатия урок остаётся черновиком', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson } = await seed(pool);
    const { rows } = await pool.query('SELECT status FROM lessons WHERE id = $1', [lesson.id]);
    // Спека: наружу ничего не уходит, пока автор не нажал.
    assert.equal(rows[0].status, 'draft');
  });
});

test('публикация переносит правки автора в карточку урока', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, adminId } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/admin/lessons/urok/approve`, {
        method: 'POST',
        headers: asAdmin(adminId),
        body: JSON.stringify({
          title: 'Docker с нуля',
          description: 'Поправленное описание',
          tags: 'docker, vps',
          publish: true
        })
      });
      assert.equal(res.status, 200);
    });

    const { rows } = await pool.query(
      `SELECT l.title, l.description, l.status, l.pipeline_state, l.published_at,
              array_agg(t.slug ORDER BY t.slug) AS tags
         FROM lessons l
         LEFT JOIN lesson_tags lt ON lt.lesson_id = l.id
         LEFT JOIN tags t ON t.id = lt.tag_id
        WHERE l.id = $1 GROUP BY l.id`,
      [lesson.id]
    );
    assert.equal(rows[0].title, 'Docker с нуля');
    assert.equal(rows[0].description, 'Поправленное описание');
    assert.equal(rows[0].status, 'published');
    assert.ok(rows[0].published_at, 'дата публикации должна проставиться');
    assert.equal(rows[0].pipeline_state, 'idle', 'конвейеру здесь больше делать нечего');
    assert.deepEqual(rows[0].tags, ['docker', 'vps']);
  });
});

test('сохранение черновика не выпускает урок наружу', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, adminId } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      await fetch(`${base}/api/admin/lessons/urok/approve`, {
        method: 'POST',
        headers: asAdmin(adminId),
        body: JSON.stringify({ title: 'Пока думаю', publish: false })
      });
    });
    const { rows } = await pool.query('SELECT title, status FROM lessons WHERE id = $1', [
      lesson.id
    ]);
    assert.equal(rows[0].title, 'Пока думаю');
    assert.equal(rows[0].status, 'draft');
  });
});

test('пустой заголовок не принимается', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { adminId } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/admin/lessons/urok/approve`, {
        method: 'POST',
        headers: asAdmin(adminId),
        body: JSON.stringify({ title: '   ', publish: true })
      });
      assert.equal(res.status, 400);
    });
  });
});

test('повтор ставит ровно тот шаг, что упал', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, adminId } = await seed(pool, { failed: true });
    const added = [];
    const app = finalize(
      createApp({
        config,
        pool,
        queue: { add: async (name, data) => added.push({ name, data }) }
      })
    );
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/admin/lessons/urok/retry`, {
        method: 'POST',
        headers: asAdmin(adminId)
      });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).step, 'makeCover');
    });

    // Имя шага берётся из записанной задачи, а не разбирается из текста
    // ошибки: текст писан для человека и однажды поменяется.
    assert.deepEqual(added, [{ name: 'makeCover', data: { lessonId: lesson.id } }]);
    const { rows } = await pool.query('SELECT pipeline_state, pipeline_error FROM lessons');
    assert.equal(rows[0].pipeline_state, 'processing');
    assert.equal(rows[0].pipeline_error, null, 'старая ошибка не должна висеть на экране');
  });
});

test('повторять нечего — говорим об этом, а не запускаем наугад', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { adminId } = await seed(pool);
    const app = finalize(createApp({ config, pool, queue: { add: async () => {} } }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/admin/lessons/urok/retry`, {
        method: 'POST',
        headers: asAdmin(adminId)
      });
      assert.equal(res.status, 409);
    });
  });
});

test('пока идёт сборка, вторую запустить нельзя', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { adminId } = await seed(pool);
    await pool.query(`UPDATE lessons SET pipeline_state = 'processing' WHERE slug = 'urok'`);
    const app = finalize(createApp({ config, pool, queue: { add: async () => {} } }));
    await withServer(app, async (base) => {
      // Выключенной кнопки мало: страница могла быть открыта до начала сборки.
      const res = await fetch(`${base}/api/admin/lessons/urok/settings`, {
        method: 'POST',
        headers: asAdmin(adminId),
        body: JSON.stringify({ cutPauses: true, rebuild: true })
      });
      assert.equal(res.status, 409);
      assert.match((await res.json()).error, /уже идёт/);
    });
  });
});

test('настройки сохраняются и во время сборки — не запускается только пересборка', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { adminId } = await seed(pool);
    await pool.query(`UPDATE lessons SET pipeline_state = 'processing' WHERE slug = 'urok'`);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/admin/lessons/urok/settings`, {
        method: 'POST',
        headers: asAdmin(adminId),
        body: JSON.stringify({ subtitleColor: '#ffcc00', rebuild: false })
      });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).settings.subtitleColor, '#ffcc00');
    });
  });
});

test('во время сборки кнопка пересборки выключена и объяснена', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { adminId } = await seed(pool);
    await pool.query(
      `UPDATE lessons SET pipeline_state = 'processing',
                          pipeline_job = '{"name":"trimPauses","data":{}}'::jsonb
        WHERE slug = 'urok'`
    );
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const html = await (
        await fetch(`${base}/admin/lesson/urok`, {
          headers: { Accept: 'text/html', ...asAdmin(adminId) }
        })
      ).text();
      assert.match(html, /disabled title="Пересборка уже идёт"/);
      // Выключенная кнопка без объяснения читается как поломка.
      assert.match(html, /Пересборка уже идёт: обрабатывается: вырезаются паузы/);
    });
  });
});

test('сохранённые настройки видны в форме, а не умолчания', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { adminId } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      await fetch(`${base}/api/admin/lessons/urok/settings`, {
        method: 'POST',
        headers: asAdmin(adminId),
        body: JSON.stringify({
          subtitleOutline: '1.4',
          subtitleColor: '#ff0000',
          cutPauses: true,
          minPauseSeconds: '3'
        })
      });

      const html = await (
        await fetch(`${base}/admin/lesson/urok`, {
          headers: { Accept: 'text/html', ...asAdmin(adminId) }
        })
      ).text();

      // Форма показывала умолчания вместо сохранённого, и это выглядело как
      // «настройки не сохраняются». Хуже: следующее сохранение отправляло
      // умолчания обратно и затирало настоящие настройки.
      assert.match(html, /name="subtitleOutline"[\s\S]{0,80}value="1\.4"/);
      assert.match(html, /name="subtitleColor" type="color" value="#ff0000"/);
      assert.match(html, /name="cutPauses" type="checkbox" checked/);
      assert.match(html, /name="minPauseSeconds"[\s\S]{0,80}value="3"/);
    });
  });
});

test('пока записи нет, главное действие — загрузить её', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'pustoj', title: 'Пустой' });
    const { rows } = await pool.query(
      `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
    );
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const html = await (
        await fetch(`${base}/admin/lesson/pustoj`, {
          headers: {
            Accept: 'text/html',
            Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'admin' }, config.jwtSecret)}`
          }
        })
      ).text();
      assert.match(html, /Загрузить запись/);
      // Проверять нечего: записи нет.
      assert.ok(!html.includes('Проверить запись'));
      assert.ok(!html.includes('Заменить запись'));
    });
    assert.ok(lesson.id);
  });
});

test('когда запись есть, загрузка перестаёт быть главным действием', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { adminId } = await seed(pool);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const html = await (
        await fetch(`${base}/admin/lesson/urok`, {
          headers: { Accept: 'text/html', ...asAdmin(adminId) }
        })
      ).text();
      // Звать загрузить запись, когда она загружена, — звать сделать сделанное.
      assert.ok(!html.includes('Загрузить запись'));
      assert.match(html, /Заменить запись/);
      assert.match(html, /Проверить запись/);
      assert.ok(!html.includes('Как видит зритель'));
      assert.ok(!html.includes('Смотреть с субтитрами'));

      // В навигации остаётся только возврат к списку: остальные действия
      // живут в своих разделах, где понятно, к чему они относятся.
      // Закрытие ищем ОТ начала блока: первый </nav> в документе принадлежит
      // меню в шапке, и срез вышел бы пустым.
      const from = html.indexOf('<nav class="admin-nav">');
      const nav = html.slice(from, html.indexOf('</nav>', from));
      assert.match(nav, /href="\/admin\/lessons">← Уроки/);
      assert.ok(!nav.includes('preview'), 'проверка записи снова в навигации');
      assert.ok(!nav.includes('/admin/upload'), 'загрузка снова в навигации');
      assert.ok(!/href="\/lesson\//.test(nav), 'страница урока снова в навигации');
    });
  });
});

test('ролики собираются по нажатию, а не сами', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { adminId } = await seed(pool);
    const added = [];
    const app = finalize(
      createApp({ config, pool, queue: { add: async (name, data) => added.push({ name, data }) } })
    );
    await withServer(app, async (base) => {
      const html = await (
        await fetch(`${base}/admin/lesson/urok`, {
          headers: { Accept: 'text/html', ...asAdmin(adminId) }
        })
      ).text();
      // Кнопка есть всегда, и рядом сказано, почему собирать их надо после
      // правки титров: подписи вшиваются внутрь видео.
      assert.match(html, /data-clips="urok"/);
      assert.match(html, /ПОСЛЕ того, как поправите титры/);

      const res = await fetch(`${base}/api/admin/lessons/urok/clips`, {
        method: 'POST',
        headers: asAdmin(adminId)
      });
      assert.equal(res.status, 200);
    });
    assert.equal(added[0].name, 'makeClips');
  });
});

test('без расшифровки резать нечего, и это сказано', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { adminId } = await seed(pool);
    await pool.query('DELETE FROM transcript_segments');
    const app = finalize(createApp({ config, pool, queue: { add: async () => {} } }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/admin/lessons/urok/clips`, {
        method: 'POST',
        headers: asAdmin(adminId)
      });
      assert.equal(res.status, 409);
      assert.match((await res.json()).error, /расшифровки/i);
    });
  });
});

test('во время обработки вторую нарезку не запустить', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { adminId } = await seed(pool);
    await pool.query(`UPDATE lessons SET pipeline_state = 'processing' WHERE slug = 'urok'`);
    const app = finalize(createApp({ config, pool, queue: { add: async () => {} } }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/admin/lessons/urok/clips`, {
        method: 'POST',
        headers: asAdmin(adminId)
      });
      // Две нарезки разом заняли бы те же два ядра и переписывали бы одни и те
      // же файлы вперемешку.
      assert.equal(res.status, 409);
    });
  });
});
