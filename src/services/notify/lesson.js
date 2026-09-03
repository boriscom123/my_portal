// Рассылка о вышедшем уроке.
//
// Задача — разбудить подписчиков, когда урок стал виден зрителю. Зачем
// отдельным файлом: публикуют урок теперь двое — правка карточки через API и
// кнопка «Опубликовать» на экране проверки, — а два одинаковых куска кода
// однажды разойдутся, и половина людей перестанет получать уведомления.
// Вызывается из src/routes/lessons.js и src/routes/admin.js.
import { notify } from './index.js';

export async function notifyAboutLesson(pool, channels, lesson) {
  // Берём только тех, кому есть чем доставить: остальным запись в журнале
  // ничего не даст, а строк наплодит.
  const { rows } = await pool.query(
    `SELECT u.id FROM users u
      WHERE EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = u.id)
         OR EXISTS (SELECT 1 FROM identities i
                     WHERE i.user_id = u.id
                       AND i.provider IN ('tg_widget', 'tg_miniapp', 'max_miniapp'))`
  );
  for (const { id } of rows) {
    await notify(
      pool,
      {
        userId: Number(id),
        kind: 'lesson_published',
        // Ключ несёт и урок, и человека: повторное сохранение карточки не
        // разбудит людей во второй раз.
        dedupKey: `lesson:${lesson.id}:published:${id}`,
        title: 'Новый урок',
        body: lesson.title,
        url: `/lesson/${lesson.slug}`
      },
      channels
    );
  }
}
