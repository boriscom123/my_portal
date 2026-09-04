// Заглушка главной страницы. Задача — показать человеку, открывшему адрес,
// что портал жив и что здесь будет: пустой ответ или голый JSON читаются как
// сломанный сайт. Зачем отдельным файлом, а не строкой в маршруте: на этапе 2
// её заменит настоящая витрина, и замена должна быть удалением одного файла,
// а не выковыриванием разметки из логики.
// Вызывается из src/app.js по маршруту /.
import { layout } from './layout.js';
import { version } from '../version.js';
import { hero } from './hero.js';

export function stubPage(config, user = null) {
  return layout({
    config,
    user,
    title: 'Solo AI Journey — портал видеоуроков',
    description:
      'Видеоуроки о разработке с ИИ: Claude Code, свой VPS и Telegram-бот. Уроки, новости и борд идей для будущих выпусков.',
    body: `
${hero()}

<div class="card" style="max-width:34rem">
  <p style="margin-top:0"><span class="flame-dot"></span> <span class="flame">сайт строится</span></p>
  <p>Здесь будет:</p>
  <ul>
    <li>витрина уроков со ссылками на все площадки, где урок вышел;</li>
    <li>отзывы, реакции и голосование за темы следующих выпусков;</li>
    <li>приложение на телефон с уведомлениями о новых уроках.</li>
  </ul>
  ${
    user
      ? '<p class="hint">Вы вошли — уведомление о первом уроке придёт вам.</p>'
      : '<p><a class="button-brand" href="/login">Войти</a></p>'
  }
</div>

<p class="hint">Каркас собран, версия ${version}</p>`
  });
}
