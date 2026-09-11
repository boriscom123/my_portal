// Отметка «картинка рисуется», запрос, по которому она нарисована, и отказ.
//
// Задача — чтобы страница урока или новости знала, что рисование идёт, и сама
// перечиталась, когда оно кончится. Без отметки ей не на что смотреть: сервер
// отвечает на нажатие сразу, а рисует воркер минуту спустя, — и автор жал
// кнопку второй раз, отчего обложка рисовалась дважды.
//
// Всё живёт в колонке generated — у урока и у новости она устроена одинаково.
// Отметку ставит маршрут, снимает шаг после удачи и воркер после отказа.
// Давняя — старше десяти минут — считается брошенной: воркер могли
// перезапустить посреди рисования, и снять её было некому.
// Имя таблицы берётся только из списка ниже: подставлять в SQL строку со
// стороны нельзя.
// Вызывается из src/routes/admin.js, src/jobs/make-cover-image.js,
// src/jobs/make-news-image.js, src/worker.js и видов урока и новости.

export const DRAWING_STALE_MS = 10 * 60 * 1000;

// Где лежит запрос для рисования: у урока — обложки, у новости — картинки.
const PROMPT_KEYS = { lessons: 'coverPrompt', news: 'imagePrompt' };

function tableName(table) {
  if (!Object.hasOwn(PROMPT_KEYS, table)) throw new Error(`неизвестная таблица рисования: ${table}`);
  return table;
}

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
export async function markDrawing(pool, id, table = 'lessons') {
  await pool.query(
    `UPDATE ${tableName(table)}
        SET generated = (generated - 'sideError')
                        || jsonb_build_object('drawing', jsonb_build_object('startedAt', now()))
      WHERE id = $1`,
    [id]
  );
}

/** Снимает отметку после удачи и запоминает, по какому запросу нарисовано. */
export async function finishDrawing(pool, id, prompt, table = 'lessons') {
  await pool.query(
    `UPDATE ${tableName(table)}
        SET generated = (generated - 'drawing') || jsonb_build_object($2::text, $3::jsonb)
      WHERE id = $1`,
    [id, PROMPT_KEYS[table], JSON.stringify(prompt)]
  );
}

/** Запоминает запрос, составленный заранее: рисования ещё нет, отметку не трогаем. */
export async function savePrompt(pool, id, prompt, table = 'lessons') {
  await pool.query(
    `UPDATE ${tableName(table)} SET generated = generated || jsonb_build_object($2::text, $3::jsonb)
      WHERE id = $1`,
    [id, PROMPT_KEYS[table], JSON.stringify(prompt)]
  );
}

/**
 * Записывает отказ необязательного шага и снимает отметку рисования.
 * Отказ пишется рядом с шагом, а не в состояние урока: иначе на готовом уроке
 * навсегда повисает «обработка упала» из-за кнопки, которую автор нажал однажды.
 */
export async function recordSideFailure(pool, id, step, message, table = 'lessons') {
  await pool.query(
    `UPDATE ${tableName(table)} SET generated = jsonb_set(generated - 'drawing', '{sideError}', $1::jsonb)
      WHERE id = $2`,
    [JSON.stringify({ step, message: String(message).slice(0, 400) }), id]
  );
}
