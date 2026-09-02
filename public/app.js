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

function применитьТему(тема) {
  if (тема) document.documentElement.dataset.theme = тема;
  else delete document.documentElement.dataset.theme;
}

try {
  применитьТему(localStorage.getItem(КЛЮЧ_ТЕМЫ));
} catch {
  // Приватное окно или запрет на хранилище: остаёмся на системной теме.
}

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
