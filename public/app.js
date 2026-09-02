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
