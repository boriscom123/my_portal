// Обработка ошибок в едином виде. Задача — превратить любое исключение в
// JSON одной формы и не дать деталям утечь наружу: текст ошибки почти всегда
// содержит SQL, параметры запроса, иногда токен. Зачем отдельным файлом:
// формат ответа об ошибке — договор со всеми четырьмя клиентами, и менять его
// надо в одном месте. Вызывается из src/app.js последним в цепочке.
import { escapeHtml } from '../lib/html.js';

/**
 * Ошибка, которую можно показать пользователю.
 * Зачем: отличает «ты прислал ерунду» (400) от «у нас сломалось» (500) —
 * первое показываем как есть, второе прячем. Бросается из сервисов и роутов.
 */
export class PublicError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
    this.public = true;
  }
}

/** Ответ на запрос к несуществующему маршруту. Вызывается из src/app.js. */
export function notFound(req, res, next) {
  next(new PublicError('Не найдено', 404));
}

/**
 * Последнее звено цепочки Express. Express 5 сам ловит отказ промиса в
 * асинхронном обработчике и доводит его сюда — ради этого и взята пятая версия.
 * Вызывается фреймворком, вручную не вызывается никогда.
 */
export function errorHandler(err, req, res, _next) {
  const status = err?.public ? (err.status ?? 400) : 500;
  const message = err?.public ? err.message : 'Внутренняя ошибка';
  if (!err?.public) console.error('Необработанная ошибка:', err);

  // Один и тот же сбой должен выглядеть по-разному для человека и для клиента
  // API: браузеру страница, коду JSON. Различает их заголовок Accept.
  if (req.accepts(['json', 'html']) === 'html') {
    res.status(status).type('html').send(errorPage(status, message));
    return;
  }
  res.status(status).json({ error: message });
}

/**
 * Простая страница ошибки. Своя, а не через layout: сюда попадают и ошибки
 * самого layout, и тянуть за собой то, что могло сломаться, нельзя.
 * Вызывается только из errorHandler.
 */
function errorPage(status, message) {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${status} — Solo AI Journey</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<main>
  <h1>${status}</h1>
  <p>${escapeHtml(message)}</p>
  <p><a class="кнопка-знак" href="/">На главную</a></p>
</main>
</body>
</html>`;
}
