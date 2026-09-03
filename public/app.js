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
 * Запрос к своему API с общей обработкой отказов.
 * Зачем: «войдите» на 401 нужно во всех обработчиках без исключения, и
 * повторять это в каждом — верный способ где-нибудь забыть.
 * Вызывается всеми обработчиками этого файла.
 */
export async function запрос(адрес, options = {}) {
  const res = await fetch(адрес, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) }
  });
  if (res.status === 401) {
    location.href = '/login';
    return null;
  }
  if (!res.ok) {
    const тело = await res.json().catch(() => ({}));
    throw new Error(тело.error ?? 'Ошибка');
  }
  return res.json();
}

// Виджет Telegram зовёт эту функцию по имени из атрибута data-onauth, поэтому
// она обязана лежать в window, а не в области видимости модуля.
window.войтиЧерезTelegram = async (user) => {
  await запрос('/api/auth/telegram', { method: 'POST', body: JSON.stringify(user) });
  location.href = '/';
};

// Выход. Кука httpOnly, скриптом её не стереть — гасит её сервер.
document.querySelector('[data-выход]')?.addEventListener('click', async () => {
  await запрос('/api/auth/logout', { method: 'POST' });
  location.href = '/';
});

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
function ключВБайты(base64url) {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (символ) => символ.charCodeAt(0));
}

/**
 * Оформляет подписку на пуши. Вызывается по нажатию, а не сама: запрос
 * разрешения без действия человека браузеры отклоняют, а Safari запоминает
 * отказ надолго — второго шанса спросить не будет.
 */
async function включитьУведомления(кнопка) {
  const { key } = await запрос('/api/push/key');
  if (!key) return;

  const разрешение = await Notification.requestPermission();
  if (разрешение !== 'granted') {
    кнопка.title = 'Уведомления запрещены в настройках браузера';
    return;
  }

  const регистрация = await navigator.serviceWorker.ready;
  const подписка =
    (await регистрация.pushManager.getSubscription()) ??
    (await регистрация.pushManager.subscribe({
      // Без этого флага браузер разрешил бы «тихие» пуши без уведомления — и
      // отозвал бы подписку, заметив, что мы ничего не показываем.
      userVisibleOnly: true,
      applicationServerKey: ключВБайты(key)
    }));

  await запрос('/api/push/subscribe', { method: 'POST', body: JSON.stringify(подписка) });
  кнопка.textContent = '🔔';
  кнопка.title = 'Уведомления включены';
  кнопка.disabled = true;
}

const кнопкаУведомлений = document.querySelector('[data-уведомления]');
if (кнопкаУведомлений && 'Notification' in window && 'serviceWorker' in navigator) {
  запрос('/api/push/key')
    .then(async (ответ) => {
      if (!ответ?.key) return;
      кнопкаУведомлений.hidden = false;
      const регистрация = await navigator.serviceWorker.ready;
      if (await регистрация.pushManager.getSubscription()) {
        кнопкаУведомлений.title = 'Уведомления включены';
        кнопкаУведомлений.disabled = true;
      }
    })
    .catch(() => {
      // Ключей нет или сервер недоступен — кнопка так и остаётся скрытой.
    });

  кнопкаУведомлений.addEventListener('click', () => включитьУведомления(кнопкаУведомлений));
}

/* --- Тема ---------------------------------------------------------------
 * По умолчанию берётся системная настройка, кнопка её перебивает. Выбор
 * хранится в браузере: сервер о нём не знает и знать не должен — это личная
 * настройка устройства, а не свойство аккаунта. */
const КЛЮЧ_ТЕМЫ = 'portal-theme';

/**
 * Красит строку браузера в цвет фактического фона страницы.
 * Зачем скриптом, а не двумя метками с prefers-color-scheme: часть версий
 * Safari media у theme-color игнорирует и красит бары своим цветом — тем
 * самым белым, что видно сверху и снизу экрана. Одну метку понимают все.
 * Вызывается при загрузке и при каждой смене темы.
 */
function обновитьЦветСтроки() {
  const фон = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  const метка = document.querySelector('meta[name="theme-color"]');
  if (метка && фон) метка.setAttribute('content', фон);
}

function применитьТему(тема) {
  if (тема) document.documentElement.dataset.theme = тема;
  else delete document.documentElement.dataset.theme;
  обновитьЦветСтроки();
}

try {
  применитьТему(localStorage.getItem(КЛЮЧ_ТЕМЫ));
} catch {
  // Приватное окно или запрет на хранилище: остаёмся на системной теме.
  обновитьЦветСтроки();
}

// Человек переключил тему в системе, пока страница открыта.
window
  .matchMedia('(prefers-color-scheme: dark)')
  .addEventListener('change', обновитьЦветСтроки);

document.querySelector('[data-тема]')?.addEventListener('click', () => {
  const системнаяТёмная = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const сейчас = document.documentElement.dataset.theme || (системнаяТёмная ? 'dark' : 'light');
  const следующая = сейчас === 'dark' ? 'light' : 'dark';
  применитьТему(следующая);
  try {
    localStorage.setItem(КЛЮЧ_ТЕМЫ, следующая);
  } catch {
    // Не сохранилось — тема продержится до перезагрузки страницы.
  }
});

/* --- Карточка урока: реакции и отзывы ----------------------------------- */

const карточкаУрока = document.querySelector('[data-урок]');
if (карточкаУрока) {
  const objectId = Number(карточкаУрока.dataset.урок);

  for (const кнопка of карточкаУрока.querySelectorAll('[data-оценка]')) {
    кнопка.addEventListener('click', async () => {
      // Нажатие по уже отданной оценке снимает её: иначе передумать нельзя,
      // а сервер всё равно хранит одну оценку на человека.
      const отдана = кнопка.classList.contains('отдана');
      const ответ = await запрос('/api/reactions', {
        method: отдана ? 'DELETE' : 'POST',
        body: JSON.stringify({ objectType: 'lesson', objectId, kind: кнопка.dataset.оценка })
      });
      if (ответ) location.reload();
    });
  }

  const форма = document.querySelector('#форма-отзыва');
  форма?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const кнопка = форма.querySelector('button');
    кнопка.disabled = true;
    try {
      const ответ = await запрос('/api/comments', {
        method: 'POST',
        body: JSON.stringify({
          objectType: 'lesson',
          objectId,
          body: new FormData(форма).get('body')
        })
      });
      // Перезагружаем: отзыв скрыт до проверки, но своему автору он виден —
      // человек должен увидеть, что его слова не пропали.
      if (ответ) location.reload();
    } finally {
      кнопка.disabled = false;
    }
  });
}

/* --- Борд идей ----------------------------------------------------------- */

// Счётчик правим на месте, без перезагрузки: голосуют подряд за несколько идей,
// и перезагрузка на каждый голос сбрасывала бы прокрутку к началу списка.
for (const кнопка of document.querySelectorAll('[data-голос]')) {
  кнопка.addEventListener('click', async () => {
    const отдан = кнопка.classList.contains('отдан');
    const ответ = await запрос(`/api/ideas/${кнопка.dataset.голос}/vote`, {
      method: отдан ? 'DELETE' : 'POST'
    });
    if (!ответ) return;
    const счётчик = кнопка.querySelector('span');
    счётчик.textContent = Number(счётчик.textContent) + (отдан ? -1 : 1);
    кнопка.classList.toggle('отдан');
    кнопка.setAttribute('aria-label', отдан ? 'Проголосовать' : 'Отозвать голос');
  });
}

const формаИдеи = document.querySelector('#форма-идеи');
формаИдеи?.addEventListener('submit', async (событие) => {
  событие.preventDefault();
  const данные = new FormData(формаИдеи);
  const ответ = await запрос('/api/ideas', {
    method: 'POST',
    body: JSON.stringify({ title: данные.get('title'), body: данные.get('body') })
  });
  // Здесь перезагрузка уместна: идея видна сразу, и человек должен увидеть её
  // в списке на своём месте — по числу голосов, а не там, где он ожидал.
  if (ответ) location.reload();
});
