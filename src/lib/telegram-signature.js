// Проверка подписи виджета входа Telegram.
//
// Задача — убедиться, что набор полей о пользователе действительно выдан
// Telegram, а не собран в консоли браузера. Зачем отдельным файлом: это
// единственное место во всей авторизации, где безопасность держится на нашей
// арифметике, а не на чужом протоколе, — оно должно быть маленьким и
// прочитываться целиком.
// Вызывается из src/routes/auth.js при входе через виджет.
import crypto from 'node:crypto';

// Сутки. Данные виджета одноразовые: их перехват и повтор через неделю не
// должен давать вход. Сутки — запас на медленного человека, не на архив.
const DEFAULT_MAX_AGE_SECONDS = 86_400;

/**
 * Проверяет подпись и свежесть данных виджета.
 * Возвращает true/false, а не бросает: вызывающему нужен один бит решения.
 */
export function verifyTelegramWidget(data, botToken, options = {}) {
  const { hash, ...fields } = data ?? {};
  if (!hash || !botToken) return false;

  const maxAgeSeconds = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const authDate = Number(fields.auth_date);
  if (!Number.isFinite(authDate) || nowSeconds - authDate > maxAgeSeconds) return false;

  // Порядок полей задан протоколом: ключи по алфавиту, строки "ключ=значение",
  // склейка переводом строки. Любое отклонение даёт другой HMAC.
  const checkString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');

  // Ключ подписи — не сам токен бота, а его SHA-256. Так задумано в протоколе.
  const secret = crypto.createHash('sha256').update(botToken).digest();
  const expected = crypto.createHmac('sha256', secret).update(checkString).digest('hex');

  // Побайтовое сравнение с постоянным временем: обычное === выходит на первом
  // несовпадении и по времени ответа выдаёт, сколько знаков угадано.
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(hash), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
