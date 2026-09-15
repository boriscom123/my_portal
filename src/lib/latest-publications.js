// Последняя выкладка на каждую площадку.
//
// Урок можно выложить на площадку не один раз: смонтированную запись, потом
// полную или исправленную. На площадке остаются обе копии, а в базе — по строке
// на каждую. Карточка урока, «Проверить» и ссылки в постах должны смотреть на
// последнюю: первая заслоняла бы новую, и зритель уходил бы на старый ролик.
// Чистая функция, ни базы, ни сети.
// Вызывается из src/views/admin-review.js, src/views/platform-links.js,
// src/services/platforms/announcement.js и src/routes/admin.js.

/** Миг последнего изменения; без него строка считается старше любой с ним. */
function stamp(publication) {
  const value = Date.parse(publication.updatedAt ?? '');
  return Number.isFinite(value) ? value : 0;
}

/**
 * По одной публикации на площадку — последней по времени изменения.
 * При равенстве берётся стоящая в списке позже: список идёт по порядку
 * заведения, и позже заведённая — новее.
 */
export function latestPerPlatform(publications = []) {
  const latest = new Map();
  for (const publication of publications) {
    const kept = latest.get(publication.platform);
    if (!kept || stamp(publication) >= stamp(kept)) latest.set(publication.platform, publication);
  }
  return [...latest.values()];
}
