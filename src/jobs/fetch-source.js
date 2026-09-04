// Шаг конвейера: забрать исходник с Яндекс Диска.
//
// Задача — положить файл в рабочий буфер и запустить обработку. Зачем
// отдельным шагом, а не прямо в маршруте: скачивание гигабайтного файла идёт
// минутами, а HTTP-запрос столько не живёт — человек закрыл бы вкладку и не
// узнал, чем кончилось.
// Вызывается воркером по имени JOBS.fetchSource.
import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { mediaPath, registerAsset } from '../services/media.js';
import { loadIntegration, diskDownloadUrl } from '../services/disk.js';
import { addJob } from '../queue.js';

/**
 * Обеззараживает имя файла, пришедшее с чужого сервиса.
 * Полагаться на добропорядочность чужого имени нельзя: «../../» увело бы
 * запись за пределы буфера. Расширение сохраняем — по нему ffmpeg понимает
 * формат без лишних догадок.
 * Вызывается только отсюда.
 */
function safeFileName(diskPath) {
  const base = path.basename(String(diskPath));
  const clean = base.replace(/[^\w.-]+/g, '_').replace(/^\.+/, '').slice(-80);
  return clean || 'source.mp4';
}

export function makeFetchSource(config, pool, queue, fetchImpl = fetch) {
  return async ({ lessonId, diskPath }) => {
    const integration = await loadIntegration(pool, config, 'yandex-disk');
    if (!integration) throw new Error('Яндекс Диск не подключён');

    // Ссылку берём перед самой закачкой: она живёт недолго, и взятая заранее
    // успела бы протухнуть, пока очередь дойдёт до этой задачи.
    const href = await diskDownloadUrl(integration.token, diskPath, fetchImpl);
    const response = await fetchImpl(href);
    if (!response.ok) throw new Error(`Файл не скачался: ${response.status}`);

    const dir = `lesson-${lessonId}`;
    await mkdir(mediaPath(config, dir), { recursive: true });
    const relative = `${dir}/${safeFileName(diskPath)}`;

    // Потоком: гигабайтный файл в память не помещается, а её здесь полтора
    // гигабайта на всю машину вместе с порталом и соседними проектами.
    await pipeline(Readable.fromWeb(response.body), createWriteStream(mediaPath(config, relative)));

    const { size } = await stat(mediaPath(config, relative));
    const asset = await registerAsset(pool, config, {
      lessonId,
      kind: 'source',
      relativePath: relative,
      bytes: size
    });
    await pool.query(
      `UPDATE lessons SET source_asset_id = $1, pipeline_state = 'processing', pipeline_error = NULL
        WHERE id = $2`,
      [asset.id, lessonId]
    );

    await addJob(queue, 'extractAudio', { lessonId });
    return { bytes: size };
  };
}
