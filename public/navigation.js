/* Переходы между страницами без перезагрузки.
 *
 * Задача — убрать мигание при переходе по ссылке, не отказываясь от серверного
 * рендера. Страницы по-прежнему собираются на сервере: поисковик их видит,
 * мессенджер разворачивает превью, без скрипта портал работает. Здесь только
 * подмена содержимого у того, у кого скрипт есть.
 *
 * Ссылки остаются настоящими ссылками: средняя кнопка мыши, «открыть в новой
 * вкладке» и переход без скрипта работают сами собой, потому что мы лишь
 * перехватываем обычное нажатие и отменяем его.
 *
 * Шапка при этом не перерисовывается — ради этого всё и затевалось: летящая
 * ракета долетает, а не начинает с нуля на новой странице.
 * Подключается из public/app.js.
 */

/**
 * Брать ли этот переход на себя.
 *
 * Отказываемся во всех случаях, где человек попросил именно обычное поведение
 * браузера: другая вкладка, скачивание, чужой сайт, нажатие с клавишей.
 * Вынесено отдельно ради проверки без браузера — здесь легко забыть случай, и
 * забытый ломается тихо.
 */
export function shouldHandle(anchor, event, location) {
  if (!anchor || !anchor.href) return false;
  // Не левая кнопка, либо нажатие с клавишей: человек просит новую вкладку или
  // сохранение, и мешать ему нельзя.
  if (event.defaultPrevented) return false;
  if (event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;

  if (anchor.target && anchor.target !== '_self') return false;
  if (anchor.hasAttribute('download')) return false;
  // Явная просьба не вмешиваться: файлы буфера, выход, чужие переходы.
  if (anchor.dataset.fullLoad !== undefined) return false;

  const url = new URL(anchor.href, location.href);
  if (url.origin !== location.origin) return false;
  // Тот же адрес с якорем — это прокрутка внутри страницы, а не переход.
  if (url.pathname === location.pathname && url.search === location.search && url.hash) {
    return false;
  }
  // Файлы отдаём браузеру: их он умеет показывать и скачивать сам.
  if (/^\/(media|icons|fonts)\//.test(url.pathname)) return false;

  return true;
}

/**
 * Достаёт из полученной страницы то, что подменяем.
 * Заголовок нужен вкладке и истории браузера, а обновление — страницам, что
 * перечитывают себя сами: без него кабинет перестал бы показывать ход работы.
 */
export function extractPage(html, parser = new DOMParser()) {
  const document_ = parser.parseFromString(html, 'text/html');
  const main = document_.querySelector('main');
  if (!main) return null;

  const refresh = document_.querySelector('meta[http-equiv="refresh"]');
  return {
    main,
    title: document_.title,
    refreshSeconds: refresh ? Number(refresh.getAttribute('content')) : null
  };
}

/**
 * Включает переходы без перезагрузки.
 *
 * onNavigated вызывается после каждой подмены: страничные обработчики
 * привязаны к узлам, а узлы теперь новые — без повторной привязки кнопки на
 * подменённой странице оказались бы мёртвыми.
 */
/**
 * Запускает скрипты подменённой страницы.
 *
 * Скрипт, попавший в разметку подменой, браузер не выполняет — это его защита,
 * и обходить её вставкой нового узла незачем. Модуль подгружаем сами, а его
 * initPage вызываем явно: при втором заходе на ту же страницу модуль уже в
 * памяти и повторно не выполнится, поэтому одной загрузки мало.
 *
 * Без этого кабинет открывался бы мёртвым: страница есть, а ничего не
 * нажимается.
 */
async function runPageModules(root) {
  for (const script of root.querySelectorAll('script[type="module"][src]')) {
    try {
      const module = await import(new URL(script.getAttribute('src'), location.href).href);
      module.initPage?.();
    } catch (error) {
      console.error(`Скрипт страницы не подключился: ${error.message}`);
    }
  }
}

export function startNavigation({ onNavigated } = {}) {
  const main = () => document.querySelector('main');
  if (!main() || !window.history?.pushState) return;

  let refreshTimer = null;
  let pending = null;

  const applyRefresh = (seconds) => {
    clearTimeout(refreshTimer);
    // Страницы кабинета перечитывают себя, пока идёт обработка. При обычной
    // загрузке это делает метка в голове документа, но голову мы не подменяем.
    if (seconds > 0) refreshTimer = setTimeout(() => location.reload(), seconds * 1000);
  };

  async function show(url, { push }) {
    // Отменяем прошлый запрос: человек мог нажать вторую ссылку, не дождавшись
    // первой, и вернувшийся ответ подменил бы уже не ту страницу.
    pending?.abort();
    pending = new AbortController();

    let page;
    try {
      const response = await fetch(url, {
        signal: pending.signal,
        headers: { Accept: 'text/html' }
      });
      if (!response.ok) throw new Error(String(response.status));
      const type = response.headers.get('content-type') ?? '';
      if (!type.includes('text/html')) throw new Error(type);
      page = extractPage(await response.text());
      if (!page) throw new Error('на странице нет содержимого');
    } catch (error) {
      if (error.name === 'AbortError') return;
      // Не смогли — отдаём переход браузеру. Он справится в любом случае, а
      // человек не должен упереться в ссылку, которая «не работает».
      location.href = url;
      return;
    }

    if (push) history.pushState({}, '', url);
    document.title = page.title;
    main().replaceWith(page.main);
    applyRefresh(page.refreshSeconds);
    // Новая страница начинается сверху — как при обычной загрузке.
    window.scrollTo({ top: 0 });
    onNavigated?.();
    await runPageModules(page.main);
  }

  document.addEventListener('click', (event) => {
    const anchor = event.target.closest?.('a[href]');
    if (!shouldHandle(anchor, event, location)) return;
    event.preventDefault();
    show(anchor.href, { push: true });
  });

  // Кнопки «назад» и «вперёд»: без этого история браузера ведёт на пустоту.
  window.addEventListener('popstate', () => show(location.href, { push: false }));
}
