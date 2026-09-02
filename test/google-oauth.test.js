// Проверка обмена кода на профиль. Сеть в тесте не трогаем: fetch
// подставляется аргументом — иначе тест зависел бы от Google и от интернета.
import test from 'node:test';
import assert from 'node:assert/strict';
import { googleRedirectUri, buildConsentUrl, fetchGoogleProfile } from '../src/lib/google-oauth.js';

test('адрес возврата собирается из адреса портала', () => {
  assert.equal(
    googleRedirectUri('https://soloaijourney.online'),
    'https://soloaijourney.online/api/auth/google/callback'
  );
});

test('ссылка на согласие несёт state и адрес возврата', () => {
  const url = new URL(
    buildConsentUrl({
      clientId: 'cid',
      redirectUri: 'https://soloaijourney.online/api/auth/google/callback',
      state: 'st'
    })
  );
  assert.equal(url.searchParams.get('client_id'), 'cid');
  assert.equal(url.searchParams.get('state'), 'st');
  assert.equal(url.searchParams.get('response_type'), 'code');
});

test('код меняется на профиль', async () => {
  const calls = [];
  const fetchStub = async (url, options) => {
    calls.push(String(url));
    if (String(url).includes('token')) {
      return { ok: true, json: async () => ({ access_token: 'AT' }) };
    }
    assert.equal(options.headers.Authorization, 'Bearer AT');
    return {
      ok: true,
      json: async () => ({ id: '42', name: 'Пётр', picture: 'https://пример/аватар.png' })
    };
  };

  const profile = await fetchGoogleProfile(
    { code: 'C', clientId: 'cid', clientSecret: 'sec', redirectUri: 'https://п/cb' },
    fetchStub
  );

  assert.deepEqual(profile, {
    externalId: '42',
    displayName: 'Пётр',
    avatarUrl: 'https://пример/аватар.png'
  });
  assert.equal(calls.length, 2);
});

test('отказ Google превращается в понятную ошибку', async () => {
  const fetchStub = async () => ({ ok: false, status: 400, text: async () => 'invalid_grant' });
  await assert.rejects(
    fetchGoogleProfile(
      { code: 'C', clientId: 'cid', clientSecret: 'sec', redirectUri: 'https://п/cb' },
      fetchStub
    ),
    /Google/
  );
});
