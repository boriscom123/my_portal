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
  box.textContent = text;
  box.setAttribute('role', 'status');
  document.body.append(box);
  setTimeout(() => box.remove(), 7000);
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
 * Переводит публичный ключ VAPID из base64url в байты.
 * Зачем: браузер принимает applicationServerKey только массивом байт, а сервер
 * отдаёт строку. Это самое частое место, где подписка молча не оформляется.
 * Вызывается только из включитьУведомления.
 */
function keyToBytes(base64url) {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

/**
 * Оформляет подписку на пуши. Вызывается по нажатию, а не сама: запрос
 * разрешения без действия человека браузеры отклоняют, а Safari запоминает
 * отказ надолго — второго шанса спросить не будет.
 */
/**
 * Открыт ли портал как установленное приложение.
 * Зачем проверять: на iPhone Web Push работает ТОЛЬКО в приложении с
 * домашнего экрана. В самом Safari разрешение спрашивается, человек его даёт,
 * а подписка потом падает — и он остаётся с ощущением, что всё сломано.
 * Вызывается из enableNotifications.
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

async function enableNotifications(button) {
  if (isApple() && !isInstalledApp()) {
    toast(
      'На iPhone уведомления работают только в приложении: «Поделиться» → «На экран Домой», ' +
        'потом открыть с домашнего экрана.',
      true
    );
    return;
  }

  try {
    const { key } = await request('/api/push/key');
    if (!key) {
      toast('Уведомления пока не настроены на сервере.', true);
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      toast('Уведомления запрещены. Разрешить их можно в настройках браузера.', true);
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        // Без этого флага браузер разрешил бы «тихие» пуши без уведомления — и
        // отозвал бы подписку, заметив, что мы ничего не показываем.
        userVisibleOnly: true,
        applicationServerKey: keyToBytes(key)
      }));

    await request('/api/push/subscribe', { method: 'POST', body: JSON.stringify(subscription) });
    button.title = 'Уведомления включены';
    button.disabled = true;
    toast('Готово — уведомления о новых уроках будут приходить сюда.');
  } catch (error) {
    // Показываем текст браузера как есть: он часто объясняет причину точнее,
    // чем любая наша догадка.
    toast(`Не удалось включить уведомления: ${error.message}`, true);
  }
}

const notificationsButton = document.querySelector('[data-notifications]');
if (notificationsButton && 'Notification' in window && 'serviceWorker' in navigator) {
  request('/api/push/key')
    .then(async (answer) => {
      if (!answer?.key) return;
      notificationsButton.hidden = false;
      const registration = await navigator.serviceWorker.ready;
      if (await registration.pushManager.getSubscription()) {
        notificationsButton.title = 'Уведомления включены';
        notificationsButton.disabled = true;
      }
    })
    .catch(() => {
      // Ключей нет или сервер недоступен — кнопка так и остаётся скрытой.
    });

  notificationsButton.addEventListener('click', () => enableNotifications(notificationsButton));
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
