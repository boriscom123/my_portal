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

  const ideaForm = document.querySelector('#idea-form');
  ideaForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(ideaForm);
    const answer = await request('/api/ideas', {
      method: 'POST',
      body: JSON.stringify({ title: data.get('title'), body: data.get('body') })
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
