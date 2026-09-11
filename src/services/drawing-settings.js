// Настройки рисования: токен Hugging Face и список моделей.
//
// Задача — держать их там, где их меняет автор, — в блоке настроек, — и
// отдавать слою рисования свежими перед каждой картинкой. Хранятся в той же
// таблице, что ключи площадок, и токен шифруется тем же ключом. Номера
// приложения у Hugging Face нет, поэтому client_id пустой.
// Вызывается из src/worker.js, src/routes/integrations.js, src/routes/pages.js
// и src/routes/admin.js.
import { loadPlatformApp, savePlatformApp, forgetPlatformSecret } from './platform-apps.js';
import { parseModels } from './texts.js';

export const DRAWING_APP = 'huggingface';

// FLUX.1 schnell: около $0.003 за картинку, и на Hugging Face его сейчас
// обслуживает поставщик Nscale, в которого и ходит слой рисования.
export const DEFAULT_DRAWING_MODELS = 'black-forest-labs/FLUX.1-schnell';

/** Токен и модели из базы. Пустой список моделей — значит, по умолчанию. */
export async function loadDrawingSettings(pool, config) {
  const stored = await loadPlatformApp(pool, config, DRAWING_APP);
  const modelsText = String(stored?.settings?.models ?? '').trim();
  return {
    token: stored?.clientSecret ?? '',
    modelsText,
    models: parseModels(modelsText || DEFAULT_DRAWING_MODELS)
  };
}

/** Сохраняет токен и модели. Пустой токен прежний не стирает. */
export async function saveDrawingSettings(pool, config, { token = '', models = '' }) {
  await savePlatformApp(pool, config, {
    name: DRAWING_APP,
    clientId: '',
    clientSecret: String(token ?? '').trim(),
    mode: 'semi',
    settings: { models: parseModels(models).join(', ') }
  });
}

/** Стирает токен: рисование выключается, список моделей остаётся. */
export async function forgetDrawingToken(pool) {
  await forgetPlatformSecret(pool, DRAWING_APP);
}
