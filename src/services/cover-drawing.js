// Отметка «обложка рисуется» и её снятие.
//
// Задача — чтобы страница урока знала, что рисование идёт, и сама
// перечиталась, когда оно кончится. Без отметки ей не на что смотреть: сервер
// отвечает на нажатие сразу, а рисует воркер минуту спустя, — и автор жал
// кнопку второй раз, отчего обложка рисовалась дважды.
//
// Отметка живёт в lessons.generated, рядом с отказом довеска. Ставит её
// маршрут, снимает шаг после удачи и воркер после отказа. Давняя — старше
// десяти минут — считается брошенной: воркер могли перезапустить посреди
// рисования, и снять её было некому.
// Вызывается из src/routes/admin.js, src/jobs/make-cover-image.js, src/worker.js
// и src/views/admin-review.js.

export const DRAWING_STALE_MS = 10 * 60 * 1000;

/**
 * Идёт ли рисование: отметка есть и не брошена.
 * Время PostgreSQL отдаёт с микросекундами, а Date.parse надёжно понимает
 * только миллисекунды — лишние знаки отрезаем.
 */
export function isDrawing(drawing, now = Date.now()) {
  const raw = String(drawing?.startedAt ?? '').replace(/(\.\d{3})\d+/, '$1');
  const startedAt = Date.parse(raw);
  return Number.isFinite(startedAt) && now - startedAt < DRAWING_STALE_MS;
}

/** Ставит отметку и убирает прошлый отказ — иначе он покажется ответом на новое нажатие. */
export async function markDrawing(pool, lessonId) {
  await pool.query(
    `UPDATE lessons
        SET generated = (generated - 'sideError')
                        || jsonb_build_object('drawing', jsonb_build_object('startedAt', now()))
      WHERE id = $1`,
    [lessonId]
  );
}

/** Снимает отметку после удачи и запоминает, по какому запросу нарисовано. */
export async function finishDrawing(pool, lessonId, coverPrompt) {
  await pool.query(
    `UPDATE lessons
        SET generated = (generated - 'drawing') || jsonb_build_object('coverPrompt', $2::jsonb)
      WHERE id = $1`,
    [lessonId, JSON.stringify(coverPrompt)]
  );
}

/**
 * Записывает отказ необязательного шага и снимает отметку рисования.
 * Отказ пишется рядом с шагом, а не в состояние урока: иначе на готовом уроке
 * навсегда повисает «обработка упала» из-за кнопки, которую автор нажал однажды.
 */
export async function recordSideFailure(pool, lessonId, step, message) {
  await pool.query(
    `UPDATE lessons SET generated = jsonb_set(generated - 'drawing', '{sideError}', $1::jsonb)
      WHERE id = $2`,
    [JSON.stringify({ step, message: String(message).slice(0, 400) }), lessonId]
  );
}
