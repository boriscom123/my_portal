// Настройки автора: разделы «Проекты» и «Серии». Зрителю их нет.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { saveSeries } from '../src/services/series.js';
import { saveProject } from '../src/services/projects.js';
import { projectFields } from '../src/views/project-links.js';
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
  media: { dir: '/tmp', ttlHours: 168 },
  youtube: { clientId: '', clientSecret: '', redirectUri: '/back', mode: 'semi' }
};

test('поля проектов: основной выбран, его галочка спрятана', () => {
  const projects = [
    { id: 1, slug: 'solo-ai-journey', title: 'Solo AI Journey' },
    { id: 2, slug: 'idle-igra', title: 'IDLE игра' }
  ];
  const html = projectFields({ projects, mainId: 2, relatedIds: [1] });
  assert.match(html, /<option value="idle-igra" selected>/);
  assert.match(html, /<label[^>]*data-related="idle-igra"[^>]*hidden/);
  assert.match(html, /<input[^>]*name="relatedSlugs"[^>]*value="solo-ai-journey"[^>]*checked/);

  const locked = projectFields({ projects, mainId: 2, locked: 'задаётся серией' });
  assert.match(locked, /<select name="mainSlug"[^>]*disabled/);
  assert.match(locked, /задаётся серией/);

  // Проект необязателен: без основного выбран «Без проекта», не требование.
  const loose = projectFields({ projects, mainId: null });
  assert.match(loose, /<option value="" selected>Без проекта<\/option>/);
  assert.doesNotMatch(loose, /required/);
  assert.doesNotMatch(loose, /Выберите проект/);

  // Единственный проект уже основной — выбирать связанные не из чего. Пустой
  // блок выглядел как «связанных нет вовсе»; вместо него — подсказка, где их
  // завести.
  const lonely = projectFields({ projects: [projects[0]], mainId: 1, collapsible: true });
  assert.match(lonely, /Других проектов пока нет/);
  assert.match(lonely, /href="\/settings"/);
});

test('автор видит разделы «Проекты» и «Серии», зритель — нет', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveProject(pool, { title: 'IDLE игра' });
    await saveSeries(pool, { title: 'Портал с нуля' });
    const { rows } = await pool.query(
      `INSERT INTO users (display_name, role) VALUES ('Автор', 'admin') RETURNING id`
    );
    const headers = {
      Accept: 'text/html',
      Authorization: `Bearer ${signSession({ userId: Number(rows[0].id), role: 'admin' }, config.jwtSecret)}`
    };
    const app = finalize(createApp({ config, pool, queue: { add: async () => {} } }));

    await withServer(app, async (base) => {
      const author = await (await fetch(`${base}/settings`, { headers })).text();
      assert.match(author, /data-block="projects"/);
      assert.match(author, /<form data-project-form="idle-igra"/);
      assert.match(author, /<form data-project-form=""/);
      assert.match(author, /data-block="series"/);
      assert.match(author, /<form data-series-settings="portal-s-nulya"/);
      assert.match(author, /href="\/series\/portal-s-nulya"/);

      const guest = await (await fetch(`${base}/settings`)).text();
      assert.doesNotMatch(guest, /data-block="projects"/);
      assert.doesNotMatch(guest, /data-block="series"/);
    });
  });
});
