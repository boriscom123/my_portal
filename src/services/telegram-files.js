// Номера файлов, уже загруженных в Telegram.
//
// Задача — помнить, что запись урока однажды уехала в Telegram, и отдавать её
// номер. Площадка хранит принятый файл у себя: по file_id то же видео уходит
// следующему человеку одним запросом, без траты трафика и без ожидания.
// Поэтому долгая загрузка делается один раз, кнопкой автора.
//
// Номер живёт на записи, а не на уроке: записей у урока бывает две — исходная
// и смонтированная, — и номер одной выдавать за другую нельзя.
// Вызывается из src/jobs/upload-lesson-video.js и маршрутов бота.
import { assetsOfLesson } from './media.js';
import { pickVideoAsset } from './platforms/youtube-fields.js';

/** Запоминает номер файла на записи. */
export async function rememberTelegramFile(pool, assetId, fileId) {
  await pool.query('UPDATE assets SET telegram_file_id = $2 WHERE id = $1', [assetId, fileId]);
}

/**
 * Номер файла записи, которая уезжает у этого урока. null — не загружали.
 *
 * Запись выбирается так же, как для площадок: смонтированная важнее исходной.
 * Заменили запись — номер прежней не подставляется: зритель получил бы старое
 * видео под именем нового.
 */
export async function telegramFileOfLesson(pool, lessonId) {
  const video = pickVideoAsset(await assetsOfLesson(pool, lessonId));
  return video?.telegramFileId ?? null;
}
