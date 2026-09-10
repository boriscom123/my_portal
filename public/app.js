import { keyToBytes } from './push-key.js';
import { startNavigation } from './navigation.js';
import { toast, request, reportError } from './ui.js';

// Помощники живут в ui.js; реэкспорт — чтобы не рвать чужие импорты.
export { toast, request };

/* Клиент портала: ванильный JS, без сборки.
 *
 * Задача — оживить серверные страницы: отправить данные виджета входа,
 * запомнить выбор темы. Реакции, отзывы, подписка на пуши и голоса за идеи
 * добавятся на этапах 2–4. Зачем без фреймворка: логики здесь на десяток
 * обработчиков, а сборка добавила бы в публичный репозиторий шаг, который
 * зрителю урока пришлось бы объяснять раньше самого предмета.
 * Подключается из src/views/layout.js на каждой странице.
 */


/* --- Полоска про файлы браузера ------------------------------------------
 * Показывается один раз и запоминает закрытие. Запоминает в локальном
 * хранилище, а не кукой: заводить куку ради рассказа о куках — насмешка.
 *
 * Согласия здесь не спрашивается намеренно: портал не ставит ни счётчиков, ни
 * рекламных файлов, а без них согласие спрашивать не о чем. Кнопка «Понятно»
 * закрывает рассказ, а не разрешает слежку, которой нет. */
const COOKIE_NOTE_KEY = 'cookie-note-seen';
const cookieNote = document.querySelector('[data-cookie-note]');

if (cookieNote) {
  let seen = false;
  try {
    seen = localStorage.getItem(COOKIE_NOTE_KEY) === 'yes';
  } catch {
    // Приватное окно запрещает хранилище. Тогда полоска покажется снова — это
    // неприятно, но лучше, чем страница, упавшая на рассказе о куках.
  }
  if (!seen) cookieNote.hidden = false;

  cookieNote.querySelector('[data-cookie-ok]')?.addEventListener('click', () => {
    cookieNote.hidden = true;
    try {
      localStorage.setItem(COOKIE_NOTE_KEY, 'yes');
    } catch {
      // См. выше: не сохранилось — покажем ещё раз, и только.
    }
  });
}

/* --- Уведомления --------------------------------------------------------
 * Кнопка появляется только там, где подписка вообще возможна: у гостя её нет,
 * без ключей на сервере — тоже, а на iOS Web Push работает лишь в приложении,
 * установленном на домашний экран. Мёртвая кнопка хуже отсутствующей. */

// Выход. Кука httpOnly, скриптом её не стереть — гасит её сервер.
document.querySelector('[data-logout]')?.addEventListener('click', async () => {
  const answer = await request('/api/auth/logout', { method: 'POST' });
  if (answer) location.href = '/';
});

/* --- Service worker ------------------------------------------------------
 * Он даёт офлайн-оболочку и принимает уведомления. Без него не работает ни то,
 * ни другое. */

// Обещание регистрации запоминаем: подписка на уведомления ждёт именно его, а
// не navigator.serviceWorker.ready — тот при неудачной регистрации висит вечно
// и не отклоняется никогда.
let swRegistration = null;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    swRegistration = navigator.serviceWorker.register('/sw.js');
    swRegistration.catch((error) => {
      // Молчать здесь нельзя: без worker'а не будет ни офлайна, ни
      // уведомлений, а человек об этом никак не узнает.
      console.error('Service worker не зарегистрирован:', error);
      reportError('sw-register', error);
    });
  });

  // Установленное приложение возвращают из фона, а не открывают заново. При
  // каждом возвращении спрашиваем, нет ли новой версии: иначе она дождётся
  // только полного перезапуска приложения, которого может не случиться неделями.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !swRegistration) return;
    swRegistration.then((registration) => registration.update()).catch(() => {
      // Сеть недоступна — обновимся в следующий раз.
    });
  });

  // Когда новый worker берёт управление, перезагружаем страницу один раз.
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

/**
 * Открыт ли портал как установленное приложение.
 * Зачем проверять: на iPhone Web Push работает ТОЛЬКО в приложении с
 * домашнего экрана. В самом Safari разрешение спрашивается, человек его даёт,
 * а подписка потом падает — и он остаётся с ощущением, что всё сломано.
 * Вызывается из обработчика кнопки.
 */
function isInstalledApp() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // Старый признак самой iOS: на ней он надёжнее медиазапроса.
    window.navigator.standalone === true
  );
}

/** iPhone и iPad — у них свои правила для уведомлений. */
function isApple() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

/**
 * Оформляет подписку, когда разрешение уже получено.
 *
 * Ключ передаётся готовым: запрашивать его здесь нельзя, потому что к этому
 * моменту разрешение уже должно быть спрошено — см. обработчик нажатия ниже.
 * Вызывается только оттуда.
 */
/**
 * Дожидается, пока worker станет действующим.
 * Зачем не navigator.serviceWorker.ready: он не отклоняется никогда, и при
 * неудачной регистрации обещание висит вечно — человек остаётся без ответа.
 * Здесь ошибка регистрации доходит как ошибка.
 * Вызывается из subscribeToPush.
 */
async function activeRegistration() {
  if (!swRegistration) throw new Error('регистрация ещё не начиналась');
  const registration = await swRegistration;
  if (registration.active) return registration;

  const worker = registration.installing ?? registration.waiting;
  if (!worker) throw new Error('worker не установился');

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('worker не активировался за 10 секунд')), 10000);
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') {
        clearTimeout(timer);
        resolve();
      }
      if (worker.state === 'redundant') {
        clearTimeout(timer);
        reject(new Error('worker отвергнут браузером'));
      }
    });
  });
  return registration;
}

async function subscribeToPush(key) {
  const registration = await activeRegistration();

  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      // Без этого флага браузер разрешил бы «тихие» пуши без уведомления — и
      // отозвал бы подписку, заметив, что мы ничего не показываем.
      userVisibleOnly: true,
      applicationServerKey: keyToBytes(key)
    }));

  await request('/api/push/subscribe', { method: 'POST', body: JSON.stringify(subscription) });
}

/* --- Тема ---------------------------------------------------------------
 * По умолчанию берётся системная настройка, кнопка её перебивает. Выбор
 * хранится в браузере: сервер о нём не знает и знать не должен — это личная
 * настройка устройства, а не свойство аккаунта. */
const THEME_KEY = 'portal-theme';

/**
 * Красит строку браузера в цвет фактического фона страницы.
 * Зачем скриптом, а не двумя метками с prefers-color-scheme: часть версий
 * Safari media у theme-color игнорирует и красит бары своим цветом — тем
 * самым белым, что видно сверху и снизу экрана. Одну метку понимают все.
 * Вызывается при загрузке и при каждой смене темы.
 */
function updateThemeColor() {
  const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  const tag = document.querySelector('meta[name="theme-color"]');
  if (tag && background) tag.setAttribute('content', background);
}

function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  updateThemeColor();
}

try {
  applyTheme(localStorage.getItem(THEME_KEY));
} catch {
  // Приватное окно или запрет на хранилище: остаёмся на системной теме.
  updateThemeColor();
}

// Человек переключил тему в системе, пока страница открыта.
window
  .matchMedia('(prefers-color-scheme: dark)')
  .addEventListener('change', updateThemeColor);

/* --- Страничные обработчики ---------------------------------------------
 *
 * Всё, что привязано к узлам ВНУТРИ main. При переходе без перезагрузки
 * содержимое main подменяется целиком, узлы становятся новыми, и без
 * повторной привязки кнопки на подменённой странице оказались бы мёртвыми.
 *
 * Обработчики шапки и всего окна живут снаружи: шапка не подменяется, а
 * привязывать их заново значило бы копить их с каждым переходом. */

function initPage() {
  const notificationsButton = document.querySelector('[data-notifications]');

  // Раздел настроек без объяснения выглядит поломкой: кнопка спрятана, и почему
  // — непонятно. Чаще всего это iOS в браузере: там уведомления работают только
  // у портала, установленного на домашний экран.
  if (notificationsButton && !('Notification' in window && 'serviceWorker' in navigator)) {
    const note = document.querySelector('[data-notifications-note]');
    if (note) note.hidden = false;
  }

  if (notificationsButton && 'Notification' in window && 'serviceWorker' in navigator) {
    // Ключ забираем заранее, при загрузке страницы. Это не преждевременная
    // оптимизация, а необходимость: Safari разрешает спрашивать разрешение
    // только прямо в обработчике нажатия, а поход в сеть перед этим разрывает
    // связь с нажатием — и подписка падает. Ровно на этом мы и стояли.
    let vapidKey = null;

    request('/api/push/key')
      .then(async (answer) => {
        if (!answer?.key) return;
        vapidKey = answer.key;
        notificationsButton.hidden = false;

        const registration = await navigator.serviceWorker.getRegistration();
        if (registration && (await registration.pushManager.getSubscription())) {
          notificationsButton.title = 'Уведомления включены';
          notificationsButton.disabled = true;
        }
      })
      .catch(() => {
        // Ключей нет или сервер недоступен — кнопка так и остаётся скрытой.
      });

    notificationsButton.addEventListener('click', () => {
      if (isApple() && !isInstalledApp()) {
        toast(
          'На iPhone уведомления работают только в приложении: «Поделиться» → «На экран Домой», ' +
            'потом открыть с домашнего экрана.',
          true
        );
        reportError('push-not-standalone', new Error('открыто не как приложение'));
        return;
      }
      if (!vapidKey) {
        toast('Уведомления пока не настроены на сервере.', true);
        return;
      }

      // Вызов идёт первой строкой и без await перед ним: так браузер видит, что
      // разрешение спрашивают в ответ на нажатие человека.
      Notification.requestPermission()
        .then(async (permission) => {
          if (permission !== 'granted') {
            toast('Уведомления запрещены. Разрешить их можно в настройках браузера.', true);
            return;
          }
          await subscribeToPush(vapidKey);
          notificationsButton.title = 'Уведомления включены';
          notificationsButton.disabled = true;
          toast('Готово — уведомления о новых уроках будут приходить сюда.');
        })
        .catch((error) => {
          // Показываем текст браузера как есть: он объясняет причину точнее
          // любой нашей догадки. Тот же текст уходит в журнал сервера.
          toast(`Не удалось включить уведомления: ${error.message}`, true);
          reportError('push-subscribe', error);
        });
    });
  }

  document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const current = document.documentElement.dataset.theme || (systemDark ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Не сохранилось — тема продержится до перезагрузки страницы.
    }
  });

  /* --- Карточка урока: реакции и отзывы ----------------------------------- */

  const lessonCard = document.querySelector('[data-lesson]');
  if (lessonCard) {
    const objectId = Number(lessonCard.dataset.lesson);

    for (const button of lessonCard.querySelectorAll('[data-rating]')) {
      button.addEventListener('click', async () => {
        // Нажатие по уже отданной оценке снимает её: иначе передумать нельзя,
        // а сервер всё равно хранит одну оценку на человека.
        // Имя класса обязано совпадать с тем, что ставит вид: разъехавшись, они
        // не ломаются заметно — просто снять оценку становится нельзя, а
        // повторное нажатие ставит её заново. Так и было после чистки кириллицы.
        const isChosen = button.classList.contains('chosen');
        const answer = await request('/api/reactions', {
          method: isChosen ? 'DELETE' : 'POST',
          body: JSON.stringify({ objectType: 'lesson', objectId, kind: button.dataset.rating })
        });
        if (answer) location.reload();
      });
    }

    const form = document.querySelector('#comment-form');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('button');
      button.disabled = true;
      try {
        const answer = await request('/api/comments', {
          method: 'POST',
          body: JSON.stringify({
            objectType: 'lesson',
            objectId,
            body: new FormData(form).get('body')
          })
        });
        // Перезагружаем: отзыв скрыт до проверки, но своему автору он виден —
        // человек должен увидеть, что его слова не пропали.
        if (answer) location.reload();
      } finally {
        button.disabled = false;
      }
    });
  }

  /* --- Борд идей ----------------------------------------------------------- */

  // Счётчик правим на месте, без перезагрузки: голосуют подряд за несколько идей,
  // и перезагрузка на каждый голос сбрасывала бы прокрутку к началу списка.
  for (const button of document.querySelectorAll('[data-vote]')) {
    button.addEventListener('click', async () => {
      const isVoted = button.classList.contains('отдан');
      const answer = await request(`/api/ideas/${button.dataset.vote}/vote`, {
        method: isVoted ? 'DELETE' : 'POST'
      });
      if (!answer) return;
      const counter = button.querySelector('span');
      counter.textContent = Number(counter.textContent) + (isVoted ? -1 : 1);
      button.classList.toggle('отдан');
      button.setAttribute('aria-label', isVoted ? 'Проголосовать' : 'Отозвать голос');
    });
  }

  /* --- Источники анонсов ---------------------------------------------------- */

  const sourceForm = document.querySelector('[data-source-form]');
  sourceForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = new FormData(sourceForm);
    try {
      const answer = await request('/api/admin/news/sources', {
        method: 'POST',
        body: JSON.stringify({ title: fields.get('title'), url: fields.get('url') })
      });
      if (!answer) return;
      toast('Источник добавлен.');
      setTimeout(() => location.reload(), 900);
    } catch (error) {
      toast(`Не добавился: ${error.message}`, true);
    }
  });

  for (const toggle of document.querySelectorAll('[data-source-toggle]')) {
    toggle.addEventListener('change', async () => {
      try {
        await request(`/api/admin/news/sources/${toggle.dataset.sourceToggle}/toggle`, {
          method: 'POST',
          body: JSON.stringify({ enabled: toggle.checked })
        });
        toast(toggle.checked ? 'Источник включён.' : 'Источник выключен.');
      } catch (error) {
        // Возвращаем галку на место: показывать состояние, которого нет на
        // сервере, — врать человеку.
        toggle.checked = !toggle.checked;
        toast(`Не вышло: ${error.message}`, true);
      }
    });
  }

  for (const remove of document.querySelectorAll('[data-source-remove]')) {
    remove.addEventListener('click', async () => {
      if (!confirm('Убрать источник из списка?')) return;
      try {
        const answer = await request(`/api/admin/news/sources/${remove.dataset.sourceRemove}`, {
          method: 'DELETE'
        });
        if (!answer) return;
        location.reload();
      } catch (error) {
        toast(`Не убрался: ${error.message}`, true);
      }
    });
  }

  /* --- Новости ------------------------------------------------------------- */

  // Формы новостей живут на публичных страницах: автор пишет новость там же,
  // где её читают. Поэтому обработчик здесь, а не в скрипте кабинета.
  const newsForm = document.querySelector('[data-news-form]');
  newsForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = new FormData(newsForm);
    const button = newsForm.querySelector('button[type=submit]');
    button.disabled = true;

    try {
      const answer = await request('/api/admin/news', {
        method: 'POST',
        body: JSON.stringify({
          slug: newsForm.dataset.newsForm || null,
          title: fields.get('title'),
          body: fields.get('body')
        })
      });
      if (!answer) return;
      toast(newsForm.dataset.newsForm ? 'Новость сохранена.' : 'Новость заведена.');
      // Уходим на страницу новости: картинки добавляются там, и без перехода
      // автор не понял бы, куда идти дальше.
      setTimeout(() => (location.href = `/news/${answer.slug}`), 900);
    } catch (error) {
      toast(`Не сохранилось: ${error.message}`, true);
    } finally {
      button.disabled = false;
    }
  });

  /**
   * Свежие анонсы официальных источников.
   * Список приходит с сервера: чужие ленты из браузера не читаются. Нажатие на
   * строку кладёт заголовок анонса в поле заголовка, а ссылку — в текст, чтобы
   * новость всегда вела к первоисточнику.
   */
  const announcementsButton = document.querySelector('[data-announcements]');
  const announcementsList = document.querySelector('[data-announcements-list]');
  // Выбранный анонс: его описание и ссылка нужны, когда автор попросит написать
  // текст. Живёт до перехода на другую страницу, как и сама форма.
  let chosenAnnouncement = null;

  announcementsButton?.addEventListener('click', async () => {
    const wasText = announcementsButton.textContent;
    announcementsButton.disabled = true;
    announcementsButton.textContent = 'Смотрю…';
    // Отклик сразу, до ответа лент: сбор идёт секунды, и всё это время человек
    // должен видеть, что нажатие услышано, а не гадать, попал ли он по кнопке.
    announcementsList.innerHTML = '<p class="hint">Спрашиваю источники…</p>';
    announcementsList.hidden = false;

    try {
      const answer = await request('/api/admin/news/announcements');
      if (!answer) return;

      const when = (value) =>
        value
          ? new Date(value).toLocaleString('ru-RU', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit'
            })
          : 'без даты';

      announcementsList.innerHTML = answer.items.length
        ? `<ul>${answer.items
            .map(
              (item, index) =>
                `<li><button type="button" class="announcement" data-pick="${index}">
                   <span class="meta">${item.source} · ${when(item.publishedAt)}</span>
                   <span>${item.title}</span>
                 </button></li>`
            )
            .join('')}</ul>${
            answer.failed.length
              ? `<p class="hint danger">Не ответили: ${answer.failed.join('; ')}</p>`
              : ''
          }`
        : '<p class="hint">Свежих анонсов не нашлось.</p>';
      announcementsList.hidden = false;

      // Выбор анонса: заголовок — в заголовок, ссылка — в текст.
      for (const pick of announcementsList.querySelectorAll('[data-pick]')) {
        pick.addEventListener('click', () => {
          const item = answer.items[Number(pick.dataset.pick)];
          const form = document.querySelector('[data-news-form]');
          form.querySelector('[name=title]').value = item.title;
          // Запоминаем, из чего эта новость выросла: описание от источника
          // уходит модели вместе с заголовком, иначе ей не о чем писать.
          chosenAnnouncement = { summary: item.summary ?? '', url: item.url };
          const body = form.querySelector('[name=body]');
          if (!body.value.includes(item.url)) {
            body.value = `${body.value ? `${body.value}\n\n` : ''}Источник: ${item.url}`;
          }
          announcementsList.hidden = true;
          toast('Заголовок взят. Нажмите «Написать по заголовку» или напишите сами.');
        });
      }
    } catch (error) {
      // Причина остаётся на экране, а не только во всплывающем сообщении: оно
      // уходит через несколько секунд, а разбираться человек будет дольше.
      announcementsList.innerHTML = `<p class="hint danger">Анонсы не пришли: ${error.message}</p>`;
      toast(`Анонсы не пришли: ${error.message}`, true);
    } finally {
      announcementsButton.disabled = false;
      announcementsButton.textContent = wasText;
    }
  });

  // Текст по заголовку. Заготовка, а не готовая новость: модель знает только
  // заголовок, и подписывать её работу своим именем не глядя не стоит.
  const newsSuggest = document.querySelector('[data-news-suggest]');
  newsSuggest?.addEventListener('click', async () => {
    const form = document.querySelector('[data-news-form]');
    const title = form?.querySelector('[name=title]')?.value?.trim();
    if (!title) {
      toast('Сначала напишите заголовок — по нему и пишем.', true);
      return;
    }

    const wasText = newsSuggest.textContent;
    newsSuggest.disabled = true;
    newsSuggest.textContent = 'Пишу…';
    try {
      const answer = await request('/api/admin/news/suggest', {
        method: 'POST',
        body: JSON.stringify({
          title,
          summary: chosenAnnouncement?.summary ?? '',
          url: chosenAnnouncement?.url ?? ''
        })
      });
      if (!answer) return;
      form.querySelector('[name=body]').value = answer.body;
      toast('Текст написан. Поправьте и сохраните.');
    } catch (error) {
      toast(`Не написалось: ${error.message}`, true);
    } finally {
      newsSuggest.disabled = false;
      newsSuggest.textContent = wasText;
    }
  });

  /**
   * Запрос для рисовальщика.
   * Картинку автор рисует сам, поэтому портал отдаёт готовый текст запроса и
   * сразу кладёт его в буфер обмена: переносить руками из поля в чужой
   * рисовальщик — лишняя работа на ровном месте.
   */
  const imagePromptButton = document.querySelector('[data-image-prompt]');
  imagePromptButton?.addEventListener('click', async () => {
    const form = document.querySelector('[data-news-form]');
    const title = form?.querySelector('[name=title]')?.value?.trim();
    if (!title) {
      toast('Сначала напишите заголовок — по нему и составляем.', true);
      return;
    }

    const box = document.querySelector('[data-image-prompt-box]');
    const field = document.querySelector('[data-image-prompt-text]');
    const wasText = imagePromptButton.textContent;
    imagePromptButton.disabled = true;
    imagePromptButton.textContent = 'Составляю…';

    try {
      const answer = await request('/api/admin/news/image-prompt', {
        method: 'POST',
        body: JSON.stringify({ title, body: form.querySelector('[name=body]')?.value ?? '' })
      });
      if (!answer) return;

      field.value = answer.prompt;
      box.hidden = false;
      try {
        await navigator.clipboard.writeText(answer.prompt);
        toast('Запрос готов и скопирован — вставьте в рисовальщик.');
      } catch {
        // Буфер обмена доступен не везде: на старом браузере и по http его нет.
        // Тогда просто оставляем текст в поле — его можно выделить руками.
        toast('Запрос готов — он в поле ниже.');
      }
    } catch (error) {
      toast(`Не составилось: ${error.message}`, true);
    } finally {
      imagePromptButton.disabled = false;
      imagePromptButton.textContent = wasText;
    }
  });

  /* --- Короткие ролики ----------------------------------------------------- */

  /**
   * Загрузка файла ролика. Одним запросом: вертикалка весит десятки мегабайт,
   * и продолжение после обрыва здесь не окупается.
   * Отдельной функцией — её зовут две страницы: заведение и замена файла.
   */
  async function uploadShortFile(slug, file, note) {
    const wasText = note?.textContent;
    if (note) note.textContent = 'Загружаю…';
    const response = await fetch(`/api/upload/short/${slug}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4' },
      body: file
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      if (note) note.textContent = wasText;
      throw new Error(body.error ?? 'файл не принят');
    }
    return response.json();
  }

  // Заведение ролика: сначала карточка, потом файл. Порядок важен — файл
  // кладётся в папку ролика, а её имя знает только заведённая строка.
  const shortNew = document.querySelector('[data-short-new]');
  shortNew?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = new FormData(shortNew);
    const file = shortNew.querySelector('#short-file').files[0];
    if (!file) {
      toast('Сначала выберите файл ролика.', true);
      return;
    }

    const button = shortNew.querySelector('button[type=submit]');
    const note = shortNew.querySelector('[data-short-file-name]');
    button.disabled = true;
    try {
      const short = await request('/api/admin/shorts', {
        method: 'POST',
        body: JSON.stringify({
          title: fields.get('title'),
          description: fields.get('description')
        })
      });
      if (!short) return;
      await uploadShortFile(short.slug, file, note);
      toast('Ролик загружен.');
      location.href = `/short/${short.slug}/edit`;
    } catch (error) {
      toast(`Не загрузилось: ${error.message}`, true);
      button.disabled = false;
    }
  });

  // Имя выбранного файла: без него человек не знает, выбрал он что-нибудь или
  // промахнулся мимо диалога.
  const shortFileInput = document.querySelector('#short-file');
  shortFileInput?.addEventListener('change', async () => {
    const file = shortFileInput.files[0];
    const note = document.querySelector('[data-short-file-name]');
    if (note && file) note.textContent = file.name;

    // На странице правки файл заменяется сразу: заводить нечего, ролик уже есть.
    const slug = shortFileInput.dataset.shortFile;
    if (!slug || !file) return;
    try {
      await uploadShortFile(slug, file, note);
      toast('Файл заменён.');
      setTimeout(() => location.reload(), 900);
    } catch (error) {
      toast(`Не загрузилось: ${error.message}`, true);
    }
  });

  const shortForm = document.querySelector('[data-short-form]');
  shortForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = new FormData(shortForm);
    const button = shortForm.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      const answer = await request('/api/admin/shorts', {
        method: 'POST',
        body: JSON.stringify({
          slug: shortForm.dataset.shortForm,
          title: fields.get('title'),
          description: fields.get('description')
        })
      });
      if (!answer) return;
      toast('Ролик сохранён.');
    } catch (error) {
      toast(`Не сохранилось: ${error.message}`, true);
    } finally {
      button.disabled = false;
    }
  });

  const shortPublish = document.querySelector('[data-short-publish]');
  shortPublish?.addEventListener('click', async () => {
    const publish = shortPublish.value === 'yes';
    shortPublish.disabled = true;
    try {
      const answer = await request(
        `/api/admin/shorts/${shortPublish.dataset.shortPublish}/publish`,
        { method: 'POST', body: JSON.stringify({ publish }) }
      );
      if (!answer) return;
      toast(publish ? 'Ролик опубликован.' : 'Ролик вернулся в черновики.');
      setTimeout(() => location.reload(), 900);
    } catch (error) {
      toast(`Не получилось: ${error.message}`, true);
      shortPublish.disabled = false;
    }
  });

  for (const button of document.querySelectorAll('[data-short-post]')) {
    button.addEventListener('click', async () => {
      const wasText = button.textContent;
      button.disabled = true;
      button.textContent = 'Отправляю…';
      try {
        const answer = await request(
          `/api/admin/shorts/${button.value}/publish/${button.dataset.shortPost}`,
          { method: 'POST' }
        );
        if (!answer) return;
        toast('Ролик поехал в канал. Файл идёт минуту-другую.');
        setTimeout(() => location.reload(), 2000);
      } catch (error) {
        toast(`Не отправилось: ${error.message}`, true);
        button.disabled = false;
        button.textContent = wasText;
      }
    });
  }

  const shortDelete = document.querySelector('[data-short-delete]');
  shortDelete?.addEventListener('click', async () => {
    if (!confirm('Удалить ролик? Нарезка урока, если он из урока, останется на месте.')) return;
    shortDelete.disabled = true;
    try {
      const answer = await request(`/api/admin/shorts/${shortDelete.dataset.shortDelete}`, {
        method: 'DELETE'
      });
      if (!answer) return;
      location.href = '/shorts';
    } catch (error) {
      toast(`Не удалилось: ${error.message}`, true);
      shortDelete.disabled = false;
    }
  });

  /* --- Серия уроков ------------------------------------------------------- */

  // Правка названия и описания серии. Форма живёт на самой странице серии:
  // отдельного экрана у неё нет, и заводить его ради двух полей незачем.
  const seriesForm = document.querySelector('[data-series-form]');
  seriesForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = new FormData(seriesForm);
    const button = seriesForm.querySelector('button[type=submit]');
    const wasText = button.textContent;
    button.disabled = true;
    button.textContent = 'Сохраняю…';
    try {
      const answer = await request('/api/admin/series', {
        method: 'POST',
        body: JSON.stringify({
          slug: seriesForm.dataset.seriesForm,
          title: fields.get('title'),
          description: fields.get('description')
        })
      });
      if (!answer) return;
      toast('Серия сохранена.');
      setTimeout(() => location.reload(), 900);
    } catch (error) {
      toast(`Не сохранилось: ${error.message}`, true);
      button.disabled = false;
      button.textContent = wasText;
    }
  });

  const seriesDelete = document.querySelector('[data-series-delete]');
  seriesDelete?.addEventListener('click', async () => {
    // Спрашиваем, но говорим и то, что уроки останутся: без этого кнопка рядом
    // со списком уроков выглядит так, будто удалит и их.
    if (!confirm('Удалить серию? Уроки останутся, они просто перестанут быть связанными.')) {
      return;
    }
    seriesDelete.disabled = true;
    try {
      const answer = await request(`/api/admin/series/${seriesDelete.dataset.seriesDelete}`, {
        method: 'DELETE'
      });
      if (!answer) return;
      location.href = '/lessons';
    } catch (error) {
      toast(`Не удалилось: ${error.message}`, true);
      seriesDelete.disabled = false;
    }
  });

  // Порядок уроков — стрелками. Обе кнопки перебираются одним обработчиком:
  // разница между ними в одном слове, и два почти одинаковых куска однажды
  // разойдутся.
  for (const button of document.querySelectorAll('[data-series-move]')) {
    button.addEventListener('click', async () => {
      const form = document.querySelector('[data-series-form]');
      button.disabled = true;
      try {
        const answer = await request(`/api/admin/series/${form?.dataset.seriesForm}/move`, {
          method: 'POST',
          body: JSON.stringify({
            lessonSlug: button.value,
            direction: button.dataset.seriesMove
          })
        });
        if (!answer) return;
        // Порядок ведёт сервер: перечитываем, а не переставляем строки сами —
        // иначе список на экране разойдётся с тем, что в базе.
        location.reload();
      } catch (error) {
        toast(`Не переставилось: ${error.message}`, true);
        button.disabled = false;
      }
    });
  }

  // Выпуск новости и возврат её в черновики — одна кнопка: что она сделает,
  // написано на ней самой и лежит в value.
  const newsPublish = document.querySelector('[data-news-publish]');
  newsPublish?.addEventListener('click', async () => {
    const publish = newsPublish.value === 'yes';
    const wasText = newsPublish.textContent;
    newsPublish.disabled = true;
    newsPublish.textContent = publish ? 'Публикую…' : 'Убираю…';
    try {
      const answer = await request(`/api/admin/news/${newsPublish.dataset.newsPublish}/publish`, {
        method: 'POST',
        body: JSON.stringify({ publish })
      });
      if (!answer) return;
      toast(publish ? 'Новость опубликована.' : 'Новость вернулась в черновики.');
      // Кнопки каналов зависят от состояния новости — перечитываем страницу.
      setTimeout(() => location.reload(), 900);
    } catch (error) {
      toast(`Не получилось: ${error.message}`, true);
      newsPublish.disabled = false;
      newsPublish.textContent = wasText;
    }
  });

  // Пост о новости в канал. Кнопки перебираются списком: площадок будет
  // больше, и обработчик на каждую значит однажды забыть про новую.
  for (const button of document.querySelectorAll('[data-news-post]')) {
    button.addEventListener('click', async () => {
      const wasText = button.textContent;
      button.disabled = true;
      button.textContent = 'Отправляю…';
      try {
        const answer = await request(
          `/api/admin/news/${button.value}/publish/${button.dataset.newsPost}`,
          { method: 'POST' }
        );
        if (!answer) return;
        toast('Пост поехал в канал.');
        // Отправку ведёт воркер, а не браузер: состояние покажет перечитанная
        // страница.
        setTimeout(() => location.reload(), 1500);
      } catch (error) {
        toast(`Не отправилось: ${error.message}`, true);
        button.disabled = false;
        button.textContent = wasText;
      }
    });
  }

  // Правка уже отправленного поста. Отдельными кнопками от отправки: одна
  // создаёт пост, другая переписывает, и путать их нельзя.
  for (const button of document.querySelectorAll('[data-news-refresh]')) {
    button.addEventListener('click', async () => {
      const wasText = button.textContent;
      button.disabled = true;
      button.textContent = 'Обновляю…';
      try {
        const answer = await request(
          `/api/admin/news/${button.value}/publish/${button.dataset.newsRefresh}/refresh`,
          { method: 'POST' }
        );
        if (!answer) return;
        toast('Пост в канале обновляется.');
        setTimeout(() => location.reload(), 1500);
      } catch (error) {
        toast(`Не обновилось: ${error.message}`, true);
        button.disabled = false;
        button.textContent = wasText;
      }
    });
  }

  const newsDelete = document.querySelector('[data-news-delete]');
  newsDelete?.addEventListener('click', async () => {
    // Спрашиваем: удаление новости необратимо, а кнопка стоит рядом с
    // «Сохранить».
    if (!confirm('Удалить новость вместе с картинками?')) return;
    newsDelete.disabled = true;
    try {
      const answer = await request(`/api/admin/news/${newsDelete.dataset.newsDelete}`, {
        method: 'DELETE'
      });
      if (!answer) return;
      location.href = '/news';
    } catch (error) {
      toast(`Не удалилось: ${error.message}`, true);
      newsDelete.disabled = false;
    }
  });

  const newsImage = document.querySelector('[data-news-image]');
  newsImage?.addEventListener('change', async () => {
    const file = newsImage.files[0];
    if (!file) return;
    const label = document.querySelector('label[for="news-image"]');
    const wasText = label?.textContent;
    if (label) label.textContent = 'Загружаю…';

    try {
      // Тип сервер определяет по первым байтам, а не по заголовку запроса.
      const response = await fetch(`/api/upload/news-image/${newsImage.dataset.newsImage}`, {
        method: 'PUT',
        body: file
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? `сервер ответил ${response.status}`);
      }
      location.reload();
    } catch (error) {
      toast(`Картинка не загрузилась: ${error.message}`, true);
      if (label) label.textContent = wasText;
    }
  });

  /* --- Ключи приложения площадки ------------------------------------------- */

  // Форма отправляется через API, а не сама собой: без перехвата браузер уйдёт
  // GET-ом и увезёт секрет в адресную строку — то есть в историю браузера и в
  // журнал сервера.
  // Ключи площадок коротких видео. Форма одна на площадку, обработчик общий:
  // площадок две, а разница между ними — одно слово в адресе.
  for (const form of document.querySelectorAll('[data-short-platform]')) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const fields = new FormData(form);
      const button = form.querySelector('button[type=submit]');
      button.disabled = true;
      try {
        const answer = await request(
          `/api/integrations/${form.dataset.shortPlatform}/app`,
          {
            method: 'POST',
            body: JSON.stringify({
              clientId: fields.get('clientId'),
              clientSecret: fields.get('clientSecret')
            })
          }
        );
        if (!answer) return;
        toast('Ключи сохранены.');
        setTimeout(() => location.reload(), 1200);
      } catch (error) {
        toast(`Не сохранилось: ${error.message}`, true);
      } finally {
        button.disabled = false;
      }
    });
  }

  const youtubeAppForm = document.querySelector('[data-youtube-app]');
  youtubeAppForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = new FormData(youtubeAppForm);
    const button = youtubeAppForm.querySelector('button[type=submit]');
    button.disabled = true;

    try {
      const answer = await request('/api/integrations/youtube/app', {
        method: 'POST',
        body: JSON.stringify({
          clientId: fields.get('clientId'),
          clientSecret: fields.get('clientSecret'),
          mode: fields.get('mode')
        })
      });
      if (!answer) return;
      toast('Ключи сохранены.');
      // Кнопка подключения появляется только у настроенной площадки, поэтому
      // страницу перечитываем: иначе автор не увидит, что делать дальше.
      setTimeout(() => location.reload(), 1200);
    } catch (error) {
      toast(`Не сохранилось: ${error.message}`, true);
    } finally {
      button.disabled = false;
    }
  });

  // Настройки каналов: адрес канала и, у MAX, токен бота. Форма отправляется
  // через API — без перехвата браузер увёз бы токен в адресную строку.
  for (const form of document.querySelectorAll('[data-channel-app]')) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const fields = new FormData(form);
      const button = form.querySelector('button[type=submit]');
      button.disabled = true;

      try {
        const answer = await request(`/api/integrations/channel/${form.dataset.channelApp}`, {
          method: 'POST',
          body: JSON.stringify({
            channel: fields.get('channel'),
            token: fields.get('token') ?? ''
          })
        });
        if (!answer) return;
        toast('Канал сохранён.');
        setTimeout(() => location.reload(), 1200);
      } catch (error) {
        toast(`Не сохранилось: ${error.message}`, true);
      } finally {
        button.disabled = false;
      }
    });
  }

  // Возврат к боту портала: убрать свой токен иначе нечем — показать его
  // нельзя, а пустое поле означает «не менять».
  const channelReset = document.querySelector('[data-channel-reset]');
  channelReset?.addEventListener('click', async () => {
    channelReset.disabled = true;
    try {
      const answer = await request(
        `/api/integrations/channel/${channelReset.dataset.channelReset}/reset`,
        { method: 'POST' }
      );
      if (!answer) return;
      toast('Постить будет бот портала.');
      setTimeout(() => location.reload(), 1200);
    } catch (error) {
      toast(`Не получилось: ${error.message}`, true);
      channelReset.disabled = false;
    }
  });

  const youtubeDisconnect = document.querySelector('[data-youtube-disconnect]');
  youtubeDisconnect?.addEventListener('click', async () => {
    youtubeDisconnect.disabled = true;
    try {
      const answer = await request('/api/integrations/youtube/disconnect', { method: 'POST' });
      if (!answer) return;
      toast('Канал отключён. Ключи приложения остались.');
      setTimeout(() => location.reload(), 1200);
    } catch (error) {
      toast(`Не отключилось: ${error.message}`, true);
      youtubeDisconnect.disabled = false;
    }
  });

  const ideaForm = document.querySelector('[data-feedback-form]');
  ideaForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(ideaForm);
    const answer = await request('/api/ideas', {
      method: 'POST',
      body: JSON.stringify({
        title: data.get('title'),
        body: data.get('body'),
        // Вид выбирает человек: идея, пожелание или отзыв. Подделанное значение
        // сервер превратит в идею, а не в ошибку.
        kind: data.get('kind') ?? 'idea'
      })
    });
    // Здесь перезагрузка уместна: идея видна сразу, и человек должен увидеть её
    // в списке на своём месте — по числу голосов, а не там, где он ожидал.
    if (answer) location.reload();
  });

}

initPage();

/* --- Переходы без перезагрузки -------------------------------------------
 * Страницы по-прежнему собираются на сервере: поисковик их видит, мессенджер
 * разворачивает превью, без скрипта портал работает. Здесь только подмена
 * содержимого — и ради неё шапка не перерисовывается, поэтому летящая ракета
 * долетает, а не начинает с нуля. */
startNavigation({ onNavigated: initPage });

/* --- Меню в шапке --------------------------------------------------------
 * Само меню работает без скрипта: это details, и оно откроется, даже если этот
 * файл не загрузился. Здесь только вежливость — закрыть его, когда человек
 * ткнул мимо. */
const navMenu = document.querySelector('[data-nav-menu]');
if (navMenu) {
  // Список разделов лежит соседом, а не внутри меню, поэтому «мимо» — это мимо
  // обоих. Без учёта списка меню закрывалось бы от нажатия по своему же пункту
  // раньше, чем срабатывал его обработчик.
  const panel = navMenu.nextElementSibling;
  document.addEventListener('click', (event) => {
    if (!navMenu.open) return;
    const inside = navMenu.contains(event.target) || panel?.contains(event.target);
    if (!inside) navMenu.open = false;
  });
  // Escape закрывает меню там, где есть клавиатура: на телефоне его нет, а на
  // ноутбуке это первое, что нажимают.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && navMenu.open) navMenu.open = false;
  });
}

/* --- Летающий знак -------------------------------------------------------
 *
 * Ракета живёт в шапке, а по нажатию срывается с места, летит к тому, по чему
 * нажали, и возвращается на стоянку. Нажали второй раз на лету — разворот и
 * полёт к новой цели; цель уехала прокруткой — сразу домой. Логика заказчика.
 *
 * Расчёты живут в rocket-flight.js: их можно проверить без браузера, и они
 * проверены. Здесь только то, для чего нужны настоящие узлы страницы. */
import { centerOf, flightPlan, restingTransform, isOnScreen, flightTarget } from './rocket-flight.js';

const rocketLayer = document.querySelector('[data-rocket]');
const rocketHome = document.querySelector('.logo .rocket');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

if (rocketLayer && rocketHome && !reducedMotion.matches) {
  // Куда летим: узел страницы или null — значит домой, на стоянку.
  let target = null;
  let goingHome = false;
  let flight = null;
  // Куда ракета смотрит сейчас. Нужен для разворота: без него каждый новый
  // курс начинался бы с носа вверх, и ракета дёргалась бы перед вылетом.
  let heading = 0;

  const homePoint = () => centerOf(rocketHome.getBoundingClientRect());
  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

  /**
   * Размер знака без учёта наплыва.
   * Мерить надо именно так: в середине пути ракета крупнее, и снятый в этот
   * миг размер сдвинул бы её на пол-корпуса при следующем перелёте.
   */
  const size = () => ({ width: rocketLayer.offsetWidth, height: rocketLayer.offsetHeight });

  /**
   * Где ракета видна СЕЙЧАС — с учётом того, что она может быть в полёте.
   * От этой точки считается новый курс: иначе нажатие на лету заставляло бы её
   * сперва долететь до старой цели.
   */
  const currentPoint = () => centerOf(rocketLayer.getBoundingClientRect());

  const land = () => {
    target = null;
    goingHome = false;
    flight = null;
    rocketLayer.hidden = true;
    rocketHome.classList.remove('away');
  };

  /** Ведёт ракету в точку. onDone вызывается только при долёте, не при отмене. */
  const flyTo = (point, onDone) => {
    const from = currentPoint();
    // Отмену делаем ПОСЛЕ замера: отменённая анимация возвращает узел в
    // исходное положение, и замер после неё дал бы старую точку.
    if (flight) flight.cancel();
    // Закрепляем нынешнее положение и нынешний угол, иначе следующий кадр
    // начнётся со стоянки носом вверх — ракета прыгнет и дёрнется.
    rocketLayer.style.transform = restingTransform(from, size(), heading);

    const plan = flightPlan({ from, to: point, size: size(), fromAngle: heading });
    heading = plan.angle;

    flight = rocketLayer.animate(plan.keyframes, {
      duration: plan.duration,
      fill: 'forwards'
    });
    flight.onfinish = onDone;
  };

  const flyHome = () => {
    target = null;
    goingHome = true;
    flyTo(homePoint(), land);
  };

  /** Ставит ракету на стоянку без движения — с этого начинается любой вылет. */
  const takeOff = () => {
    // Показать раньше, чем мерить: у спрятанного узла размеры нулевые, и
    // ракета встала бы на пол-корпуса мимо стоянки.
    rocketLayer.hidden = false;
    rocketHome.classList.add('away');
    // На стоянке ракета стоит ровно: с ней в шапке сверяется глаз, и
    // накренённый знак читается как сбой.
    heading = 0;
    rocketLayer.style.transform = restingTransform(homePoint(), size(), heading);
  };

  document.addEventListener('click', (event) => {
    const found = flightTarget(event.target);
    if (!found) return;

    if (rocketLayer.hidden) takeOff();
    target = found;
    goingHome = false;
    // Долетели до цели — домой. Нажали ещё раз по пути — этот обработчик не
    // сработает: анимация будет отменена, а отменённая не завершается.
    flyTo(centerOf(found.getBoundingClientRect()), flyHome);
  });

  // Цель уехала прокруткой — разворачиваемся домой, не дожидаясь прилёта.
  window.addEventListener(
    'scroll',
    () => {
      if (!target || goingHome) return;
      if (!isOnScreen(target.getBoundingClientRect(), viewport())) flyHome();
    },
    { passive: true }
  );
}
