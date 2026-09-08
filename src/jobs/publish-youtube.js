// Шаг конвейера: выкладка урока на YouTube.
//
// Задача — связать выбор файлов, обмен токенами и запросы к площадке, ведя
// состояние публикации. Зачем шагом очереди, а не в запросе: файл — сотни
// мегабайт, заливка идёт минутами, а HTTP-запрос столько не живёт.
//
// Площадка приходит зависимостью, а не импортом: так шаг проверяется тестом без
// сети, и так же в него однажды встанет вторая площадка.
// Вызывается воркером по имени JOBS.publishYoutube.
import { assetsOfLesson, mediaPath } from '../services/media.js';
import { getLessonById } from '../services/lessons.js';
import { readSettings } from '../lib/settings.js';
import { markPublicationState } from '../services/publications.js';
import {
  pickVideoAsset,
  pickSubtitlesAsset,
  buildVideoBody
} from '../services/platforms/youtube-fields.js';

// Предел площадки — 2 МБ. Порог ниже предела: обложка ровно на границе уже
// встречалась, и гадать, считает YouTube мегабайт как 1 000 000 или 1 048 576,
// мы не будем.
const THUMBNAIL_LIMIT_BYTES = 1_900_000;

export function makePublishYoutube(config, pool, platform) {
  return async ({ lessonId, publicationId }) => {
    const token = await platform.accessToken(pool, config);
    if (!token) {
      throw new Error('Канал YouTube не подключён — подключите его на странице загрузки');
    }

    const lesson = await getLessonById(pool, lessonId);
    if (!lesson) throw new Error('Урок не найден');

    const assets = await assetsOfLesson(pool, lessonId);
    const video = pickVideoAsset(assets);
    if (!video) throw new Error('Записи нет в буфере — загрузите её заново');

    const settings = readSettings(lesson.settings);
    const subtitles = pickSubtitlesAsset(assets, video, settings);

    await markPublicationState(pool, publicationId, { state: 'uploading' });

    // Приватность решает режим: до аудита Google публичным ролик не сделать, и
    // просить об этом бессмысленно — площадка молча оставит приватным.
    const privacy = config.youtube.mode === 'auto' ? 'public' : 'private';
    const body = buildVideoBody({ lesson, publicBaseUrl: config.publicBaseUrl, privacy });

    let videoId;
    try {
      const sessionUrl = await platform.startUploadSession({
        token,
        body,
        fileBytes: video.bytes
      });
      ({ videoId } = await platform.uploadVideoFile({
        sessionUrl,
        filePath: mediaPath(config, video.path),
        fileBytes: video.bytes
      }));
    } catch (error) {
      await markPublicationState(pool, publicationId, {
        state: 'failed',
        error: error.message.slice(0, 500)
      });
      throw error;
    }

    // Ролик на канале. Дальше необязательное: его отказ — повод сказать, а не
    // объявить выкладку провалившейся.
    const complaints = [];

    if (subtitles) {
      try {
        await platform.insertCaptions({
          token,
          videoId,
          filePath: mediaPath(config, subtitles.path)
        });
      } catch (error) {
        complaints.push(`субтитры не встали: ${error.message}`);
      }
    }

    const cover = assets.find((asset) => `/media/asset/${asset.id}` === lesson.coverUrl);
    if (cover) {
      try {
        const original = mediaPath(config, cover.path);
        const ready =
          cover.bytes > THUMBNAIL_LIMIT_BYTES
            ? await platform.shrinkThumbnail(original)
            : original;
        await platform.setThumbnail({ token, videoId, filePath: ready });
      } catch (error) {
        complaints.push(`обложка не встала: ${error.message}`);
      }
    }

    await markPublicationState(pool, publicationId, {
      // auto ставится только после аудита Google; до него ролик приватный, и
      // published означало бы ссылку в никуда на карточке урока.
      state: config.youtube.mode === 'auto' ? 'published' : 'ready',
      externalId: videoId,
      url: `https://youtu.be/${videoId}`,
      error: complaints.length ? complaints.join('; ').slice(0, 500) : null
    });

    return { videoId, complaints: complaints.length };
  };
}
