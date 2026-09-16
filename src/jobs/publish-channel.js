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
import { getShortById } from '../services/shorts.js';
import { assetsOfLesson, assetsOfNews, assetById, mediaPath } from '../services/media.js';
import {
  markPublicationState,
  publicationsFor,
  publicationById
} from '../services/publications.js';
import { buildAnnouncement, buildNewsAnnouncement } from '../services/platforms/announcement.js';
import { addJob, JOBS } from '../queue.js';
import { cutLessonStart, channelPartLimit } from '../services/lesson-start.js';
import { access } from 'node:fs/promises';

/**
 * Собирает пост об уроке: подпись, обложка ссылкой и файлом.
 * Обложка нужна дважды: ссылкой — Telegram забирает её сам; файлом — MAX, он
 * ссылку принимает на словах, а на деле отказывает.
 */
async function lessonPost(config, pool, lessonId, platform, deps = {}) {
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

  // Начало урока едет в самом анонсе: заказчик 2026-09-16 просил один пост —
  // обложка и видео вместе. Записи ещё нет — анонс уходит одной обложкой, как
  // раньше: отказываться от анонса из-за отсутствующего видео незачем.
  let start = null;
  try {
    start = await cutLessonStart(
      config,
      pool,
      { lesson, limitBytes: channelPartLimit(platform, config.telegram?.apiUrl), platform },
      deps
    );
  } catch (error) {
    console.error(`Анонс ${platform} уходит без видео:`, error.message);
  }

  return {
    photoUrl: `${config.publicBaseUrl}${lesson.coverUrl}`,
    filePath: mediaPath(config, cover.path),
    ...(start
      ? {
          // Telegram кладёт видео в альбом, MAX — вторым вложением: каждой
          // площадке своё имя довода, файл один и тот же.
          video: {
            path: start.path,
            width: start.width,
            height: start.height,
            duration: start.duration
          },
          videoPath: start.path
        }
      : {}),
    caption: buildAnnouncement({
      lesson,
      publicBaseUrl: config.publicBaseUrl,
      publications: await publicationsFor(pool, lessonId),
      skipPlatform: platform,
      lead: start && !start.whole ? 'Начало урока.' : '',
      // Запись целиком в посте — звать за полной записью некуда.
      noVideo: Boolean(start?.whole)
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

// Сколько весит файл, который площадка возьмёт от бота. У Telegram это её
// собственный предел, у MAX — свой, больший. Проверяем до отправки: ответ на
// превышение приходит после того, как файл уже уехал по сети, а на мобильном
// исходящем канале это минуты впустую.
const VIDEO_LIMITS = { telegram: 50 * 1024 * 1024, max: 250 * 1024 * 1024 };

/**
 * Собирает пост о вертикальном ролике.
 * Ролик уходит файлом, а не ссылкой: подписчик смотрит его в ленте канала, а не
 * уходит на сайт.
 */
async function shortPost(config, pool, shortId, platform) {
  const short = await getShortById(pool, shortId);
  if (!short) throw new Error('Ролик не найден');
  if (short.status !== 'published') {
    throw new Error('Ролик ещё черновик — сначала опубликуйте его');
  }
  if (!short.assetId) throw new Error('У ролика нет файла — загрузите его');

  const asset = await assetById(pool, short.assetId);
  if (!asset) throw new Error('Файл ролика не найден в буфере — загрузите его заново');

  const limit = VIDEO_LIMITS[platform];
  if (limit && asset.bytes > limit) {
    const mb = (bytes) => Math.round(bytes / (1024 * 1024));
    throw new Error(
      `Ролик весит ${mb(asset.bytes)} МБ, а ${platform} берёт от бота не больше ${mb(limit)} МБ`
    );
  }

  const links = [`${config.publicBaseUrl}/short/${short.slug}`];
  // Ссылка на полный урок — то, ради чего короткий ролик и режется. У снятого
  // отдельно её нет, и придумывать нечего.
  if (short.lesson) links.push(`Урок целиком: ${config.publicBaseUrl}/lesson/${short.lesson.slug}`);

  return {
    // Ролик уходит отдельным способом площадки: это пост-видео, а не альбом.
    asVideo: true,
    filePath: mediaPath(config, asset.path),
    caption: buildNewsAnnouncement({
      item: { slug: short.slug, title: short.title, body: short.description },
      publicBaseUrl: config.publicBaseUrl,
      // Подпись собирается тем же сборщиком, что у новости, но хвост свой:
      // ссылок здесь две, и вторая важнее описания.
      tail: links.join('\n')
    })
  };
}

/**
 * Собирает шаг для одной площадки.
 * adapter — две функции площадки: post и edit. Приходит доводом, а не импортом:
 * так шаг проверяется тестом без сети.
 */
export function makePublishChannel(config, pool, platform, adapter, queue = null, deps = {}) {
  return async ({ lessonId = null, newsId = null, shortId = null, publicationId }) => {
    // Подготовка внутри try вместе с отправкой: отказ на ней — тоже отказ
    // публикации. Оставь его снаружи — и строка навсегда застрянет в «в
    // очереди»: кнопка отправки при таком состоянии не показывается, и автор
    // остался бы с постом, которого нет, и без способа его отправить.
    try {
      const app = await adapter.app(pool, config, platform);
      if (!app.configured) {
        throw new Error(`Канал ${platform} не настроен — заполните его в настройках`);
      }

      // Урок, новость или ролик: отправка у них одна и та же, разное — только
      // то, из чего собирается пост. Развести это по трём шагам значило бы
      // чинить каждую правку отправки трижды.
      const post = shortId
        ? await shortPost(config, pool, shortId, platform)
        : newsId
          ? await newsPost(config, pool, newsId)
          : await lessonPost(config, pool, lessonId, platform, deps);

      await markPublicationState(pool, publicationId, { state: 'uploading' });

      const { asVideo, ...payload } = post;
      const send = asVideo ? adapter.postVideo : adapter.post;
      const { messageId, url } = await send({
        token: app.token,
        channel: app.channel,
        ...payload
      });
      await markPublicationState(pool, publicationId, {
        // Пост в канале виден сразу: приватного состояния у него нет.
        state: 'published',
        externalId: messageId,
        // У поста в MAX своего адреса нет — площадка его не выдаёт. Тогда ведём
        // на канал: это не точное место, но единственное честное.
        url: url ?? app.link ?? null
      });
      // Посты, отправленные раньше, собирались без этой ссылки: пост в Telegram
      // не знал про MAX, вышедший следом. Дописываем её правкой — заказчик
      // 2026-09-16 увидел ровно это. Задача чинит и сам этот пост: соседние
      // ссылки в нём уже стоят, правка их не меняет.
      if (queue && lessonId) await addJob(queue, JOBS.refreshChannels, { lessonId });
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
 * Шаг правки поста о новости: автор поправил текст — переписываем пост.
 *
 * Правкой, а не новым постом: подписчики уже получили уведомление об этой
 * новости, и второе за исправленную опечатку — это спам.
 * Картинку правка не трогает у Telegram: заменить её в готовом посте площадка
 * не даёт. MAX кладёт вложение заново, так устроена его правка.
 * Вызывается воркером по имени JOBS.refreshPost.
 */
export function makeRefreshPost(config, pool, adapters) {
  return async ({ newsId, publicationId }) => {
    const publication = await publicationById(pool, publicationId);
    if (!publication) throw new Error('Пост не найден');
    if (!publication.externalId) {
      // Номера поста нет — значит, править нечего: пост не отправлялся или
      // площадка его номер не вернула.
      throw new Error('Портал не знает номера этого поста — отправьте его заново');
    }

    const adapter = adapters[publication.platform];
    if (!adapter) throw new Error(`Площадка ${publication.platform} не подключена`);

    const app = await adapter.app(pool, config, publication.platform);
    if (!app.configured) {
      throw new Error(`Канал ${publication.platform} не настроен — заполните его в настройках`);
    }

    const post = await newsPost(config, pool, newsId);

    try {
      await adapter.edit({
        token: app.token,
        channel: app.channel,
        messageId: publication.externalId,
        ...post
      });
      // Пост в канале как стоял, так и стоит: состояние прежнее, прежняя
      // причина отказа стирается.
      await markPublicationState(pool, publicationId, { state: 'published' });
      return { updated: 1 };
    } catch (error) {
      // Failed здесь означало бы «пост не уехал» — а он стоит в канале, и
      // кнопка отправки после такого предложила бы отправить его второй раз.
      await markPublicationState(pool, publicationId, {
        state: 'published',
        error: `пост не обновился: ${error.message}`.slice(0, 400)
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

      // Начало урока, уехавшее в этот канал. Есть оно — пост альбомный, и
      // подпись обязана и дальше говорить «Начало урока»: правка перепишет её
      // целиком. Записи о куске нет — пост был одной обложкой.
      const part = assets.find(
        (asset) => asset.kind === 'part' && asset.path.endsWith(`start-${publication.platform}.mp4`)
      );
      let videoPath = null;
      if (part) {
        videoPath = mediaPath(config, part.path);
        try {
          await access(videoPath);
        } catch {
          // Кусок вышел по сроку. У MAX правка заново прикладывает вложения —
          // без файла она сняла бы видео с поста. Пост дороже свежей подписи.
          if (publication.platform === 'max') continue;
          videoPath = null;
        }
      }

      const caption = buildAnnouncement({
        lesson,
        publicBaseUrl: config.publicBaseUrl,
        publications,
        skipPlatform: publication.platform,
        lead: part ? 'Начало урока.' : ''
      });

      try {
        await adapter.edit({
          token: app.token,
          channel: app.channel,
          messageId: publication.externalId,
          photoUrl: `${config.publicBaseUrl}${lesson.coverUrl}`,
          filePath: mediaPath(config, cover.path),
          // Telegram правит одну подпись и вложений не трогает; MAX прикладывает
          // их заново, поэтому видео идёт вместе с правкой.
          ...(videoPath && publication.platform === 'max' ? { videoPath } : {}),
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
