// Картинки новости: прикрепить и убрать.
//
// Задача — один путь для картинки, откуда бы она ни пришла: загрузил автор или
// нарисовала модель. Раньше путь был только у загрузки, и имя файла шло по
// порядковому номеру — «сколько картинок + 1». Пока картинки не удаляли, это
// работало; с удалением следующая загрузка получила бы номер ещё живой
// картинки и затёрла её файл. Поэтому имя случайное, а порядок — отдельно.
// Вызывается из src/routes/upload.js, src/routes/admin.js и
// src/jobs/make-news-image.js.
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { mediaPath, registerAsset, forgetAsset } from './media.js';

/** Кладёт картинку в конец ленты новости. type — расширение из imageTypeOf. */
export async function attachNewsImage(pool, config, newsId, bytes, type) {
  const dir = `news-${newsId}`;
  await mkdir(mediaPath(config, dir), { recursive: true });
  const relative = `${dir}/image-${randomUUID().slice(0, 8)}.${type}`;
  await writeFile(mediaPath(config, relative), bytes);

  // Место — следующее за последней картинкой: автор добавляет их по одной, и
  // они встают в слайдер в том порядке, в каком появлялись.
  const { rows } = await pool.query(
    `SELECT COALESCE(max(position), 0) + 1 AS next
       FROM assets WHERE news_id = $1 AND kind = 'image'`,
    [newsId]
  );
  const asset = await registerAsset(pool, config, {
    newsId,
    kind: 'image',
    relativePath: relative,
    bytes: bytes.length,
    position: Number(rows[0].next)
  });
  return { assetId: Number(asset.id), url: `/media/asset/${asset.id}`, bytes: bytes.length };
}

/** Убирает картинку новости с диска и из учёта. false — у этой новости такой нет. */
export async function removeNewsImage(pool, config, newsId, assetId) {
  // Сверяем и новость, и вид файла: иначе этим путём можно было бы удалить
  // картинку чужой новости или файл урока.
  const { rows } = await pool.query(
    `SELECT id, path FROM assets WHERE id = $1 AND news_id = $2 AND kind = 'image'`,
    [assetId, newsId]
  );
  if (!rows.length) return false;
  // force: файла может уже не быть, а запись в учёте всё равно должна уйти —
  // иначе в ленте осталась бы картинка, которой нет.
  await rm(mediaPath(config, rows[0].path), { force: true });
  await forgetAsset(pool, Number(rows[0].id));
  return true;
}
