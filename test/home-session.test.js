// Главная обязана показывать, что человек вошёл. Без этого вход выглядит
// сломанным, даже когда он отработал: заказчик так и сообщил — «не сработало»,
// хотя аккаунт в базе завёлся и обе привязки склеились.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, finalize } from '../src/app.js';
import { signSession } from '../src/lib/jwt.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://soloaijourney.online',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken: '', botUsername: '' },
  google: { clientId: '', clientSecret: '' }
};

test('вошедший видит своё имя на главной, гость — кнопку входа', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { rows } = await pool.query(
      `INSERT INTO users (display_name) VALUES ('Борис') RETURNING id`
    );
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const guest = await (await fetch(`${base}/`)).text();
      assert.match(guest, />Войти</);

      const mine = await (
        await fetch(`${base}/`, {
          headers: {
            Authorization: `Bearer ${signSession({ userId: rows[0].id, role: 'user' }, config.jwtSecret)}`
          }
        })
      ).text();
      assert.match(mine, /Борис/);
      assert.ok(!mine.includes('>Войти<'));
      assert.match(mine, /Выйти/);
    });
  });
});

test('страницы не кладутся в общий кеш — они зависят от того, кто смотрит', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/`);
      assert.match(res.headers.get('cache-control'), /private/);
    });
  });
});
