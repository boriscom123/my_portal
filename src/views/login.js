// Страница входа. Задача — показать способы входа и объяснить человеку, что
// они ведут в один аккаунт: без этой строки повторный вход другим способом
// выглядит как потеря истории, и человек заводит второй профиль.
// Вызывается из src/routes/pages.js по маршруту /login.
import { escapeHtml } from '../lib/html.js';
import { layout } from './layout.js';

/**
 * Виджет Telegram — чужой скрипт: он сам рисует кнопку и зовёт нашу функцию
 * с подписанными данными. Показываем его только когда бот настроен: иначе на
 * странице висела бы кнопка, которая ничего не делает.
 */
function виджетTelegram(botUsername) {
  if (!botUsername) {
    return '<p class="подсказка">Вход через Telegram пока не настроен.</p>';
  }
  // Обработчик объявляется здесь, обычным скриптом, ДО подключения виджета.
  // Раньше он жил в app.js — модуле, который выполняется после разбора
  // страницы; виджет успевал вызвать ещё не существующую функцию, и первое
  // нажатие уходило в никуда молча. Данные складываются в очередь, а забирает
  // их app.js, когда загрузится.
  return `<div id="виджет-telegram">
  <script>
    window.очередьВхода = null;
    window.onTelegramAuth = function (user) {
      if (window.войтиЧерезTelegram) window.войтиЧерезTelegram(user);
      else window.очередьВхода = user;
    };
  </script>
  <script async src="https://telegram.org/js/telegram-widget.js?22"
    data-telegram-login="${escapeHtml(botUsername)}"
    data-size="large"
    data-radius="12"
    data-onauth="onTelegramAuth(user)"
    data-request-access="write"></script>
  <p class="ошибка-входа подсказка" hidden></p>
</div>`;
}

export function loginPage({ config, user = null }) {
  const включёнTelegram = Boolean(config.telegram?.botToken && config.telegram?.botUsername);

  return layout({
    config,
    user,
    path: '/login',
    title: 'Вход — Solo AI Journey',
    description:
      'Войдите, чтобы оставлять отзывы, голосовать за темы будущих уроков и получать уведомления о новых выпусках.',
    body: `
<div class="вход">
  <img class="знак-крупно" src="/icons/icon-192.png" alt="">
  <h1>Вход</h1>
  <p>Любой способ ведёт в <b>один и тот же аккаунт</b>: войдите вторым — он привяжется к первому, история никуда не денется.</p>

  <div class="карточка способы">
    <a class="кнопка-знак" href="/api/auth/google">Войти через Google</a>
    ${включёнTelegram ? виджетTelegram(config.telegram.botUsername) : виджетTelegram('')}

    <div class="разделитель">скоро</div>
    <div class="скоро">
      <span>VK</span>
      <span>Яндекс</span>
      <span>MAX</span>
    </div>
  </div>

  <p class="подсказка">Читать уроки можно и без входа. Он нужен, чтобы оставлять отзывы, голосовать за темы и получать уведомления о новых выпусках.</p>
  <p><a href="/">← на главную</a></p>
</div>`
  });
}
