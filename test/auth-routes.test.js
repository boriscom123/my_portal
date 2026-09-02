// Проверка маршрутов входа целиком: кука ставится, /me её читает, выход гасит,
// гость получает 401 на защищённом маршруте.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp, finalize } from '../src/app.js';
import { requireUser } from '../src/middleware/guards.js';
import { withServer } from './helpers/http.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const botToken = '123456:ABC-DEF';
const config = {
  publicBaseUrl: 'https://soloaijourney.online',
  jwtSecret: 'x'.repeat(32),
  adminIdentities: [],
  telegram: { botToken, channelId: '', botUsername: 'solo_ai_journey_bot' },
  google: { clientId: 'cid', clientSecret: 'sec' }
};

function signedWidget(fields) {
  const checkString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = crypto.createHash('sha256').update(botToken).digest();
  return { ...fields, hash: crypto.createHmac('sha256', secret).update(checkString).digest('hex') };
}

/** Свежие данные виджета: подпись протухает за сутки. */
function свежийВиджет() {
  return signedWidget({
    id: '7',
    first_name: 'Пётр',
    auth_date: String(Math.floor(Date.now() / 1000))
  });
}

/** Достаёт значение куки сессии из заголовка ответа. */
function sessionCookie(res) {
  const raw = res.headers.getSetCookie().find((c) => c.startsWith('portal_session='));
  return raw ? raw.split(';')[0] : null;
}

async function войти(base, data = свежийВиджет()) {
  return fetch(`${base}/api/auth/telegram`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

test('вход виджетом ставит куку, /me её читает', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const login = await войти(base);
      assert.equal(login.status, 200);
      const cookie = sessionCookie(login);
      assert.ok(cookie);

      const me = await fetch(`${base}/api/auth/me`, { headers: { cookie } });
      const body = await me.json();
      assert.equal(body.user.displayName, 'Пётр');
      assert.equal(body.user.role, 'user');
      assert.deepEqual(body.user.providers, ['tg_widget']);
    });
  });
});

test('кука закрыта от скриптов и не ходит по http', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const raw = (await войти(base)).headers.getSetCookie().find((c) => c.startsWith('portal_session='));
      assert.match(raw, /HttpOnly/i);
      assert.match(raw, /Secure/i);
      assert.match(raw, /SameSite=Lax/i);
    });
  });
});

test('подделанные данные виджета не пускают', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await войти(base, {
        id: '7',
        first_name: 'Пётр',
        auth_date: String(Math.floor(Date.now() / 1000)),
        hash: 'подделка'
      });
      assert.equal(res.status, 401);
    });
  });
});

test('гость на защищённом маршруте получает 401', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const app = createApp({ config, pool });
    app.post('/api/test/guard', requireUser, (req, res) => res.json({ ok: true }));
    finalize(app);
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/test/guard`, {
        method: 'POST',
        headers: { Accept: 'application/json' }
      });
      assert.equal(res.status, 401);
    });
  });
});

test('токен заголовком работает наравне с кукой', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const { token } = await (await войти(base)).json();
      const me = await fetch(`${base}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      assert.equal((await me.json()).user.displayName, 'Пётр');
    });
  });
});

test('выход гасит куку', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const login = await войти(base);
      const out = await fetch(`${base}/api/auth/logout`, {
        method: 'POST',
        headers: { cookie: sessionCookie(login) }
      });
      const cleared = out.headers.getSetCookie().find((c) => c.startsWith('portal_session='));
      assert.match(cleared, /portal_session=;|Max-Age=0/);
    });
  });
});

test('гость виден как отсутствующий пользователь', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const me = await fetch(`${base}/api/auth/me`);
      assert.deepEqual(await me.json(), { user: null });
    });
  });
});

test('вход через Google уводит на экран согласия со state', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/auth/google`, { redirect: 'manual' });
      assert.equal(res.status, 302);
      const url = new URL(res.headers.get('location'));
      assert.equal(url.host, 'accounts.google.com');
      assert.equal(
        url.searchParams.get('redirect_uri'),
        'https://soloaijourney.online/api/auth/google/callback'
      );
      assert.ok(url.searchParams.get('state').length > 20);
    });
  });
});

test('возврат Google с чужим state не принимается', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const app = finalize(createApp({ config, pool }));
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/auth/google/callback?code=C&state=подделка`, {
        headers: { Accept: 'application/json' }
      });
      assert.equal(res.status, 400);
    });
  });
});
