// Настройки для того, кто смотрит портал.
//
// Задача — собрать в одном месте личные настройки устройства: тему и
// уведомления. Раньше они висели двумя значками в шапке, и на телефоне это
// были две кнопки без подписей рядом с разделами.
//
// Страница открыта всем, а не только автору: тема и уведомления — настройки
// зрителя. Подключения площадок живут отдельно, в кабинете, и ссылка туда
// показывается только автору.
// Вызывается из src/routes/pages.js по адресу /settings.
import { escapeHtml } from '../lib/html.js';
import { layout } from './layout.js';

export function settingsPage({ config, user, youtube = null }) {
  return layout({
    config,
    user,
    path: '/settings',
    title: 'Настройки — Solo AI Journey',
    description: 'Тема оформления и уведомления о новых уроках.',
    body: `
<h1>Настройки</h1>

<section class="card">
  <h2>Оформление</h2>
  <p class="hint">
    По умолчанию портал берёт тему из настроек устройства. Кнопка перебивает
    её: выбор хранится в этом браузере и на другом устройстве не появится.
  </p>
  <p class="form-row">
    <button class="button" type="button" data-theme-toggle>Светлая или тёмная</button>
  </p>
</section>

<section class="card">
  <h2>Уведомления о новых уроках</h2>
  ${
    user
      ? `<p class="hint">
           Приходят в браузер и на телефон, если портал установлен как
           приложение. Одно уведомление на человека, а не по каждому каналу.
         </p>
         <p class="form-row">
           <button class="button" type="button" data-notifications hidden>Включить</button>
           <span class="hint" data-notifications-note hidden>
             В этом браузере уведомления недоступны.
           </span>
         </p>`
      : '<p class="hint">Уведомления приходят вошедшим: <a href="/login">войдите</a>, чтобы включить.</p>'
  }
</section>

${
  user?.role === 'admin'
    ? `<section class="card">
  <h2>Для автора</h2>
  <p class="form-row">
    <a class="button" href="/admin/lessons">Уроки</a>
    <a class="button" href="/admin/upload">Загрузка и Яндекс Диск</a>
  </p>
</section>

<section class="card">
  <h2>Площадки</h2>
  <h3>YouTube</h3>
  <p class="hint">
    Ключи берутся в консоли Google Cloud — отдельным проектом, не тем, где живёт
    вход на портал. Порядок расписан в docs/youtube-setup.md.
  </p>
  <form id="youtube-app-form" data-youtube-app>
    <label>Client ID
      <input name="clientId" value="${escapeHtml(youtube?.clientId ?? '')}"
             autocomplete="off" maxlength="200" required>
    </label>
    <label>Client secret
      <input name="clientSecret" type="password" autocomplete="off" maxlength="200"
             placeholder="${youtube?.hasSecret ? 'сохранён — оставьте пустым, чтобы не менять' : 'вставьте секрет'}"
             ${youtube?.hasSecret ? '' : 'required'}>
    </label>
    <label>Что делать с роликом
      <select name="mode">
        <option value="semi" ${youtube?.mode === 'auto' ? '' : 'selected'}>
          оставлять приватным — открываю сам
        </option>
        <option value="auto" ${youtube?.mode === 'auto' ? 'selected' : ''}>
          публиковать сразу — приложение прошло проверку Google
        </option>
      </select>
    </label>
    <div class="form-row">
      <button class="button-brand" type="submit">Сохранить</button>
    </div>
  </form>
  <p class="hint">
    Адрес возврата для Google Cloud — скопируйте его туда до последнего знака:<br>
    <code>${escapeHtml(youtube?.redirectUri ?? '')}</code>
  </p>
  <p class="hint">
    Пока приложение не прошло проверку Google, ролики, залитые через API,
    принудительно остаются приватными: второй вариант заработает только после неё.
  </p>
  ${
    youtube?.configured
      ? youtube.connected
        ? `<p class="form-row">
             <span class="hint">Канал подключён.</span>
             <button class="button" type="button" data-youtube-disconnect>Отключить канал</button>
           </p>`
        : `<p class="form-row">
             <a class="button-brand" href="/api/integrations/youtube/connect">Подключить канал</a>
           </p>`
      : '<p class="hint">Сохраните ключи — после этого появится кнопка подключения канала.</p>'
  }
</section>`
    : ''
}`
  });
}
