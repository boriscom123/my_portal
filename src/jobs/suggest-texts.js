// Шаг конвейера: заготовка заголовка, описания и тегов.
//
// Задача — сходить к модели и положить ответ в урок. Зачем очередью, а не
// прямо в запросе: на бесплатной доле модель отвечает семьдесят секунд, а
// nginx рвёт запрос на шестидесяти — измерено. Синхронная кнопка здесь сломана
// по устройству, а не по невезению.
//
// Ответ ложится в lessons.generated: колонка заведена на этапе 5 ровно под
// это — черновик для человека, а не данные, по которым мы ищем.
// Вызывается воркером по имени JOBS.suggestTexts.
import { suggestFromTranscript } from '../lib/summary.js';
import { buildTimeline, chaptersBlock } from '../lib/chapters.js';
import { stripNegations } from '../services/images.js';

export function makeSuggestTexts(config, pool, texts) {
  return async ({ lessonId }) => {
    const { rows } = await pool.query('SELECT text FROM transcripts WHERE lesson_id = $1', [
      lessonId
    ]);
    if (!rows.length) throw new Error('расшифровки ещё нет — заготовку делать не из чего');

    // Реплики с временами — по ним модель находит, где меняется тема. Без них
    // просить главы бессмысленно: она выдумает их из воздуха.
    const { rows: segments } = await pool.query(
      'SELECT started_ms, text FROM transcript_segments WHERE lesson_id = $1 ORDER BY started_ms',
      [lessonId]
    );
    const timeline = buildTimeline(
      segments.map((row) => ({ startedMs: Number(row.started_ms), text: row.text }))
    );

    let suggested;
    try {
      if (!texts) throw new Error('ключ модели не задан');
      suggested = { ...(await texts.suggest(rows[0].text, timeline)), source: 'model' };
    } catch (error) {
      // Отказ модели не должен оставлять автора ни с чем: откатываемся на
      // извлечение из расшифровки и говорим, почему вышло грубее.
      console.error(`Тексты от модели не получены: ${error.message}`);
      suggested = {
        ...suggestFromTranscript(rows[0].text),
        source: 'transcript',
        warning: `Модель не ответила (${error.message}); заполнено из расшифровки.`
      };
    }

    // Метка времени нужна клиенту: по ней он отличает свежую заготовку от
    // прошлой и понимает, что ждать больше нечего.
    // Главы текстом — в том виде, в каком их правит автор и видит зритель.
    // Собирает их сервер, а не клиент: время форматируется в одном месте,
    // иначе два вида одного времени однажды разойдутся.
    suggested.chaptersText = chaptersBlock(suggested.chapters ?? []);

    // Отрицания из запроса для обложки уходят сразу: модель рисования «no»
    // читает как «нарисуй», а автор увидит запрос в поле уже чистым.
    if (suggested.coverPrompt) suggested.coverPrompt = stripNegations(suggested.coverPrompt);

    suggested.at = new Date().toISOString();
    await pool.query(
      `UPDATE lessons SET generated = jsonb_set(generated, '{suggested}', $1::jsonb) WHERE id = $2`,
      [JSON.stringify(suggested), lessonId]
    );
    // Запрос для обложки ложится и в поле «Запрос для рисования»: иначе он
    // пропал бы после обновления страницы. Только от модели — заготовка из
    // расшифровки своими силами его не даёт, и затирать прежний было бы нечем.
    if (suggested.source === 'model' && suggested.coverPrompt) {
      await pool.query(
        `UPDATE lessons SET generated = generated || jsonb_build_object('coverPrompt', $1::jsonb)
          WHERE id = $2`,
        [JSON.stringify({ text: suggested.coverPrompt, source: 'suggested' }), lessonId]
      );
    }
    return { source: suggested.source, model: suggested.model ?? null };
  };
}
