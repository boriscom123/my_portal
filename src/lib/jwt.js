// Токен сессии. Задача — превратить «этот человек вошёл» в строку, которую
// можно положить в куку сайта и в заголовок мини-приложения, и прочитать
// обратно без похода в базу. Зачем не серверные сессии: клиентов четыре, один
// из них — мини-приложение, где куки ненадёжны, а общего хранилища сессий на
// этом этапе нет вовсе.
// Вызывается из src/routes/auth.js (выпуск) и src/middleware/session.js
// (проверка на каждом запросе).
import jwt from 'jsonwebtoken';

// Месяц. Портал — не банк: выкидывать человека каждую неделю ради безопасности
// профиля с отзывами о видеоуроках вредно. Выход по кнопке гасит куку сразу.
const SESSION_TTL = '30d';

/** Выпускает токен сессии. Вызывается после успешного входа. */
export function signSession({ userId, role }, secret) {
  return jwt.sign({ sub: String(userId), role }, secret, { expiresIn: SESSION_TTL });
}

/**
 * Проверяет токен сессии. Возвращает null на любой неудаче — просроченный,
 * чужой, испорченный. Зачем null вместо исключения: вызывающий код — прослойка
 * на каждом запросе, и различать причины ей нечего.
 */
export function verifySession(token, secret) {
  try {
    const payload = jwt.verify(token, secret);
    return { userId: Number(payload.sub), role: payload.role };
  } catch {
    return null;
  }
}

/**
 * Короткоживущий подписанный пакет для state в OAuth.
 * Зачем: state обязан пережить переход на Google и вернуться неподделанным,
 * но хранить его на сервере не нужно — подписи достаточно.
 * Вызывается из src/routes/auth.js.
 */
export function signShortLived(payload, secret, seconds) {
  return jwt.sign(payload, secret, { expiresIn: seconds });
}

/** Обратная сторона signShortLived. Возвращает null на любой неудаче. */
export function verifyShortLived(token, secret) {
  try {
    const { iat: _iat, exp: _exp, ...payload } = jwt.verify(token, secret);
    return payload;
  } catch {
    return null;
  }
}
