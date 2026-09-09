// Страница заведения урока.
//
// Задача — одно действие и объяснение к нему. Раньше форма стояла посреди
// списка уроков и мешала его читать, а на своей странице ей есть где сказать,
// что будет дальше.
// Вызывается из src/routes/pages.js по адресу /lessons/new.
import { assetUrl } from '../lib/assets.js';
import { layout } from './layout.js';

export function lessonNewPage({ config, user, diskConnected = false }) {
  return layout({
    config,
    user,
    path: '/lessons/new',
    title: 'Новый урок — Solo AI Journey',
    description: 'Завести урок и загрузить запись.',
    body: `
<p><a href="/lessons">← Уроки</a></p>
<h1>Новый урок</h1>

<section class="card">
  <form id="new-lesson-form" data-new-lesson>
    <div class="form-row">
      <button class="button-brand" type="submit">Завести урок</button>
    </div>
  </form>
  <p class="hint">
    Названия здесь нет намеренно: на этом шаге его неоткуда взять. Урок получит
    временное имя с датой, а настоящее предложит модель по расшифровке — и вы
    его поправите.
  </p>
  <p class="hint">
    Дальше: загрузить запись — с компьютера или с Яндекс Диска, — потом нажать
    «Обработать». ${
      diskConnected
        ? 'Диск подключён: записи можно брать оттуда.'
        : '<a href="/admin/upload">Диск пока не подключён.</a>'
    }
  </p>
</section>

<script src="${assetUrl('/admin.js')}" type="module"></script>`
  });
}
