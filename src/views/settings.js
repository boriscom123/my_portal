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
import { layout } from './layout.js';

export function settingsPage({ config, user }) {
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
  <p class="hint">
    Подключения площадок появятся здесь на этапе публикации: сейчас такой
    страницы нет, и ссылка на неё вела бы в пустоту.
  </p>
</section>`
    : ''
}`
  });
}
