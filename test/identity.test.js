// Проверка трёх правил входа. Именно этот тест закрывает критерий приёмки
// заказчика: вошёл Google, вышел, вошёл Telegram — один аккаунт.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveIdentity } from '../src/services/identity.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const google = { provider: 'google', externalId: '42', displayName: 'Пётр' };
const telegram = { provider: 'tg_widget', externalId: '7', displayName: 'Пётр из телеги' };

test('первый вход заводит человека', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const result = await resolveIdentity(pool, google);
    assert.equal(result.created, true);
    assert.equal(result.role, 'user');
  });
});

test('повторный вход тем же способом — тот же человек', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const first = await resolveIdentity(pool, google);
    const second = await resolveIdentity(pool, google);
    assert.equal(second.created, false);
    assert.equal(second.userId, first.userId);
  });
});

test('вход другим способом при живой сессии привязывается к тому же', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const first = await resolveIdentity(pool, google);
    const second = await resolveIdentity(pool, { ...telegram, currentUserId: first.userId });
    assert.equal(second.userId, first.userId);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM users');
    assert.equal(rows[0].n, 1);
  });
});

test('вход другим способом без сессии заводит второго человека', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await resolveIdentity(pool, google);
    await resolveIdentity(pool, telegram);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM users');
    assert.equal(rows[0].n, 2);
  });
});

test('роль админа выдаётся по списку из окружения', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const admins = [{ provider: 'google', externalId: '42' }];
    const result = await resolveIdentity(pool, { ...google, adminIdentities: admins });
    assert.equal(result.role, 'admin');
  });
});

test('добавление в список админов действует со следующего входа', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const first = await resolveIdentity(pool, google);
    assert.equal(first.role, 'user');
    const second = await resolveIdentity(pool, {
      ...google,
      adminIdentities: [{ provider: 'google', externalId: '42' }]
    });
    assert.equal(second.role, 'admin');
  });
});

test('чужая привязка к своему аккаунту не переезжает', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const owner = await resolveIdentity(pool, telegram);
    const other = await resolveIdentity(pool, google);
    // Второй человек пытается привязать телеграм, уже занятый первым.
    const result = await resolveIdentity(pool, { ...telegram, currentUserId: other.userId });
    assert.equal(result.userId, owner.userId);
    assert.equal(result.conflict, true);
  });
});
