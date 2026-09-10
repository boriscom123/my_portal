// Выкладка ролика в Instagram Reels. Без сети: fetch подменяется.
//
// Главное отличие площадки от каналов — она не принимает файл в запросе, а
// приходит за ним по ссылке и обрабатывает у себя. Отсюда и ожидание, и то, что
// ссылка обязана быть живой и открытой, пока площадка не заберёт файл.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  instagramConsentUrl,
  exchangeInstagramCode,
  instagramAccess
} from '../src/services/platforms/instagram-auth.js';
import {
  createReelContainer,
  containerStatus,
  publishContainer,
  mediaPermalink
} from '../src/services/platforms/instagram.js';
import { makePublishInstagram } from '../src/jobs/publish-instagram.js';
import { saveShort, publishShort, setShortFile } from '../src/services/shorts.js';
import { registerAsset } from '../src/services/media.js';
import { startPublication, shortPublications } from '../src/services/publications.js';
import { saveIntegration, loadIntegration } from '../src/services/disk.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = {
  publicBaseUrl: 'https://portal.example',
  jwtSecret: 'x'.repeat(32),
  tokenEncryptionKey: 'a'.repeat(64),
  media: { dir: '/tmp', ttlHours: 168 }
};

const app = {
  clientId: 'app-1',
  clientSecret: 'secret-1',
  redirectUri: 'https://portal.example/api/integrations/instagram/callback'
};

test('на экран согласия уходят ровно два права', () => {
  const url = new URL(instagramConsentUrl(app, 'state-1'));
  assert.equal(url.origin + url.pathname, 'https://www.instagram.com/oauth/authorize');
  // Лишние права не безобидны: их видит человек на экране согласия, и заявку на
  // проверку читает тоже человек.
  assert.equal(
    url.searchParams.get('scope'),
    'instagram_business_basic,instagram_business_content_publish'
  );
  assert.equal(url.searchParams.get('redirect_uri'), app.redirectUri);
  assert.equal(url.searchParams.get('state'), 'state-1');
});

test('код меняется на ДОЛГИЙ токен, а не на часовой', async () => {
  // Остановись обмен на первом ответе — подключение выглядело бы удачным и
  // переставало работать через час.
  const seen = [];
  const fetchStub = async (url) => {
    seen.push(String(url).split('?')[0]);
    return String(url).includes('api.instagram.com')
      ? { ok: true, text: async () => JSON.stringify({ access_token: 'short', user_id: 777 }) }
      : {
          ok: true,
          text: async () => JSON.stringify({ access_token: 'long', expires_in: 5184000 })
        };
  };

  const access = await exchangeInstagramCode(app, 'code-1', fetchStub);
  assert.deepEqual(seen, [
    'https://api.instagram.com/oauth/access_token',
    'https://graph.instagram.com/access_token'
  ]);
  assert.equal(access.token, 'long');
  assert.equal(access.userId, '777');
  assert.ok(access.expiresAt.getTime() > Date.now() + 50 * 24 * 3600_000);
});

test('секрет приложения не попадает в текст отказа', async () => {
  const fetchStub = async () => ({
    ok: false,
    status: 400,
    text: async () => 'bad client_secret=secret-1'
  });
  await assert.rejects(exchangeInstagramCode(app, 'code-1', fetchStub), (error) => {
    assert.equal(error.message.includes('secret-1'), false, 'секрет ушёл бы в журнал и на экран');
    return true;
  });
});

test('токен на исходе продлевается сам и сохраняется', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveIntegration(pool, config, {
      name: 'instagram',
      token: 'старый',
      refreshToken: '777',
      // Через час: своего refresh-токена у площадки нет, продлевать надо заранее.
      expiresAt: new Date(Date.now() + 3600_000)
    });

    const access = await instagramAccess(pool, config, async (url) => {
      assert.match(String(url), /refresh_access_token/);
      return { ok: true, text: async () => JSON.stringify({ access_token: 'новый', expires_in: 5184000 }) };
    });

    assert.equal(access.token, 'новый');
    // Номер аккаунта живёт в поле refresh-токена и обязан пережить продление:
    // без него ни один запрос выкладки не уйдёт.
    assert.equal(access.userId, '777');
    assert.equal((await loadIntegration(pool, config, 'instagram')).token, 'новый');
  });
});

test('живой токен не продлевается зря', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveIntegration(pool, config, {
      name: 'instagram',
      token: 'живой',
      refreshToken: '777',
      expiresAt: new Date(Date.now() + 40 * 24 * 3600_000)
    });
    const access = await instagramAccess(pool, config, async () => {
      throw new Error('в сеть ходить не за чем');
    });
    assert.equal(access.token, 'живой');
  });
});

test('контейнер собирается роликом, а не картинкой', async () => {
  let sent = null;
  const fetchStub = async (url, options) => {
    sent = { url: String(url), body: new URLSearchParams(options.body) };
    return { ok: true, text: async () => JSON.stringify({ id: 'container-1' }) };
  };

  const id = await createReelContainer({
    token: 'tok',
    userId: '777',
    videoUrl: 'https://portal.example/media/abc',
    caption: 'Заголовок',
    fetchImpl: fetchStub
  });

  assert.equal(id, 'container-1');
  assert.match(sent.url, /graph\.instagram\.com\/v\d+\.\d+\/777\/media$/);
  assert.equal(sent.body.get('media_type'), 'REELS');
  assert.equal(sent.body.get('video_url'), 'https://portal.example/media/abc');
  // Без share_to_feed подписчик, зашедший на профиль, ролика не увидит.
  assert.equal(sent.body.get('share_to_feed'), 'true');
});

test('отказ площадки объясняется её же словами', async () => {
  const fetchStub = async () => ({
    ok: false,
    status: 400,
    text: async () => JSON.stringify({ error: { message: 'The video file is too large' } })
  });
  await assert.rejects(
    createReelContainer({ token: 't', userId: '1', videoUrl: 'u', caption: 'c', fetchImpl: fetchStub }),
    /video file is too large/
  );
});

test('состояние контейнера и публикация читаются как надо', async () => {
  const status = await containerStatus({
    token: 't',
    containerId: 'c1',
    fetchImpl: async (url) => {
      assert.match(String(url), /fields=status_code/);
      return { ok: true, text: async () => JSON.stringify({ status_code: 'FINISHED' }) };
    }
  });
  assert.equal(status.code, 'FINISHED');

  const mediaId = await publishContainer({
    token: 't',
    userId: '777',
    containerId: 'c1',
    fetchImpl: async (url, options) => {
      assert.match(String(url), /777\/media_publish$/);
      assert.equal(new URLSearchParams(options.body).get('creation_id'), 'c1');
      return { ok: true, text: async () => JSON.stringify({ id: 'media-9' }) };
    }
  });
  assert.equal(mediaId, 'media-9');
});

test('без адреса записи выкладка не рушится', async () => {
  // Ролик уже опубликован: остаться без ссылки досадно, но ронять из-за неё
  // удачную выкладку нельзя.
  const link = await mediaPermalink({
    token: 't',
    mediaId: 'media-9',
    fetchImpl: async () => ({ ok: false, status: 400, text: async () => 'нет доступа' })
  });
  assert.equal(link, null);
});

/** Выпущенный ролик с файлом — то, что шаг ждёт на входе. */
async function readyShort(pool) {
  const short = await saveShort(pool, { title: 'Вертикаль', description: 'Про портал' });
  const asset = await registerAsset(pool, config, {
    shortId: short.id,
    kind: 'vertical',
    relativePath: `short-${short.id}/vertical.mp4`,
    bytes: 1024
  });
  await setShortFile(pool, short.id, { assetId: asset.id });
  await publishShort(pool, short.slug);
  const { id: publicationId } = await startPublication(pool, {
    shortId: short.id,
    platform: 'instagram',
    mode: 'auto'
  });
  return { short, publicationId };
}

function apiStub(overrides = {}) {
  const calls = [];
  return {
    calls,
    access: async () => ({ token: 'tok', userId: '777' }),
    createContainer: async (args) => (calls.push(args), 'container-1'),
    status: async () => ({ code: 'FINISHED' }),
    publish: async () => 'media-9',
    permalink: async () => 'https://www.instagram.com/reel/abc/',
    ...overrides
  };
}

test('ролик уходит по подписанной ссылке и запоминается', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { short, publicationId } = await readyShort(pool);
    const api = apiStub();

    await makePublishInstagram(config, pool, api)({ shortId: short.id, publicationId });

    // Площадка приходит за файлом сама — ссылка временная и подписанная, а не
    // прямой адрес буфера.
    assert.match(api.calls[0].videoUrl, /^https:\/\/portal\.example\/media\/[\w.-]+$/);
    assert.match(api.calls[0].caption, /Вертикаль/);
    assert.match(api.calls[0].caption, /Про портал/);

    const [publication] = await shortPublications(pool, short.id);
    assert.equal(publication.state, 'published');
    assert.equal(publication.externalId, 'media-9');
    assert.equal(publication.url, 'https://www.instagram.com/reel/abc/');
  });
});

test('отказ обработки виден человеком, а не молчанием', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { short, publicationId } = await readyShort(pool);
    const api = apiStub({
      status: async () => ({ code: 'ERROR', detail: 'формат не подошёл' })
    });

    await assert.rejects(
      makePublishInstagram(config, pool, api)({ shortId: short.id, publicationId }),
      /ERROR.*формат не подошёл/
    );
    const [publication] = await shortPublications(pool, short.id);
    assert.equal(publication.state, 'failed');
    assert.match(publication.error, /формат не подошёл/);
  });
});

test('черновик в Instagram не уходит', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { short, publicationId } = await readyShort(pool);
    await publishShort(pool, short.slug, false);
    const api = apiStub();

    await assert.rejects(
      makePublishInstagram(config, pool, api)({ shortId: short.id, publicationId }),
      /черновик/i
    );
    // Площадка пришла бы за файлом по ссылке, а у черновика файл закрыт.
    assert.equal(api.calls.length, 0);
  });
});

test('без подключённого аккаунта шаг говорит, что делать', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { short, publicationId } = await readyShort(pool);
    const api = apiStub({ access: async () => null });

    await assert.rejects(
      makePublishInstagram(config, pool, api)({ shortId: short.id, publicationId }),
      /подключите его в настройках/
    );
  });
});
