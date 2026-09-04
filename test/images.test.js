// Обложка, нарисованная моделью. В сеть не ходим: fetch подставляется.
// Проверяется то, что ломается на деле — разбор ответа, запрет надписей в
// задании и поведение при отказе по квоте.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createImages,
  buildCoverPrompt,
  parseImageResponse,
  extensionFor
} from '../src/services/images.js';

const config = {
  gemini: { apiKey: 'секретный-ключ', imageModel: 'первая,вторая' }
};

/** Ответ модели с картинкой в том виде, в каком его отдаёт Gemini. */
function withImage(mimeType = 'image/png') {
  return {
    ok: true,
    json: async () => ({
      candidates: [
        { content: { parts: [{ inlineData: { mimeType, data: Buffer.from('картинка').toString('base64') } }] } }
      ]
    })
  };
}

test('без ключа рисования нет, и это не ошибка', () => {
  // Обложка у урока и так есть — кадр из записи; портал обязан работать без
  // рисования.
  assert.equal(createImages({ gemini: { apiKey: '', imageModel: 'x' } }), null);
  assert.equal(createImages({ gemini: { apiKey: 'k', imageModel: '' } }), null);
});

test('в задании прямо запрещены надписи', () => {
  const prompt = buildCoverPrompt({ title: 'Портал на VPS', description: 'Каркас', tags: ['vps'] });
  // Модели рисуют буквы с ошибками, а кириллицу особенно: обложка с
  // исковерканным словом хуже, чем без слов.
  assert.match(prompt, /Никаких надписей/);
  assert.match(prompt, /Портал на VPS/);
  assert.match(prompt, /vps/);
});

test('картинка достаётся из ответа', () => {
  const { bytes, mimeType } = parseImageResponse({
    candidates: [
      { content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: 'YWJj' } }] } }
    ]
  });
  assert.equal(bytes.toString(), 'abc');
  assert.equal(mimeType, 'image/jpeg');
});

test('ответ текстом вместо картинки — это отказ, а не картинка', () => {
  // Модель отвечает несколькими частями и может вернуть пояснение вместо
  // изображения; принять пустоту за обложку значит положить в карточку урока
  // битый файл.
  assert.throws(
    () =>
      parseImageResponse({
        candidates: [{ content: { parts: [{ text: 'Не могу нарисовать это' }] } }]
      }),
    /ответила текстом/
  );
  assert.throws(() => parseImageResponse({}), /не вернула картинку/);
});

test('расширение берётся из типа ответа', () => {
  // png и jpeg модели отдают вперемешку, а имя файла уходит в адрес обложки.
  assert.equal(extensionFor('image/jpeg'), 'jpg');
  assert.equal(extensionFor('image/png'), 'png');
});

test('соотношение сторон просим явно', async () => {
  let sent = null;
  const images = createImages(config, async (url, options) => {
    sent = JSON.parse(options.body);
    return withImage();
  });
  await images.generate('нарисуй');
  // Обложка идёт в карточку урока и в превью ссылки, а квадрат там обрезается
  // по краям.
  assert.equal(sent.generationConfig.imageConfig.aspectRatio, '16:9');
});

test('исчерпанная квота уступает следующей модели', async () => {
  // На бесплатной доле все шесть моделей рисования отвечают отказом по квоте
  // сразу же — проверено на настоящем ключе.
  const tried = [];
  const images = createImages(config, async (url) => {
    const name = String(url).split('/').pop().split(':')[0];
    tried.push(name);
    if (name === 'первая') return { ok: false, status: 429, text: async () => 'quota' };
    return withImage();
  });
  const result = await images.generate('нарисуй');
  assert.deepEqual(tried, ['первая', 'вторая']);
  assert.equal(result.model, 'вторая');
});

test('в отказе ключа нет', async () => {
  const images = createImages(config, async () => ({
    ok: false,
    status: 429,
    text: async () => 'quota exceeded for key секретный-ключ'
  }));
  await assert.rejects(images.generate('нарисуй'), (error) => {
    assert.ok(!error.message.includes('секретный-ключ'), `ключ утёк: ${error.message}`);
    return true;
  });
});
