// Номер файла в Telegram живёт на записи урока.
//
// Заказчик 2026-09-16: полное видео должно приходить зрителю в мессенджер.
// Загрузка большого файла долгая, поэтому делается один раз, а площадка потом
// отдаёт его по file_id мгновенно — этот номер и запоминаем.
import test from 'node:test';
import assert from 'node:assert/strict';
import { saveLesson } from '../src/services/lessons.js';
import { registerAsset, assetById, assetsOfLesson } from '../src/services/media.js';
import { rememberTelegramFile, telegramFileOfLesson } from '../src/services/telegram-files.js';
import { withTestDb, skipWithoutDb } from './helpers/db.js';

const config = { publicBaseUrl: 'https://p.example', media: { dir: '/tmp', ttlHours: 168 } };

async function seed(pool) {
  const lesson = await saveLesson(pool, { slug: 'urok', title: 'Урок' });
  const asset = await registerAsset(pool, config, {
    lessonId: lesson.id,
    kind: 'source',
    relativePath: `lesson-${lesson.id}/source.mp4`,
    bytes: 250 * 1024 * 1024
  });
  return { lesson, asset };
}

test('номер файла запоминается на записи и читается вместе с ней', skipWithoutDb, async () => {
  await withTestDb(async (pool) => {
    const { lesson, asset } = await seed(pool);

    // Пока не загружали — номера нет, и ссылку зрителю показывать не из чего.
    assert.equal((await assetById(pool, asset.id)).telegramFileId, null);
    assert.equal(await telegramFileOfLesson(pool, lesson.id), null);

    await rememberTelegramFile(pool, asset.id, 'BAACAgIAAxkBAAI');

    assert.equal((await assetById(pool, asset.id)).telegramFileId, 'BAACAgIAAxkBAAI');
    const [stored] = await assetsOfLesson(pool, lesson.id);
    assert.equal(stored.telegramFileId, 'BAACAgIAAxkBAAI');
    assert.equal(await telegramFileOfLesson(pool, lesson.id), 'BAACAgIAAxkBAAI');
  });
});

test('запись заменили — номер прежнего файла не выдаётся за новый', skipWithoutDb, async () => {
  // Иначе зритель получил бы старую запись под именем новой.
  await withTestDb(async (pool) => {
    const { lesson, asset } = await seed(pool);
    await rememberTelegramFile(pool, asset.id, 'FILE-1');

    const smontirovannaya = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'trimmed',
      relativePath: `lesson-${lesson.id}/trimmed.mp4`,
      bytes: 120 * 1024 * 1024
    });

    // Уезжает смонтированная — у неё своего номера ещё нет.
    assert.equal(await telegramFileOfLesson(pool, lesson.id), null);
    await rememberTelegramFile(pool, smontirovannaya.id, 'FILE-2');
    assert.equal(await telegramFileOfLesson(pool, lesson.id), 'FILE-2');
  });
});
