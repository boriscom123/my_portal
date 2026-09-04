/* Общие помощники клиента: сообщения и запросы к API.
 *
 * Задача — дать их обеим частям клиента, не заставляя кабинет тянуть за собой
 * весь app.js. Раньше admin.js импортировал их прямо оттуда, а страница
 * грузила app.js по адресу с отпечатком содержимого — адреса разные, значит и
 * модули для браузера разные, и весь общий код в кабинете выполнялся дважды:
 * два обработчика выхода, две регистрации service worker, две ракеты.
 * Подключается из public/app.js и public/admin.js.
 */

/**
 * Короткое сообщение внизу экрана.
 * Зачем: без него отказ браузера остаётся между ним и нами, а человек видит
 * кнопку, которая «ничего не делает». Именно так и вышло с уведомлениями:
 * подписка падала молча.
 * Вызывается отовсюду, где действие человека может не получиться.
 */
export function toast(text, isError = false) {
  const box = document.createElement('div');
  box.className = `toast${isError ? ' error' : ''}`;
  // role="alert" заставляет программу чтения с экрана прочитать сообщение
  // сразу, а не дождаться паузы: ошибка нужна человеку немедленно.
  box.setAttribute('role', isError ? 'alert' : 'status');

  const line = document.createElement('span');
  line.textContent = text;
  box.append(line);

  if (isError) {
    // Ошибку не прячем по таймеру: её надо успеть прочитать, а иногда и
    // переписать. Закрывает человек, когда прочитал.
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Закрыть сообщение');
    close.addEventListener('click', () => box.remove());
    box.append(close);
  } else {
    setTimeout(() => box.remove(), 6000);
  }

  document.body.append(box);
}

/**
 * Отправляет текст сбоя в журнал сервера.
 * Зачем: отказы браузера видит только человек у экрана, и он пересказывает их
 * по памяти. Пусть точный текст лежит там, где его можно прочитать. Шлём
 * только от вошедших — на публичный маршрут иначе полился бы мусор.
 * Вызывается там, где сбой невиден серверу.
 */
export async function reportError(where, error) {
  try {
    await fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ where, message: String(error?.message ?? error) })
    });
  } catch {
    // Не дошло — не беда: человеку сообщение уже показано.
  }
}

/**
 * Запрос к своему API с общей обработкой отказов.
 * Зачем: «войдите» на 401 нужно во всех обработчиках без исключения, и
 * повторять это в каждом — верный способ где-нибудь забыть.
 * Вызывается всеми обработчиками этого файла.
 */
export async function request(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) }
  });
  if (res.status === 401) {
    location.href = '/login';
    return null;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? 'Ошибка');
  }
  return res.json();
}
