// Страница возврата после входа через Telegram.
//
// Задача — принять ответ Telegram и превратить его в сессию. Telegram отдаёт
// данные не запросом на сервер, а в якоре адреса (#tgAuthResult), который на
// сервер не приходит вовсе — поэтому разбирать его может только страница.
//
// Зачем этот путь вместо виджета: виджет — чужой iframe, и в приложении,
// установленном на домашний экран, он то появляется, то нет. Своя кнопка и
// обычный переход работают везде одинаково.
// Вызывается из src/routes/pages.js по адресу /auth/telegram/return.
import { layout } from './layout.js';

export function telegramReturnPage(config) {
  return layout({
    config,
    path: '/auth/telegram/return',
    title: 'Входим… — Solo AI Journey',
    description: 'Завершаем вход через Telegram.',
    body: `
<div class="login">
  <h1>Входим…</h1>
  <p class="hint" id="telegram-return-status">Проверяем ответ Telegram.</p>
  <p><a href="/login">Вернуться ко входу</a></p>
</div>
<script>
  (function () {
    var status = document.getElementById('telegram-return-status');
    function fail(text) { status.textContent = text; }

    // Данные приходят в якоре: "#tgAuthResult=<base64 от JSON>".
    var match = location.hash.match(/tgAuthResult=([^&]+)/);
    if (!match) { fail('Telegram не передал данные. Попробуйте войти заново.'); return; }

    var user;
    try {
      // base64url: символы - и _ вместо + и /, дополнение может быть срезано.
      var raw = match[1].replace(/-/g, '+').replace(/_/g, '/');
      while (raw.length % 4) raw += '=';
      user = JSON.parse(decodeURIComponent(escape(atob(raw))));
    } catch (e) {
      fail('Ответ Telegram не разобрать. Попробуйте войти заново.');
      return;
    }

    fetch('/api/auth/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user)
    })
      .then(function (res) {
        if (res.ok) { location.replace('/'); return; }
        return res.json().then(function (body) {
          fail('Войти не удалось: ' + (body.error || res.status));
        });
      })
      .catch(function () { fail('Сеть недоступна. Попробуйте войти заново.'); });
  })();
</script>`
  });
}
