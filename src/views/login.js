// Страница входа. Задача — показать способы входа и объяснить человеку, что
// они ведут в один аккаунт: без этой строки повторный вход другим способом
// выглядит как потеря истории, и человек заводит второй профиль.
// Вызывается из src/routes/pages.js по маршруту /login.
import { escapeHtml } from '../lib/html.js';
import { layout } from './layout.js';

/**
 * Ссылка входа через Telegram.
 *
 * Ведёт на страницу подтверждения Telegram и возвращает человека к нам с
 * ответом в якоре адреса. Зачем не официальный виджет: виджет — чужой iframe,
 * и в приложении с домашнего экрана он появляется через раз. Обычный переход
 * работает везде одинаково и выглядит как остальные кнопки портала.
 * Вызывается из loginPage.
 */
function telegramLoginUrl(config) {
  const params = new URLSearchParams({
    bot_id: config.telegram.botId,
    origin: config.publicBaseUrl,
    // Разрешение писать нужно, чтобы бот мог доставлять уведомления тем,
    // у кого нет установленного приложения.
    request_access: 'write',
    return_to: `${config.publicBaseUrl}/auth/telegram/return`
  });
  return `https://oauth.telegram.org/auth?${params}`;
}

export function loginPage({ config, user = null }) {
  const telegramEnabled = Boolean(config.telegram?.botToken && config.telegram?.botId);

  return layout({
    config,
    user,
    path: '/login',
    title: 'Вход — Solo AI Journey',
    description:
      'Войдите, чтобы оставлять отзывы, голосовать за темы будущих уроков и получать уведомления о новых выпусках.',
    body: `
<div class="login">
  <img class="login-mark" src="/icons/icon-192.png" alt="">
  <h1>Вход</h1>
  <p>Любой способ ведёт в <b>один и тот же аккаунт</b>: войдите вторым — он привяжется к первому, история никуда не денется.</p>

  <div class="card login-methods">
    <a class="button-brand" href="/api/auth/google">Войти через Google</a>
    ${
      telegramEnabled
        ? `<a class="button" href="${escapeHtml(telegramLoginUrl(config))}">Войти через Telegram</a>`
        : '<p class="hint">Вход через Telegram пока не настроен.</p>'
    }

    <div class="divider">скоро</div>
    <div class="soon">
      <span>VK</span>
      <span>Яндекс</span>
      <span>MAX</span>
    </div>
  </div>

  <p class="hint">Читать уроки можно и без входа. Он нужен, чтобы оставлять отзывы, голосовать за темы и получать уведомления о новых выпусках.</p>
  <p><a href="/">← на главную</a></p>
</div>`
  });
}
