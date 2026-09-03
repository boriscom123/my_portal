// Слой уведомлений: выбор канала и защита от повторов.
//
// Задача — избавить вызывающий код от знания о каналах. Он говорит «уведомить
// такого-то о таком-то», а куда это уйдёт — пушем, ботом Telegram, ботом MAX
// или никуда — решается здесь, по тому, что у человека есть. Зачем так: поводов
// уведомить будет много (новый урок, ответ на отзыв, статус идеи, упавшая
// публикация), и если каждый начнёт сам перебирать каналы, правило «одно
// событие — одно уведомление» разойдётся на первом же новом поводе.
// Вызывается из src/routes/lessons.js, src/routes/feedback.js и с этапа 5 —
// из воркера.

// Порядок перебора каналов. Пуш первым: он приходит в установленное
// приложение, то есть тому, кто уже выразил готовность его получать.
const ПРИОРИТЕТ_ТЕЛЕГРАМА = ['tg_widget', 'tg_miniapp'];

/**
 * Отправляет уведомление одним каналом — первым доступным по приоритету:
 * пуш в приложение → бот Telegram → бот MAX → молчим.
 *
 * Запись в журнал делается ДО отправки и снимается при неудаче: так повтор
 * задачи после сбоя доотправит, а повтор после успеха — нет.
 */
export async function notify(pool, { userId, kind, dedupKey, title, body, url }, channels = {}) {
  // Занимаем ключ. Не занялся — значит это уведомление уже отправляли.
  const занято = await pool.query(
    `INSERT INTO notifications (user_id, kind, payload, dedup_key)
     VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (dedup_key) DO NOTHING
     RETURNING id`,
    [userId, kind, JSON.stringify({ title, body, url }), dedupKey]
  );
  if (!занято.rowCount) return { channel: null, reason: 'уже отправляли' };
  const записьId = занято.rows[0].id;

  const сообщение = { title, body, url };

  /** Помечает журнал каналом, которым ушло. */
  const пометить = async (канал) => {
    await pool.query('UPDATE notifications SET channel = $1 WHERE id = $2', [канал, записьId]);
    return { channel: канал };
  };

  try {
    const { rows: подписки } = await pool.query(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
      [userId]
    );
    if (подписки.length && channels.webpush) {
      await channels.webpush(подписки, сообщение);
      return пометить('webpush');
    }

    const { rows: привязки } = await pool.query(
      `SELECT provider, external_id FROM identities
        WHERE user_id = $1 AND provider IN ('tg_widget', 'tg_miniapp', 'max_miniapp')`,
      [userId]
    );

    const телеграм = привязки.find((п) => ПРИОРИТЕТ_ТЕЛЕГРАМА.includes(п.provider));
    if (телеграм && channels.telegram) {
      await channels.telegram(телеграм.external_id, сообщение);
      return пометить('telegram');
    }

    const max = привязки.find((п) => п.provider === 'max_miniapp');
    if (max && channels.max) {
      await channels.max(max.external_id, сообщение);
      return пометить('max');
    }

    // Связаться нечем. Запись остаётся с channel = NULL: это не ошибка, а факт,
    // и он пригодится, когда автор спросит, до скольких человек дошло.
    return { channel: null, reason: 'нет доступного канала' };
  } catch (err) {
    await pool.query('DELETE FROM notifications WHERE id = $1', [записьId]);
    throw err;
  }
}
