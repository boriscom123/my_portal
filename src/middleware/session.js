// Разбор сессии в каждом запросе. Задача — положить в req.user того, кто
// пришёл, или null, если это гость. Зачем два способа доставки токена: сайт и
// PWA живут на куке, недоступной скриптам, а мини-приложения Telegram и MAX
// работают внутри чужого webview, где куки то есть, то нет, — им остаётся
// заголовок. Токен при этом один и тот же.
// Вызывается из src/app.js для всех маршрутов.
import { verifySession } from '../lib/jwt.js';

export const SESSION_COOKIE = 'portal_session';

// Месяц — столько же, сколько живёт сам токен. Кука не должна пережить его.
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Разбирает заголовок Cookie в объект.
 * Зачем свой разбор вместо cookie-parser: несколько строк кода против ещё
 * одной зависимости в публичном репозитории.
 * Вызывается только из sessionMiddleware.
 */
function parseCookies(header = '') {
  const jar = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    jar[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return jar;
}

/** Настройки куки сессии. Вызывается из src/routes/auth.js. */
export function sessionCookieOptions() {
  return {
    httpOnly: true, // Скрипт на странице не должен читать токен: это защита от XSS.
    secure: true, // Портал живёт только на https, отдавать куку по http незачем.
    sameSite: 'lax', // Строгий режим ломает возврат с экрана согласия Google.
    path: '/',
    maxAge: COOKIE_MAX_AGE_MS
  };
}

/** Прослойка. Возвращает функцию, чтобы получить доступ к секрету из конфига. */
export function sessionMiddleware(config) {
  return (req, res, next) => {
    const header = req.headers.authorization ?? '';
    const fromHeader = header.startsWith('Bearer ') ? header.slice(7) : null;
    const fromCookie = parseCookies(req.headers.cookie)[SESSION_COOKIE] ?? null;

    const payload = verifySession(fromHeader ?? fromCookie ?? '', config.jwtSecret);
    req.user = payload ? { id: payload.userId, role: payload.role } : null;
    next();
  };
}
