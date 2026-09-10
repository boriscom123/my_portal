// Шаг конвейера: анонс урока или новости в канал.
//
// Задача — положить в канал картинку с подписью и запомнить пост, чтобы потом
// его поправить. Один файл на обе площадки: у Telegram и MAX разные запросы, но
// одинаковый смысл — «отправить анонс» и «переписать подпись», — и держать это
// двумя почти одинаковыми шагами значило бы чинить каждую правку дважды.
// Запуск при этом у каждой площадки свой: своя кнопка и своё имя задачи.
// Вызывается воркером по именам JOBS.publishTelegram и JOBS.publishMax.
import { getLessonById } from '../services/lessons.js';
import { getNewsById } from '../services/news.js';
import { assetsOfLesson, assetsOfNews, mediaPath } from '../services/media.js';
import { markPublicationState, publicationsFor } from '../services/publications.js';
import { buildAnnouncement, buildNewsAnnouncement } from '../services/platforms/announcement.js';

/**
 * Собирает пост об уроке: подпись, обложка ссылкой и файлом.
 * Обложка нужна дважды: ссылкой — Telegram забирает её сам; файлом — MAX, он
 * ссылку принимает на словах, а на деле отказывает.
 */
async function lessonPost(config, pool, lessonId, platform) {
  const lesson = await getLessonById(pool, lessonId);
  if (!lesson) throw new Error('Урок не найден');
  if (!lesson.coverUrl) {
    // Пост без картинки в ленте канала теряется среди чужих. Обложка у урока
    // есть всегда, когда автор дошёл до публикации, — а если нет, честнее
    // сказать это, чем отправить пустой анонс.
    throw new Error('У урока нет обложки — возьмите кадр из записи или нарисуйте её');
  }

  const assets = await assetsOfLesson(pool, lessonId);
  const cover = assets.find((asset) => `/media/asset/${asset.id}` === lesson.coverUrl);
  if (!cover) throw new Error('Обложка урока не найдена в буфере — выберите её заново');

  return {
    photoUrl: `${config.publicBaseUrl}${lesson.coverUrl}`,
    filePath: mediaPath(config, cover.path),
    caption: buildAnnouncement({
      lesson,
      publicBaseUrl: config.publicBaseUrl,
      publications: await publicationsFor(pool, lessonId),
      skipPlatform: platform
    })
  };
}

/**
 * Собирает пост о новости.
 * Картинка необязательна, в отличие от урока: короткая заметка без картинки —
 * обычное дело, и отказывать в отправке из-за неё значит заставить автора
 * рисовать иллюстрацию к двум строкам текста.
 */
async function newsPost(config, pool, newsId) {
  const item = await getNewsById(pool, newsId);
  if (!item) throw new Error('Новость не найдена');
  if (item.status !== 'published') {
    // Пост увёл бы подписчиков на страницу, которой для них нет.
    throw new Error('Новость ещё черновик — сначала опубликуйте её');
  }

  const [image] = await assetsOfNews(pool, newsId);
  return {
    photoUrl: image ? `${config.publicBaseUrl}/media/asset/${image.id}` : null,
    filePath: image ? mediaPath(config, image.path) : null,
    caption: buildNewsAnnouncement({ item, publicBaseUrl: config.publicBaseUrl })
  };
}

/**
 * Собирает шаг для одной площадки.
 * adapter — две функции площадки: post и edit. Приходит доводом, а не импортом:
 * так шаг проверяется тестом без сети.
 */
export function makePublishChannel(config, pool, platform, adapter) {
  return async ({ lessonId = null, newsId = null, publicationId }) => {
    // Подготовка внутри try вместе с отправкой: отказ на ней — тоже отказ
    // публикации. Оставь его снаружи — и строка навсегда застрянет в «в
    // очереди»: кнопка отправки при таком состоянии не показывается, и автор
    // остался бы с постом, которого нет, и без способа его отправить.
    try {
      const app = await adapter.app(pool, config, platform);
      if (!app.configured) {
        throw new Error(`Канал ${platform} не настроен — заполните его в настройках`);
      }

      // Урок или новость: отправка у них одна и та же, разное — только то, из
      // чего собирается пост. Развести это по двум шагам значило бы чинить
      // каждую правку отправки дважды.
      const post = newsId
        ? await newsPost(config, pool, newsId)
        : await lessonPost(config, pool, lessonId, platform);

      await markPublicationState(pool, publicationId, { state: 'uploading' });

      const { messageId, url } = await adapter.post({
        token: app.token,
        channel: app.channel,
        ...post
      });
      await markPublicationState(pool, publicationId, {
        // Пост в канале виден сразу: приватного состояния у него нет.
        state: 'published',
        externalId: messageId,
        // У поста в MAX своего адреса нет — площадка его не выдаёт. Тогда ведём
        // на канал: это не точное место, но единственное честное.
        url: url ?? app.link ?? null
      });
      return { messageId };
    } catch (error) {
      await markPublicationState(pool, publicationId, {
        state: 'failed',
        error: error.message.slice(0, 500)
      });
      throw error;
    }
  };
}

/**
 * Шаг обновления постов: ролик где-то вышел — дописываем ссылку в каналы.
 *
 * Правкой, а не новым постом: подписчики не должны получать второе уведомление
 * об одном уроке только потому, что у нас появилась ещё одна ссылка.
 * Отказ одной площадки не мешает другой: посты независимы.
 * Вызывается воркером по имени JOBS.refreshChannels.
 */
export function makeRefreshChannels(config, pool, adapters) {
  return async ({ lessonId }) => {
    const lesson = await getLessonById(pool, lessonId);
    if (!lesson?.coverUrl) return { updated: 0 };

    const assets = await assetsOfLesson(pool, lessonId);
    const cover = assets.find((asset) => `/media/asset/${asset.id}` === lesson.coverUrl);
    if (!cover) return { updated: 0 };

    const publications = await publicationsFor(pool, lessonId);
    let updated = 0;

    for (const publication of publications) {
      const adapter = adapters[publication.platform];
      if (!adapter || publication.state !== 'published' || !publication.externalId) continue;

      const app = await adapter.app(pool, config, publication.platform);
      if (!app.configured) continue;

      const caption = buildAnnouncement({
        lesson,
        publicBaseUrl: config.publicBaseUrl,
        publications,
        skipPlatform: publication.platform
      });

      try {
        await adapter.edit({
          token: app.token,
          channel: app.channel,
          messageId: publication.externalId,
          photoUrl: `${config.publicBaseUrl}${lesson.coverUrl}`,
          filePath: mediaPath(config, cover.path),
          caption
        });
        updated += 1;
      } catch (error) {
        // Пост в канале уже стоит и урок не ломает: неудачную правку пишем
        // рядом с ним, а остальные каналы правим дальше.
        await markPublicationState(pool, publication.id, {
          state: 'published',
          error: `подпись не обновилась: ${error.message}`.slice(0, 500)
        });
      }
    }
    return { updated };
  };
}
