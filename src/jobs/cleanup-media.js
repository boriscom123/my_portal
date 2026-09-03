// Шаг конвейера: уборка буфера.
//
// Задача — удалять файлы, переживших свой срок. Это и есть то, чем портал
// отличается от видеоархива: спека прямо запрещает хранить архив, а на диске
// сервера 34 ГБ на все проекты — десяток неубранных исходников положит не
// только портал, но и соседей.
// Карточка урока при этом остаётся: исчезают файлы, а не уроки.
// Вызывается воркером по расписанию, раз в час.
import { rm } from 'node:fs/promises';
import { mediaPath, listExpired, forgetAsset } from '../services/media.js';

export function makeCleanupMedia(config, pool) {
  return async () => {
    const expired = await listExpired(pool);
    let removed = 0;
    let bytes = 0;

    for (const asset of expired) {
      try {
        // force: true — файла может уже не быть (том пересоздали, удалили
        // руками). Запись в учёте всё равно должна уйти, иначе уборка будет
        // спотыкаться о неё вечно.
        await rm(mediaPath(config, asset.path), { force: true });
      } catch (error) {
        // Один нечитаемый путь не должен останавливать уборку остальных:
        // иначе один сломанный файл однажды переполнит диск.
        console.error(`Не удалось удалить ${asset.path}: ${error.message}`);
        continue;
      }

      // Обложка — единственный файл буфера со ссылкой на карточке урока.
      // Удалить файл и оставить ссылку значит показать всем битую картинку и
      // отправить в мессенджеры превью без изображения.
      if (asset.kind === 'cover') {
        await pool.query('UPDATE lessons SET cover_url = NULL WHERE cover_url = $1', [
          `/media/asset/${asset.id}`
        ]);
      }

      await forgetAsset(pool, asset.id);
      removed += 1;
      bytes += asset.bytes ?? 0;
    }

    if (removed) {
      console.log(`Уборка буфера: удалено файлов — ${removed}, освобождено ${bytes} байт`);
    }
    return { removed, bytes };
  };
}
