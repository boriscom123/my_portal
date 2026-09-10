// Шаг конвейера: ролик в Instagram Reels.
//
// Задача — довести вертикальный ролик до площадки и дождаться, пока она его
// обработает. Ожидание здесь не наша прихоть: площадка забирает файл по ссылке
// сама и обрабатывает его у себя, а публиковать можно только готовый контейнер.
// Вызывается воркером по имени JOBS.publishInstagram.
import { getShortById } from '../services/shorts.js';
import { assetById } from '../services/media.js';
import { mediaLink } from '../lib/media-token.js';
import { markPublicationState } from '../services/publications.js';

// Как долго ждём обработки. Площадка советует спрашивать раз в минуту не
// дольше пяти: дольше — это уже не «обрабатывается», а молчание, и лучше
// сказать об этом человеку, чем держать задачу вечно.
const POLL_EVERY_MS = 20_000;
const POLL_LIMIT_MS = 5 * 60_000;

// Сколько живёт ссылка, по которой площадка забирает файл. Час: столько же
// живёт и её собственный контейнер, а короче — риск, что она не успеет.
const LINK_SECONDS = 3600;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Собирает шаг.
 * api — четыре функции площадки. Приходят доводом, а не импортом: так шаг
 * проверяется тестом без сети.
 */
export function makePublishInstagram(config, pool, api) {
  return async ({ shortId, publicationId }) => {
    try {
      const access = await api.access(pool, config);
      if (!access?.token) {
        throw new Error('Аккаунт Instagram не подключён — подключите его в настройках');
      }

      const short = await getShortById(pool, shortId);
      if (!short) throw new Error('Ролик не найден');
      if (short.status !== 'published') {
        // Площадка придёт за файлом по ссылке, а у черновика файл закрыт.
        throw new Error('Ролик ещё черновик — сначала опубликуйте его');
      }
      if (!short.assetId) throw new Error('У ролика нет файла — загрузите его');

      const asset = await assetById(pool, short.assetId);
      if (!asset) throw new Error('Файл ролика не найден в буфере — загрузите его заново');

      await markPublicationState(pool, publicationId, { state: 'uploading' });

      const caption = [short.title, short.description]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 2200);

      const containerId = await api.createContainer({
        token: access.token,
        userId: access.userId,
        // Ссылка подписанная и временная: открывать буфер целиком ради одной
        // площадки нельзя.
        videoUrl: mediaLink(config, asset.id, LINK_SECONDS),
        caption
      });

      // Ждём, пока площадка заберёт файл и обработает его. Спрашиваем сразу, а
      // потом уже ждём: короткий ролик она успевает обработать за секунды, и
      // спать перед первым вопросом значит добавлять полминуты каждой выкладке
      // на ровном месте.
      const until = Date.now() + POLL_LIMIT_MS;
      let status = await api.status({ token: access.token, containerId });
      while (status.code === 'IN_PROGRESS' && Date.now() < until) {
        await sleep(POLL_EVERY_MS);
        status = await api.status({ token: access.token, containerId });
      }
      if (status.code !== 'FINISHED') {
        throw new Error(
          status.code === 'IN_PROGRESS'
            ? 'Instagram не успел обработать ролик за пять минут — попробуйте отправить заново'
            : `Instagram не принял ролик (${status.code}): ${status.detail || 'без объяснения'}`
        );
      }

      const mediaId = await api.publish({
        token: access.token,
        userId: access.userId,
        containerId
      });
      const url = await api.permalink({ token: access.token, mediaId });

      await markPublicationState(pool, publicationId, {
        state: 'published',
        externalId: mediaId,
        url
      });
      return { mediaId };
    } catch (error) {
      await markPublicationState(pool, publicationId, {
        state: 'failed',
        error: error.message.slice(0, 500)
      });
      throw error;
    }
  };
}
