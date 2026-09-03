import { keyToBytes } from './push-key.js';

/* Клиент портала: ванильный JS, без сборки.
 *
 * Задача — оживить серверные страницы: отправить данные виджета входа,
 * запомнить выбор темы. Реакции, отзывы, подписка на пуши и голоса за идеи
 * добавятся на этапах 2–4. Зачем без фреймворка: логики здесь на десяток
 * обработчиков, а сборка добавила бы в публичный репозиторий шаг, который
 * зрителю урока пришлось бы объяснять раньше самого предмета.
 * Подключается из src/views/layout.js на каждой странице.
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
async function reportError(where, error) {
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

/* --- Уведомления --------------------------------------------------------
 * Кнопка появляется только там, где подписка вообще возможна: у гостя её нет,
 * без ключей на сервере — тоже, а на iOS Web Push работает лишь в приложении,
 * установленном на домашний экран. Мёртвая кнопка хуже отсутствующей. */

/**
 * Открыт ли портал как установленное приложение.
 * Зачем проверять: на iPhone Web Push работает ТОЛЬКО в приложении с
 * домашнего экрана. В самом Safari разрешение спрашивается, человек его даёт,
 * а подписка потом падает — и он остаётся с ощущением, что всё сломано.
 * Вызывается из обработчика кнопки.
 */
function isInstalledApp() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // Старый признак самой iOS: на ней он надёжнее медиазапроса.
    window.navigator.standalone === true
  );
}

/** iPhone и iPad — у них свои правила для уведомлений. */
function isApple() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

/**
 * Оформляет подписку, когда разрешение уже получено.
 *
 * Ключ передаётся готовым: запрашивать его здесь нельзя, потому что к этому
 * моменту разрешение уже должно быть спрошено — см. обработчик нажатия ниже.
 * Вызывается только оттуда.
 */
async function subscribeToPush(key) {
  // navigator.serviceWorker.ready никогда не отклоняется: если worker не
  // зарегистрировался, обещание просто висит вечно — человек нажал кнопку и
  // не получил ни ответа, ни ошибки. Ограничиваем ожидание.
  const registration = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('приложение не подготовилось к уведомлениям')), 8000)
    )
  ]);

  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      // Без этого флага браузер разрешил бы «тихие» пуши без уведомления — и
      // отозвал бы подписку, заметив, что мы ничего не показываем.
      userVisibleOnly: true,
      applicationServerKey: keyToBytes(key)
    }));

  await request('/api/push/subscribe', { method: 'POST', body: JSON.stringify(subscription) });
}

const notificationsButton = document.querySelector('[data-notifications]');
if (notificationsButton && 'Notification' in window && 'serviceWorker' in navigator) {
  // Ключ забираем заранее, при загрузке страницы. Это не преждевременная
  // оптимизация, а необходимость: Safari разрешает спрашивать разрешение
  // только прямо в обработчике нажатия, а поход в сеть перед этим разрывает
  // связь с нажатием — и подписка падает. Ровно на этом мы и стояли.
  let vapidKey = null;

  request('/api/push/key')
    .then(async (answer) => {
      if (!answer?.key) return;
      vapidKey = answer.key;
      notificationsButton.hidden = false;

      const registration = await navigator.serviceWorker.getRegistration();
      if (registration && (await registration.pushManager.getSubscription())) {
        notificationsButton.title = 'Уведомления включены';
        notificationsButton.disabled = true;
      }
    })
    .catch(() => {
      // Ключей нет или сервер недоступен — кнопка так и остаётся скрытой.
    });

  notificationsButton.addEventListener('click', () => {
    if (isApple() && !isInstalledApp()) {
      toast(
        'На iPhone уведомления работают только в приложении: «Поделиться» → «На экран Домой», ' +
          'потом открыть с домашнего экрана.',
        true
      );
      reportError('push-not-standalone', new Error('открыто не как приложение'));
      return;
    }
    if (!vapidKey) {
      toast('Уведомления пока не настроены на сервере.', true);
      return;
    }

    // Вызов идёт первой строкой и без await перед ним: так браузер видит, что
    // разрешение спрашивают в ответ на нажатие человека.
    Notification.requestPermission()
      .then(async (permission) => {
        if (permission !== 'granted') {
          toast('Уведомления запрещены. Разрешить их можно в настройках браузера.', true);
          return;
        }
        await subscribeToPush(vapidKey);
        notificationsButton.title = 'Уведомления включены';
        notificationsButton.disabled = true;
        toast('Готово — уведомления о новых уроках будут приходить сюда.');
      })
      .catch((error) => {
        // Показываем текст браузера как есть: он объясняет причину точнее
        // любой нашей догадки. Тот же текст уходит в журнал сервера.
        toast(`Не удалось включить уведомления: ${error.message}`, true);
        reportError('push-subscribe', error);
      });
  });
}

/* --- Тема ---------------------------------------------------------------
 * По умолчанию берётся системная настройка, кнопка её перебивает. Выбор
 * хранится в браузере: сервер о нём не знает и знать не должен — это личная
 * настройка устройства, а не свойство аккаунта. */
const THEME_KEY = 'portal-theme';

/**
 * Красит строку браузера в цвет фактического фона страницы.
 * Зачем скриптом, а не двумя метками с prefers-color-scheme: часть версий
 * Safari media у theme-color игнорирует и красит бары своим цветом — тем
 * самым белым, что видно сверху и снизу экрана. Одну метку понимают все.
 * Вызывается при загрузке и при каждой смене темы.
 */
function updateThemeColor() {
  const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  const tag = document.querySelector('meta[name="theme-color"]');
  if (tag && background) tag.setAttribute('content', background);
}

function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  updateThemeColor();
}

try {
  applyTheme(localStorage.getItem(THEME_KEY));
} catch {
  // Приватное окно или запрет на хранилище: остаёмся на системной теме.
  updateThemeColor();
}

// Человек переключил тему в системе, пока страница открыта.
window
  .matchMedia('(prefers-color-scheme: dark)')
  .addEventListener('change', updateThemeColor);

document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const current = document.documentElement.dataset.theme || (systemDark ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Не сохранилось — тема продержится до перезагрузки страницы.
  }
});

/* --- Карточка урока: реакции и отзывы ----------------------------------- */

const lessonCard = document.querySelector('[data-lesson]');
if (lessonCard) {
  const objectId = Number(lessonCard.dataset.lesson);

  for (const button of lessonCard.querySelectorAll('[data-rating]')) {
    button.addEventListener('click', async () => {
      // Нажатие по уже отданной оценке снимает её: иначе передумать нельзя,
      // а сервер всё равно хранит одну оценку на человека.
      const isChosen = button.classList.contains('отдана');
      const answer = await request('/api/reactions', {
        method: isChosen ? 'DELETE' : 'POST',
        body: JSON.stringify({ objectType: 'lesson', objectId, kind: button.dataset.rating })
      });
      if (answer) location.reload();
    });
  }

  const form = document.querySelector('#comment-form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      const answer = await request('/api/comments', {
        method: 'POST',
        body: JSON.stringify({
          objectType: 'lesson',
          objectId,
          body: new FormData(form).get('body')
        })
      });
      // Перезагружаем: отзыв скрыт до проверки, но своему автору он виден —
      // человек должен увидеть, что его слова не пропали.
      if (answer) location.reload();
    } finally {
      button.disabled = false;
    }
  });
}

/* --- Борд идей ----------------------------------------------------------- */

// Счётчик правим на месте, без перезагрузки: голосуют подряд за несколько идей,
// и перезагрузка на каждый голос сбрасывала бы прокрутку к началу списка.
for (const button of document.querySelectorAll('[data-vote]')) {
  button.addEventListener('click', async () => {
    const isVoted = button.classList.contains('отдан');
    const answer = await request(`/api/ideas/${button.dataset.vote}/vote`, {
      method: isVoted ? 'DELETE' : 'POST'
    });
    if (!answer) return;
    const counter = button.querySelector('span');
    counter.textContent = Number(counter.textContent) + (isVoted ? -1 : 1);
    button.classList.toggle('отдан');
    button.setAttribute('aria-label', isVoted ? 'Проголосовать' : 'Отозвать голос');
  });
}

const ideaForm = document.querySelector('#idea-form');
ideaForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(ideaForm);
  const answer = await request('/api/ideas', {
    method: 'POST',
    body: JSON.stringify({ title: data.get('title'), body: data.get('body') })
  });
  // Здесь перезагрузка уместна: идея видна сразу, и человек должен увидеть её
  // в списке на своём месте — по числу голосов, а не там, где он ожидал.
  if (answer) location.reload();
});
