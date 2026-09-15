// Экран урока идёт по ходу работы над ним. Заказчик 2026-09-15: запись,
// обработка звука, расшифровка, что видит зритель (заполняется из
// расшифровки), обложка и последним — публикация отдельным блоком вместе с
// удалением урока.
import test from 'node:test';
import assert from 'node:assert/strict';
import { adminReviewPage } from '../src/views/admin-review.js';

function section(html, title) {
  const from = html.indexOf(`<h2>${title}</h2>`);
  return html.slice(from, html.indexOf('</section>', from));
}

test('блоки экрана урока идут по ходу работы, публикация — последним шагом', () => {
  const html = adminReviewPage({
    config: { youtube: { clientId: 'id' } },
    user: { role: 'admin' },
    lesson: { slug: 'urok', title: 'Урок', description: '', tags: [], settings: {}, status: 'draft' },
    assets: [],
    transcript: null,
    links: { subtitles: [], clips: [] },
    platforms: [],
    publications: []
  });

  const titles = ['Запись', 'Обработка звука', 'Расшифровка', 'Что видит зритель', 'Обложка', 'Публикация'];
  const places = titles.map((title) => html.indexOf(`<h2>${title}</h2>`));
  titles.forEach((title, i) => assert.ok(places[i] >= 0, `нет блока «${title}»`));
  for (let i = 1; i < titles.length; i += 1) {
    assert.ok(places[i - 1] < places[i], `«${titles[i - 1]}» должен идти раньше «${titles[i]}»`);
  }

  // Кнопка стоит вне формы, но отправляет её: поля берутся те же.
  const publish = section(html, 'Публикация');
  assert.match(publish, /<button[^>]*form="review-form"[^>]*value="yes"[^>]*>Опубликовать/);
  assert.match(publish, /data-lesson-delete="urok"/);

  const viewer = section(html, 'Что видит зритель');
  assert.match(viewer, /Сохранить черновик/);
  assert.doesNotMatch(viewer, /Опубликовать|data-lesson-delete/);
});
