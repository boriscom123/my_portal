// Раздел «Уроки»: завести, открыть, убрать. Раньше урок заводился запросом к
// API вручную, а убрать его было нельзя вовсе — неудачный черновик оставался в
// списке навсегда вместе с полугигабайтом исходника в буфере.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { saveLesson } from '../src/services/lessons.js';
import { registerAsset } from '../src/services/media.js';
import { slugify, uniqueSlug, transliterate } from '../src/lib/slug.js';
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
    media: { dir: await mkdtemp(path.join(tmpdir(), 'portal-adm-')), ttlHours: 168 }
  };
}

async function adminHeaders(pool, config) {
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
  );
  return {
    Accept: 'text/html',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'admin' }, config.jwtSecret)}`
  };
}

test('адрес урока собирается из русского заголовка', () => {
  // Кириллица в адресе превращается в проценты: читать такую ссылку нельзя, а
  // половина сервисов ломает её при переносе строки.
  assert.equal(slugify('Docker и nginx: связка на VPS'), 'docker-i-nginx-svyazka-na-vps');
  assert.equal(transliterate('щука'), 'schuka');
  // Из одних знаков препинания адреса не выйдет — вызывающий подставит свой.
  assert.equal(slugify('!!! ???'), '');
});

test('занятый адрес получает номер, а не падает', () => {
  assert.equal(uniqueSlug('urok', ['urok', 'urok-2']), 'urok-3');
  assert.equal(uniqueSlug('svobodnyj', ['urok']), 'svobodnyj');
});

test('урок заводится по одному заголовку', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const headers = await adminHeaders(pool, config);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/admin/lessons`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: 'Планирование системы' })
      });
      assert.equal(res.status, 200);
      const { lesson } = await res.json();
      assert.equal(lesson.slug, 'planirovanie-sistemy');
    });
  });
});

test('второй урок с тем же заголовком получает свой адрес', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const headers = await adminHeaders(pool, config);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const slugs = [];
      for (let i = 0; i < 2; i += 1) {
        const res = await fetch(`${base}/api/admin/lessons`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ title: 'Один и тот же' })
        });
        slugs.push((await res.json()).lesson.slug);
      }
      // Два урока с одним адресом невозможны на уровне базы, и падать на этом
      // при похожих заголовках незачем.
      assert.notEqual(slugs[0], slugs[1]);
    });
  });
});

test('без заголовка урок не заводится', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const headers = await adminHeaders(pool, config);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/admin/lessons`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: '   ' })
      });
      assert.equal(res.status, 400);
    });
  });
});

test('удаление уносит урок вместе с файлами буфера', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'chernovik', title: 'Черновик' });
    const dir = path.join(config.media.dir, `lesson-${lesson.id}`);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, 'source.mp4');
    await writeFile(file, 'полгигабайта, условно');
    await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'source',
      relativePath: `lesson-${lesson.id}/source.mp4`,
      bytes: 21
    });
    await pool.query(
      `INSERT INTO transcripts (lesson_id, text, provider) VALUES ($1, 'текст', 'whisper.cpp')`,
      [lesson.id]
    );

    const headers = await adminHeaders(pool, config);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/admin/lessons/chernovik`, {
        method: 'DELETE',
        headers
      });
      assert.equal(res.status, 200);
    });

    // Иначе неудачный черновик оставался бы в буфере полугигабайтом навсегда.
    await assert.rejects(stat(file), 'файл остался на диске');
    await assert.rejects(stat(dir), 'каталог урока остался');
    const { rows } = await pool.query(
      `SELECT (SELECT count(*) FROM lessons)::int AS lessons,
              (SELECT count(*) FROM assets)::int AS assets,
              (SELECT count(*) FROM transcripts)::int AS transcripts`
    );
    assert.deepEqual(rows[0], { lessons: 0, assets: 0, transcripts: 0 });
  });
});

test('опубликованный урок так просто не удалить', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    await saveLesson(pool, {
      slug: 'vyshel',
      title: 'Вышел',
      status: 'published',
      publishedAt: new Date()
    });
    const headers = await adminHeaders(pool, config);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/admin/lessons/vyshel`, { method: 'DELETE', headers });
      // На него уже могут вести ссылки с площадок: удалять надо осознанно,
      // сначала сняв с витрины.
      assert.equal(res.status, 409);
    });
    const { rows } = await pool.query('SELECT count(*)::int n FROM lessons');
    assert.equal(rows[0].n, 1);
  });
});

test('на странице видны уроки, форма заведения и кнопка удаления', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    await saveLesson(pool, { slug: 'chernovik', title: 'Черновик' });
    const headers = await adminHeaders(pool, config);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const html = await (await fetch(`${base}/admin/lessons`, { headers })).text();
      assert.match(html, /data-new-lesson/);
      assert.match(html, /data-lesson-delete="chernovik"/);
      assert.match(html, /Черновик/);
    });
  });
});

test('посторонний в раздел уроков не попадает', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    const { rows } = await pool.query(
      `INSERT INTO users (display_name, role) VALUES ('Зритель', 'user') RETURNING id`
    );
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/admin/lessons`, {
        headers: {
          Accept: 'text/html',
          Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'user' }, config.jwtSecret)}`
        }
      });
      assert.equal(res.status, 403);
    });
  });
});

test('на странице уроков нет ссылок, которые уже есть в меню', skipWithoutDb, async () => {
  const config = await makeConfig();
  await withTestDb(async (pool) => {
    await saveLesson(pool, { slug: 'chernovik', title: 'Черновик' });
    const headers = await adminHeaders(pool, config);
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const html = await (await fetch(`${base}/admin/lessons`, { headers })).text();
      const main = html.slice(html.indexOf('<main>'), html.indexOf('</main>'));
      // Настройки, идеи и витрина живут в меню шапки: повторять их на странице
      // значит показывать одно и то же дважды.
      for (const link of ['/settings', '/ideas', '"/"']) {
        assert.ok(!main.includes(`href="${link.replace(/"/g, '')}"`), `в теле осталась ссылка ${link}`);
      }
    });
  });
});
