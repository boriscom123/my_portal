// Настройки рисования: токен Hugging Face и список моделей.
// Главное — токен хранится зашифрованным, пустое поле его не стирает, а пустой
// список моделей означает список по умолчанию, а не «рисовать нечем».
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadDrawingSettings,
  saveDrawingSettings,
  forgetDrawingToken,
  DEFAULT_DRAWING_MODELS
} from '../src/services/drawing-settings.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = { tokenEncryptionKey: 'a'.repeat(64) };

test('без сохранённых настроек токена нет, модели — по умолчанию', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const settings = await loadDrawingSettings(pool, config);
    assert.equal(settings.token, '');
    assert.equal(settings.modelsText, '');
    assert.deepEqual(settings.models, [DEFAULT_DRAWING_MODELS]);
  });
});

test('токен и модели сохраняются, токен в базе зашифрован', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveDrawingSettings(pool, config, { token: 'hf_secret_token', models: 'первая, вторая' });
    const settings = await loadDrawingSettings(pool, config);
    assert.equal(settings.token, 'hf_secret_token');
    assert.equal(settings.modelsText, 'первая, вторая');
    assert.deepEqual(settings.models, ['первая', 'вторая']);

    const { rows } = await pool.query(
      `SELECT client_secret FROM platform_apps WHERE name = 'huggingface'`
    );
    assert.ok(!rows[0].client_secret.includes('hf_secret_token'), 'токен лежит открытым');
  });
});

test('пустое поле токена прежний не стирает', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveDrawingSettings(pool, config, { token: 'hf_secret_token', models: '' });
    // Показать сохранённый токен нельзя, поэтому поле на странице всегда
    // пустое: правка одного списка моделей не должна молча выключать рисование.
    await saveDrawingSettings(pool, config, { token: '', models: 'другая' });
    const settings = await loadDrawingSettings(pool, config);
    assert.equal(settings.token, 'hf_secret_token');
    assert.deepEqual(settings.models, ['другая']);
  });
});

test('убранный токен выключает рисование, модели остаются', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    await saveDrawingSettings(pool, config, { token: 'hf_secret_token', models: 'своя' });
    await forgetDrawingToken(pool);
    const settings = await loadDrawingSettings(pool, config);
    assert.equal(settings.token, '');
    assert.deepEqual(settings.models, ['своя']);
  });
});
