// Отдача файлов рабочего буфера.
//
// Задача — отдать наружу ровно два вида файлов и ни одного лишнего: обложку
// урока, которую видят все, и любой файл по временной ссылке — она нужна
// внешним сервисам. Всё остальное содержимое буфера наружу не смотрит.
// Подключается в src/app.js.
import { Router } from 'express';
import { readMediaToken } from '../lib/media-token.js';
import { assetById, mediaPath } from '../services/media.js';
import { PublicError } from '../middleware/errors.js';

export function mediaRoutes(config, pool) {
  const router = Router();

  // Обложка — единственный файл буфера, который показывается всем: она стоит
  // в карточке урока и в превью ссылки. Токен для неё был бы бессмыслен,
  // ссылку видят все, кто видит урок.
  router.get('/asset/:id', async (req, res) => {
    const asset = await assetById(pool, Number(req.params.id));
    if (!asset || asset.kind !== 'cover') throw new PublicError('Файл не найден', 404);
    res.set('Cache-Control', 'public, max-age=86400');
    res.sendFile(mediaPath(config, asset.path));
  });

  // Временная ссылка: по ней файл забирает внешний сервис. Проверяется только
  // подпись и срок — сервис не умеет ни входить, ни носить куки.
  router.get('/:token', async (req, res) => {
    const assetId = readMediaToken(config, req.params.token);
    if (!assetId) throw new PublicError('Ссылка недействительна или устарела', 403);

    const asset = await assetById(pool, assetId);
    if (!asset) throw new PublicError('Файл уже удалён из буфера', 404);

    // Файл частный и временный: поисковикам и кешам его хранить незачем.
    res.set('Cache-Control', 'private, no-store');
    res.sendFile(mediaPath(config, asset.path));
  });

  return router;
}
