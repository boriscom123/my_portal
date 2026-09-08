// Состояния публикации меняются из трёх мест: маршрут ставит задачу, шаг очереди
// её ведёт, кнопка «Проверить» дожимает. Держать SQL в каждом значило бы однажды
// забыть стереть прежнюю ошибку — и урок остался бы красным после удачного
// повтора.
import test from 'node:test';
import assert from 'node:assert/strict';
import { saveLesson } from '../src/services/lessons.js';
import {
  startPublication,
  markPublicationState,
  publicationsFor
} from '../src/services/publications.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

test('повтор переписывает строку, а не заводит вторую', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });

    const first = await startPublication(pool, {
      lessonId: lesson.id,
      platform: 'youtube',
      assetId: null,
      mode: 'semi'
    });
    await markPublicationState(pool, first.id, { state: 'failed', error: 'квота кончилась' });

    const second = await startPublication(pool, {
      lessonId: lesson.id,
      platform: 'youtube',
      assetId: null,
      mode: 'semi'
    });

    assert.equal(second.id, first.id, 'строка должна быть та же');
    const [publication] = await publicationsFor(pool, lesson.id);
    assert.equal(publication.state, 'queued');
    assert.equal(publication.error, null, 'прежняя ошибка обязана стереться');
  });
});

test('ссылка и внешний номер сохраняются', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    const { id } = await startPublication(pool, {
      lessonId: lesson.id,
      platform: 'youtube',
      assetId: null,
      mode: 'semi'
    });

    await markPublicationState(pool, id, {
      state: 'ready',
      externalId: 'abc123',
      url: 'https://youtu.be/abc123'
    });

    const [publication] = await publicationsFor(pool, lesson.id);
    assert.equal(publication.state, 'ready');
    assert.equal(publication.externalId, 'abc123');
    assert.equal(publication.url, 'https://youtu.be/abc123');
  });
});

test('смена состояния не теряет уже записанную ссылку', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    const { id } = await startPublication(pool, {
      lessonId: lesson.id,
      platform: 'youtube',
      assetId: null,
      mode: 'semi'
    });
    await markPublicationState(pool, id, {
      state: 'ready',
      externalId: 'abc123',
      url: 'https://youtu.be/abc123'
    });

    // Кнопка «Проверить» знает только новое состояние: ссылку она не носит, и
    // затирать её пустотой нельзя — иначе в карточке пропадёт адрес ролика.
    await markPublicationState(pool, id, { state: 'published' });

    const [publication] = await publicationsFor(pool, lesson.id);
    assert.equal(publication.state, 'published');
    assert.equal(publication.url, 'https://youtu.be/abc123');
    assert.equal(publication.externalId, 'abc123');
  });
});
