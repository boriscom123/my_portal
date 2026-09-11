// Публикации частей видео: своя «площадка» рядом с анонсом и ход отправки
// постами подряд — чтобы повтор продолжал, а не дублировал.
import test from 'node:test';
import assert from 'node:assert/strict';
import { saveLesson } from '../src/services/lessons.js';
import {
  startPublication,
  publicationById,
  markPublicationDetails
} from '../src/services/publications.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

test('части видео — отдельная публикация рядом с анонсом', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    const announcement = await startPublication(pool, {
      lessonId: lesson.id,
      platform: 'telegram',
      mode: 'auto'
    });
    const parts = await startPublication(pool, {
      lessonId: lesson.id,
      platform: 'telegram_parts',
      mode: 'auto'
    });
    const maxParts = await startPublication(pool, {
      lessonId: lesson.id,
      platform: 'max_parts',
      mode: 'auto'
    });
    assert.notEqual(parts.id, announcement.id);
    assert.equal((await publicationById(pool, maxParts.id)).platform, 'max_parts');
  });
});

test('ход отправки запоминается, у новой публикации он пуст', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    const { id } = await startPublication(pool, {
      lessonId: lesson.id,
      platform: 'max_parts',
      mode: 'auto'
    });
    assert.deepEqual((await publicationById(pool, id)).details, {});
    await markPublicationDetails(pool, id, { sent: ['mid.1', 'mid.2'] });
    assert.deepEqual((await publicationById(pool, id)).details, { sent: ['mid.1', 'mid.2'] });
  });
});

test('незнакомая площадка по-прежнему не проходит', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
    await assert.rejects(
      startPublication(pool, { lessonId: lesson.id, platform: 'myspace', mode: 'auto' }),
      /publications_platform_check/
    );
  });
});
