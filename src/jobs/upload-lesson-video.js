// Шаг очереди: запись урока — в Telegram, автору в личку.
//
// Задача — сделать долгую загрузку один раз. Площадка возвращает номер файла и
// хранит его у себя: дальше бот пересылает то же видео любому зрителю одним
// запросом. Зачем очередью: запись весит сотни мегабайт, загрузка идёт минуты,
// а запрос через nginx рвётся на шестидесяти секундах.
//
// Автору в личку, а не в канал: это рабочая загрузка, а не пост. Заодно видно,
// что уехало, и файл остаётся под рукой.
// Вызывается воркером по имени JOBS.uploadLessonVideo.
import { access } from 'node:fs/promises';
import { getLessonById } from '../services/lessons.js';
import { assetsOfLesson, mediaPath } from '../services/media.js';
import { pickVideoAsset } from '../services/platforms/youtube-fields.js';
import { postVideoToTelegram } from '../services/platforms/telegram-channel.js';
import { rememberTelegramFile } from '../services/telegram-files.js';

const GONE = 'Записи урока нет в буфере — вероятно, она удалена по сроку; загрузите её заново';

/** Личка автора: тот же способ, которым портал шлёт ему уведомления. */
async function authorChat(pool) {
  const { rows } = await pool.query(
    `SELECT i.external_id FROM identities i
       JOIN users u ON u.id = i.user_id
      WHERE u.role = 'admin' AND i.provider IN ('tg_widget', 'tg_miniapp')
      ORDER BY i.id LIMIT 1`
  );
  if (!rows.length) {
    throw new Error(
      'Автор не привязал Telegram: войдите на портал через Telegram, и видео будет приходить вам в личку'
    );
  }
  return String(rows[0].external_id);
}

export function makeUploadLessonVideo(config, pool, { sendVideo = postVideoToTelegram } = {}) {
  return async ({ lessonId }) => {
    const lesson = await getLessonById(pool, lessonId);
    if (!lesson) throw new Error('Урок не найден');

    const video = pickVideoAsset(await assetsOfLesson(pool, lessonId));
    if (!video) throw new Error(GONE);
    const filePath = mediaPath(config, video.path);
    try {
      await access(filePath);
    } catch {
      throw new Error(GONE);
    }

    const chatId = await authorChat(pool);
    const { messageId, fileId } = await sendVideo({
      apiUrl: config.telegram?.apiUrl,
      token: config.telegram?.botToken,
      channel: chatId,
      filePath,
      caption: `${lesson.title}\n\n${config.publicBaseUrl}/lesson/${lesson.slug}`
    });

    if (!fileId) {
      // Без номера файла загрузка бессмысленна: переслать видео зрителю будет
      // нечем, и честнее сказать это сразу.
      throw new Error('Telegram принял видео, но не дал его номер — попробуйте ещё раз');
    }
    await rememberTelegramFile(pool, video.id, fileId);
    return { messageId, fileId };
  };
}
