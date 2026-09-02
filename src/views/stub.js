// Заглушка главной страницы. Задача — показать человеку, открывшему адрес,
// что портал жив и что здесь будет: пустой ответ или голый JSON читаются как
// сломанный сайт. Зачем отдельным файлом, а не строкой в маршруте: на этапе 2
// её заменит настоящая витрина, и замена должна быть удалением одного файла,
// а не выковыриванием разметки из логики.
// Вызывается из src/app.js по маршруту /.
import { version } from '../version.js';

export function stubPage() {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Портал видеоуроков — скоро</title>
<meta name="description" content="Портал видеоуроков о разработке: уроки, новости, идеи для следующих выпусков.">
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         font: 16px/1.6 system-ui, sans-serif; color: #1a1a1a; background: #fafafa; }
  main { max-width: 34rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.6rem; margin: 0 0 1rem; }
  ul { text-align: left; display: inline-block; margin: 1rem 0; }
  .версия { color: #888; font-size: 0.85rem; margin-top: 2rem; }
</style>
</head>
<body>
<main>
  <h1>Портал видеоуроков</h1>
  <p>Сайт строится. Здесь будут уроки о разработке, новости и борд идей —
     тем для следующих выпусков.</p>
  <ul>
    <li>витрина уроков со ссылками на все площадки;</li>
    <li>отзывы, реакции и голосование за темы;</li>
    <li>приложение на телефон с уведомлениями о новых уроках.</li>
  </ul>
  <p class="версия">Каркас собран, версия ${version}</p>
</main>
</body>
</html>`;
}
