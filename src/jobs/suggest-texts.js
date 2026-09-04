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

export function makeSuggestTexts(config, pool, texts) {
  return async ({ lessonId }) => {
    const { rows } = await pool.query('SELECT text FROM transcripts WHERE lesson_id = $1', [
      lessonId
    ]);
    if (!rows.length) throw new Error('расшифровки ещё нет — заготовку делать не из чего');

    let suggested;
    try {
      if (!texts) throw new Error('ключ модели не задан');
      suggested = { ...(await texts.suggest(rows[0].text)), source: 'model' };
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
    suggested.at = new Date().toISOString();
    await pool.query(
      `UPDATE lessons SET generated = jsonb_set(generated, '{suggested}', $1::jsonb) WHERE id = $2`,
      [JSON.stringify(suggested), lessonId]
    );
    return { source: suggested.source, model: suggested.model ?? null };
  };
}
