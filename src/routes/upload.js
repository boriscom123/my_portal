// Загрузка исходника кусками.
//
// Задача — принять гигабайтный файл так, чтобы обрыв связи не начинал всё
// заново. Куски пишутся по отдельности, а на завершении склеиваются в один
// файл. Зачем не одним запросом: на часовом ролике потеря связи почти
// гарантирована, а повтор с нуля — час впустую.
//
// Зачем свой велосипед вместо готовой библиотеки: протокол здесь — три
// маршрута и счётчик принятых кусков, а любая библиотека тянет своё
// хранилище, свои сессии и свои представления о путях на диске.
// Подключается в src/app.js по префиксу /api/upload.
import { Router } from 'express';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, writeFile, rm, stat, open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { requireAdmin } from '../middleware/guards.js';
import { PublicError } from '../middleware/errors.js';
import { mediaPath, registerAsset } from '../services/media.js';
import { imageTypeOf } from '../lib/image-type.js';
import { getLessonBySlug } from '../services/lessons.js';
import { addJob } from '../queue.js';

// Размер куска. Восемь мегабайт: меньше — слишком много запросов на часовой
// ролик, больше — обрыв стоит дороже, а память расходуется зря.
const CHUNK_SIZE = 8 * 1024 * 1024;

// Предел для обложки. Десять мегабайт с запасом покрывают любую разумную
// картинку; больше — это уже не обложка, а чей-то способ занять диск.
const COVER_LIMIT = 10 * 1024 * 1024;

/**
 * Приводит имя файла к безопасному виду.
 * Имя приходит из браузера и попадает в путь на диске: без обеззараживания
 * «../../» увёл бы запись куда угодно. Расширение сохраняем — по нему ffmpeg
 * понимает формат без лишних догадок.
 * Вызывается из обработчика init.
 */
export function safeName(raw) {
  const base = path.basename(String(raw ?? 'source'));
  const clean = base.replace(/[^\w.-]+/g, '_').replace(/^\.+/, '').slice(-80);
  return clean || 'source';
}

/**
 * Номера уже принятых кусков, по возрастанию.
 * Нужны дважды: клиенту — чтобы продолжить с места обрыва, и склейке — чтобы
 * собрать файл в правильном порядке, даже если куски пришли вразнобой.
 */
async function receivedChunks(config, uploadId) {
  try {
    const names = await readdir(mediaPath(config, `uploads/${uploadId}`));
    return names
      .filter((name) => name.endsWith('.part'))
      .map((name) => Number(name.replace('.part', '')))
      .filter(Number.isInteger)
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

export function uploadRoutes(config, pool) {
  const router = Router();

  // Все маршруты загрузки только для автора портала: исходники грузит он один.
  router.use(requireAdmin);

  router.post('/init', async (req, res) => {
    const { lessonId, fileName, bytes } = req.body ?? {};
    if (!lessonId || !bytes) throw new PublicError('Не указан урок или размер файла');

    const uploadId = randomUUID();
    const name = safeName(fileName);
    await mkdir(mediaPath(config, `uploads/${uploadId}`), { recursive: true });
    // Имя файла и урок держим рядом с кусками: перезапуск приложения не должен
    // терять начатую загрузку.
    await writeFile(
      mediaPath(config, `uploads/${uploadId}/info.json`),
      JSON.stringify({ lessonId, fileName: name, bytes })
    );

    await pool.query(`UPDATE lessons SET pipeline_state = 'uploading' WHERE id = $1`, [lessonId]);
    res.json({ uploadId, chunkSize: CHUNK_SIZE, fileName: name, received: [] });
  });

  router.post('/from-disk', async (req, res) => {
    const { lessonId, diskPath } = req.body ?? {};
    if (!lessonId || !diskPath) throw new PublicError('Не указан урок или файл');

    await pool.query(`UPDATE lessons SET pipeline_state = 'uploading' WHERE id = $1`, [lessonId]);
    // Работа идёт в воркере: скачивание гигабайтного файла занимает минуты, а
    // HTTP-запрос столько не живёт — человек закроет вкладку и не узнает, чем
    // кончилось.
    await addJob(req.app.locals.queue, 'fetchSource', { lessonId, diskPath: String(diskPath) });
    res.json({ ok: true });
  });

  router.get('/:uploadId', async (req, res) => {
    res.json({ received: await receivedChunks(config, req.params.uploadId) });
  });

  // Обложка, выбранная автором на своём компьютере.
  //
  // Отдельно от загрузки исходника: там гигабайты кусками с продолжением после
  // обрыва, здесь один небольшой файл, и городить вокруг него тот же протокол
  // незачем.
  router.put('/cover/:slug', async (req, res) => {
    const lesson = await getLessonBySlug(pool, req.params.slug, { includeDrafts: true });
    if (!lesson) throw new PublicError('Урок не найден', 404);

    // Читаем в память, а не потоком на диск: предел небольшой, а тип файла
    // определяется по первым байтам — писать на диск то, что окажется не
    // картинкой, незачем.
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > COVER_LIMIT) throw new PublicError('Картинка больше десяти мегабайт', 413);
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);

    // Вид определяем по самим байтам: заголовок и расширение задаёт браузер, а
    // обложка потом отдаётся всем подряд.
    const type = imageTypeOf(bytes);
    if (!type) throw new PublicError('Это не картинка: принимаются png, jpeg и webp', 415);

    const dir = `lesson-${lesson.id}`;
    await mkdir(mediaPath(config, dir), { recursive: true });
    // Имя постоянное: вторая загруженная обложка заменяет первую, а не копится
    // в буфере до истечения срока.
    const relative = `${dir}/cover-uploaded.${type}`;
    await writeFile(mediaPath(config, relative), bytes);

    const asset = await registerAsset(pool, config, {
      lessonId: lesson.id,
      kind: 'cover',
      relativePath: relative,
      bytes: bytes.length
    });
    await pool.query('UPDATE lessons SET cover_url = $1 WHERE id = $2', [
      `/media/asset/${asset.id}`,
      lesson.id
    ]);

    res.json({ assetId: asset.id, bytes: bytes.length, type });
  });

  router.put('/:uploadId/:index', async (req, res) => {
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0) throw new PublicError('Неверный номер куска');

    // Пишем потоком: кусок в восемь мегабайт незачем держать в памяти целиком,
    // особенно когда её полтора гигабайта на всю машину.
    await pipeline(
      req,
      createWriteStream(mediaPath(config, `uploads/${req.params.uploadId}/${index}.part`))
    );
    res.json({ ok: true });
  });

  router.post('/:uploadId/finish', async (req, res) => {
    const { uploadId } = req.params;
    const info = JSON.parse(
      await readFile(mediaPath(config, `uploads/${uploadId}/info.json`), 'utf8')
    );

    const dir = `lesson-${info.lessonId}`;
    await mkdir(mediaPath(config, dir), { recursive: true });
    const relative = `${dir}/${info.fileName}`;
    const full = mediaPath(config, relative);

    // Склейка потоком, кусок за куском по возрастанию номера: держать
    // гигабайтный файл в памяти нельзя, а порядок задаёт номер, а не
    // очерёдность прихода — после обрыва куски приходят вразнобой.
    const indexes = await receivedChunks(config, uploadId);
    const out = createWriteStream(full);
    for (const index of indexes) {
      const part = await open(mediaPath(config, `uploads/${uploadId}/${index}.part`), 'r');
      await pipeline(part.createReadStream(), out, { end: false });
      await part.close();
    }
    out.end();
    await new Promise((resolve) => out.on('close', resolve));

    await rm(mediaPath(config, `uploads/${uploadId}`), { recursive: true, force: true });

    const { size } = await stat(full);
    const asset = await registerAsset(pool, config, {
      lessonId: info.lessonId,
      kind: 'source',
      relativePath: relative,
      bytes: size
    });
    await pool.query(
      `UPDATE lessons SET source_asset_id = $1, pipeline_state = 'processing', pipeline_error = NULL
        WHERE id = $2`,
      [asset.id, info.lessonId]
    );

    res.json({ asset: { id: asset.id, bytes: size } });
  });

  return router;
}
