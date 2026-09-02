// Единая процедура входа. Задача — свести все способы входа к одному решению:
// это уже известный человек, это новый способ у известного человека, или это
// новый человек. Зачем в одном месте: правило «один человек — один аккаунт»
// иначе пришлось бы повторять в каждом из шести обработчиков входа, и на
// шестом оно бы разошлось.
// Вызывается из src/routes/auth.js всеми способами входа.

/**
 * Находит или заводит пользователя по привязке.
 *
 * Три случая, в порядке проверки:
 *   1. привязка найдена — входим под её пользователем;
 *   2. привязки нет, но человек уже вошёл — привязываем к нему;
 *   3. иначе — заводим нового.
 *
 * Возвращает { userId, role, created, conflict }. conflict — попытка привязать
 * к себе аккаунт провайдера, уже занятый другим человеком: входим под
 * владельцем, а не отнимаем привязку.
 */
export async function resolveIdentity(
  pool,
  {
    provider,
    externalId,
    displayName,
    avatarUrl = null,
    currentUserId = null,
    adminIdentities = []
  }
) {
  const isAdmin = adminIdentities.some(
    (admin) => admin.provider === provider && admin.externalId === String(externalId)
  );
  const role = isAdmin ? 'admin' : 'user';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const found = await client.query(
      'SELECT user_id FROM identities WHERE provider = $1 AND external_id = $2',
      [provider, String(externalId)]
    );

    // Случай 1: знакомая привязка.
    if (found.rowCount > 0) {
      const userId = found.rows[0].user_id;
      // Роль пересчитывается при каждом входе: правка списка админов в
      // окружении должна действовать после перезапуска, а не после
      // переустановки базы. Понижение роли работает так же, как повышение.
      await client.query('UPDATE users SET role = $1 WHERE id = $2', [role, userId]);
      await client.query('COMMIT');
      return {
        userId: Number(userId),
        role,
        created: false,
        conflict: currentUserId !== null && Number(currentUserId) !== Number(userId)
      };
    }

    // Случай 2: новый способ входа у уже вошедшего человека.
    if (currentUserId !== null) {
      await client.query(
        'INSERT INTO identities (user_id, provider, external_id) VALUES ($1, $2, $3)',
        [currentUserId, provider, String(externalId)]
      );
      if (isAdmin) {
        await client.query('UPDATE users SET role = $1 WHERE id = $2', [role, currentUserId]);
      }
      const current = await client.query('SELECT role FROM users WHERE id = $1', [currentUserId]);
      await client.query('COMMIT');
      return {
        userId: Number(currentUserId),
        role: current.rows[0].role,
        created: false,
        conflict: false
      };
    }

    // Случай 3: новый человек.
    const created = await client.query(
      'INSERT INTO users (display_name, avatar_url, role) VALUES ($1, $2, $3) RETURNING id',
      [displayName || 'Гость', avatarUrl, role]
    );
    const userId = created.rows[0].id;
    await client.query(
      'INSERT INTO identities (user_id, provider, external_id) VALUES ($1, $2, $3)',
      [userId, provider, String(externalId)]
    );
    await client.query('COMMIT');
    return { userId: Number(userId), role, created: true, conflict: false };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
