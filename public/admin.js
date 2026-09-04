/* Кабинет автора: загрузка исходника.
 *
 * Задача — переслать файл по частям и показать, сколько уже ушло. Зачем не
 * одним запросом: гигабайтный файл рвётся на первой потере связи, и повтор с
 * нуля стоит человеку часа.
 * Подключается из src/views/admin-upload.js.
 */
import { toast, request } from './app.js';

/**
 * Отправляет файл кусками, продолжая с места обрыва.
 * onProgress получает долю от 0 до 1 — ею живёт полоса выполнения.
 * Вызывается из обработчика формы ниже.
 */
export async function uploadFile(file, lessonId, onProgress) {
  const init = await request('/api/upload/init', {
    method: 'POST',
    body: JSON.stringify({ lessonId, fileName: file.name, bytes: file.size })
  });
  if (!init) return null;

  const total = Math.ceil(file.size / init.chunkSize);
  // Уже принятые куски пропускаем: это и есть продолжение после обрыва.
  const done = new Set(init.received ?? []);

  for (let index = 0; index < total; index += 1) {
    if (done.has(index)) {
      onProgress((index + 1) / total);
      continue;
    }
    const from = index * init.chunkSize;
    const response = await fetch(`/api/upload/${init.uploadId}/${index}`, {
      method: 'PUT',
      body: file.slice(from, from + init.chunkSize)
    });
    if (!response.ok) throw new Error(`кусок ${index + 1} из ${total} не принят`);
    onProgress((index + 1) / total);
  }

  const finished = await fetch(`/api/upload/${init.uploadId}/finish`, { method: 'POST' });
  if (!finished.ok) throw new Error('файл не собрался на сервере');
  return finished.json();
}

const form = document.querySelector('#upload-form');
form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = form.querySelector('input[type=file]').files[0];
  const lessonId = Number(form.querySelector('select').value);
  if (!file || !lessonId) {
    toast('Выберите урок и файл.', true);
    return;
  }

  const status = document.querySelector('#upload-status');
  const progress = document.querySelector('#upload-progress');
  const button = form.querySelector('button');
  button.disabled = true;
  progress.hidden = false;

  try {
    await uploadFile(file, lessonId, (share) => {
      progress.value = Math.round(share * 100);
      status.textContent = `Загружено ${progress.value}%`;
    });
    status.textContent = 'Загружено. Урок ушёл в обработку.';
    toast('Файл принят, обработка началась.');
  } catch (error) {
    status.textContent = `Не дошло: ${error.message}`;
    // Про продолжение говорим прямо: иначе человек начнёт всё заново, хотя
    // сервер уже держит принятые куски.
    toast(
      `Загрузка прервалась: ${error.message}. Выберите тот же файл ещё раз — продолжим с места обрыва.`,
      true
    );
  } finally {
    button.disabled = false;
  }
});

/* --- Подключение Яндекс Диска ------------------------------------------- */

// Подключение идёт копированием кода, а не возвратом на наш адрес: в
// приложении заказчика адрес возврата поменять нельзя. Для одного человека
// это одно копирование раз в несколько месяцев.
const diskCodeForm = document.querySelector('#disk-code-form');
diskCodeForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = new FormData(diskCodeForm).get('code');
  const button = diskCodeForm.querySelector('button');
  button.disabled = true;
  try {
    const answer = await request('/api/integrations/yandex-disk/code', {
      method: 'POST',
      body: JSON.stringify({ code })
    });
    if (answer) {
      toast('Диск подключён.');
      location.reload();
    }
  } catch (error) {
    toast(`Не подключилось: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
});

/* --- Выбор файла с Диска ------------------------------------------------- */

const diskFiles = document.querySelector('#disk-files');
if (diskFiles) {
  /** Размер человеку: гигабайты, а не байты. */
  const humanSize = (bytes) => `${(bytes / 1024 / 1024 / 1024).toFixed(2)} ГБ`;

  request('/api/integrations/yandex-disk/files?path=disk:/')
    .then((answer) => {
      if (!answer) return;
      if (!answer.files.length) {
        diskFiles.innerHTML = '<li class="hint">В корне Диска видео не нашлось.</li>';
        return;
      }
      diskFiles.innerHTML = answer.files
        .map(
          (file) => `<li class="form-row">
            <span>${file.name} <span class="meta">${humanSize(file.bytes)}</span></span>
            <button class="button" type="button" data-disk-path="${file.path}">В обработку</button>
          </li>`
        )
        .join('');
    })
    .catch((error) => {
      diskFiles.innerHTML = `<li class="hint">Список не читается: ${error.message}</li>`;
    });

  diskFiles.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-disk-path]');
    if (!button) return;
    const lessonId = Number(document.querySelector('#upload-form select').value);
    if (!lessonId) {
      toast('Сначала выберите урок.', true);
      return;
    }
    button.disabled = true;
    const answer = await request('/api/upload/from-disk', {
      method: 'POST',
      body: JSON.stringify({ lessonId, diskPath: button.dataset.diskPath })
    });
    if (answer) toast('Файл забирается с Диска. Обработка начнётся сама.');
  });
}

/* --- Экран проверки урока ------------------------------------------------ */

// Публикация и сохранение черновика — одна форма с двумя кнопками: тексты
// автор правит одни и те же, разница только в том, видит ли их зритель.
const reviewForm = document.querySelector('[data-approve]');
reviewForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const publish = event.submitter?.value === 'yes';
  const data = new FormData(reviewForm);
  const buttons = reviewForm.querySelectorAll('button');
  buttons.forEach((button) => (button.disabled = true));

  try {
    const answer = await request(`/api/admin/lessons/${reviewForm.dataset.approve}/approve`, {
      method: 'POST',
      body: JSON.stringify({
        title: data.get('title'),
        description: data.get('description'),
        tags: data.get('tags'),
        publish
      })
    });
    if (answer) {
      toast(publish ? 'Урок опубликован, подписчики получат уведомление.' : 'Черновик сохранён.');
      if (publish) location.href = `/lesson/${answer.lesson.slug}`;
    }
  } finally {
    buttons.forEach((button) => (button.disabled = false));
  }
});

// Повтор упавшего шага. Что именно повторяется, решает сервер по записанной
// упавшей задаче — клиент не угадывает имя шага.
const retryButton = document.querySelector('[data-retry]');
retryButton?.addEventListener('click', async () => {
  retryButton.disabled = true;
  const answer = await request(`/api/admin/lessons/${retryButton.dataset.retry}/retry`, {
    method: 'POST'
  });
  if (answer) {
    toast(`Шаг «${answer.step}» запущен заново.`);
    // Состояние урока меняет воркер, а не браузер: перечитываем страницу,
    // чтобы автор увидел «обрабатывается», а не старую надпись про падение.
    setTimeout(() => location.reload(), 1500);
  } else {
    retryButton.disabled = false;
  }
});

/* --- Настройки подготовки урока ------------------------------------------ */

// Вид подписей и монтаж — решения автора, а не разработчика. Пересборка идёт
// отдельной кнопкой: она занимает у сервера полчаса.
/**
 * Отвечает нажатием на самой кнопке, а не только всплывающим сообщением.
 * Всплывающее висит внизу экрана, а человек в этот момент смотрит на кнопку —
 * на длинной странице он его просто не видит и жмёт второй раз.
 */
async function withButtonState(button, working, done, action) {
  const wasText = button.textContent;
  button.disabled = true;
  button.textContent = working;
  try {
    await action();
    button.textContent = done;
    // Возвращаем подпись, но не сразу: иначе «Сохранено» мелькает и его не
    // успевает заметить даже тот, кто смотрит прямо на кнопку.
    setTimeout(() => {
      button.textContent = wasText;
      button.disabled = false;
    }, 1600);
  } catch (error) {
    button.textContent = wasText;
    button.disabled = false;
    throw error;
  }
}

const settingsForm = document.querySelector('[data-settings]');
settingsForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(settingsForm);
  const rebuild = event.submitter?.value === 'yes';
  const pressed = event.submitter ?? settingsForm.querySelector('button');
  const other = [...settingsForm.querySelectorAll('button')].filter((b) => b !== pressed);
  other.forEach((button) => (button.disabled = true));

  try {
    await withButtonState(
      pressed,
      rebuild ? 'Запускаю…' : 'Сохраняю…',
      rebuild ? 'Запущено' : 'Сохранено',
      async () => {
        const answer = await request(
          `/api/admin/lessons/${settingsForm.dataset.settings}/settings`,
          {
            method: 'POST',
            body: JSON.stringify({
              subtitleOutline: data.get('subtitleOutline'),
              subtitleColor: data.get('subtitleColor'),
              cutPauses: data.get('cutPauses') === 'on',
              minPauseSeconds: data.get('minPauseSeconds'),
              rebuild
            })
          }
        );
        if (!answer) return;
        toast(
          rebuild
            ? 'Пересборка запущена. Монтаж часовой записи занимает около получаса.'
            : 'Настройки сохранены. Применятся при следующей сборке.'
        );
        // Страница перечитывается, чтобы кнопка пересборки стала выключенной:
        // её состояние приходит с сервера, а не угадывается здесь.
        if (rebuild) setTimeout(() => location.reload(), 1600);
      }
    );
  } catch (error) {
    // Без этого неудачное сохранение не показывало вообще ничего: request
    // бросает, обработчик молчал, и человек видел кнопку как ни в чём не бывало.
    toast(`Не сохранилось: ${error.message}`, true);
  } finally {
    if (!rebuild) other.forEach((button) => (button.disabled = false));
  }
});

/* --- Правка титров ------------------------------------------------------- */

// Распознавание ошибается в именах и терминах. Отправляем только изменённые
// реплики: на часовом уроке их две с лишним сотни, и слать все — это мегабайт
// ради одной поправленной строки.
const transcriptForm = document.querySelector('[data-transcript]');
if (transcriptForm) {
  const original = new Map(
    [...transcriptForm.querySelectorAll('[data-segment]')].map((input) => [
      input.dataset.segment,
      input.value
    ])
  );

  transcriptForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const changed = [...transcriptForm.querySelectorAll('[data-segment]')]
      .filter((input) => input.value !== original.get(input.dataset.segment))
      .map((input) => ({ id: Number(input.dataset.segment), text: input.value }));

    if (!changed.length) {
      toast('Ничего не поменялось.');
      return;
    }

    const button = event.submitter ?? transcriptForm.querySelector('button');
    try {
      await withButtonState(button, 'Сохраняю…', 'Сохранено', async () => {
        const answer = await request(
          `/api/admin/lessons/${transcriptForm.dataset.transcript}/transcript`,
          { method: 'POST', body: JSON.stringify({ segments: changed }) }
        );
        if (!answer) return;
        for (const input of transcriptForm.querySelectorAll('[data-segment]')) {
          original.set(input.dataset.segment, input.value);
        }
        toast(
          `Поправлено реплик: ${answer.changed}. Субтитры пересобраны. ` +
            'В вертикальные ролики правка попадёт после пересборки.'
        );
      });
    } catch (error) {
      toast(`Не сохранилось: ${error.message}`, true);
    }
  });
}

/* --- Заполнение полей из расшифровки ------------------------------------- */

// Заготовка, а не готовый текст: модели у портала нет, поэтому поля
// заполняются извлечённым из расшифровки, и правит их автор.
const autofillButton = document.querySelector('[data-autofill]');

/** Ждёт готовую заготовку, переспрашивая. null — не дождались. */
async function waitForSuggestion(slug, seconds = 300) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    // Переспрашиваем раз в три секунды: модель отвечает за минуту с лишним, и
    // чаще спрашивать незачем.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const answer = await request(`/api/admin/lessons/${slug}/suggest`);
    if (answer && !answer.pending) return answer;
  }
  return null;
}

autofillButton?.addEventListener('click', async () => {
  const form = document.querySelector('[data-approve]');
  if (!form) return;
  const slug = autofillButton.dataset.autofill;

  try {
    await withButtonState(autofillButton, 'Читаю урок…', 'Заполнено', async () => {
      await request(`/api/admin/lessons/${slug}/suggest`, { method: 'POST' });
      // Про время говорим честно: на бесплатной доле измеренный ответ занял
      // от семидесяти секунд до двух с половиной минут.
      toast('Читаю урок. Модель отвечает одну-три минуты — поля заполнятся сами.');

      const answer = await waitForSuggestion(slug);
      if (!answer) {
        toast('Модель не ответила за пять минут. Нажмите ещё раз позже.', true);
        return;
      }
      form.querySelector('[name=title]').value = answer.title;
      form.querySelector('[name=description]').value = answer.description;
      form.querySelector('[name=tags]').value = answer.tags.join(', ');
      if (answer.warning) toast(answer.warning, true);
      else {
        toast(
          answer.source === 'model'
            ? 'Поля заполнены моделью. Поправьте и сохраните.'
            : 'Поля заполнены из расшифровки. Поправьте и сохраните.'
        );
      }
    });
  } catch (error) {
    toast(`Не заполнилось: ${error.message}`, true);
  }
});

/* --- Обложка ------------------------------------------------------------- */

// Рисование идёт минуту с лишним, поэтому кнопка только ставит задачу, а
// готовность видно по перечитанной странице: обложка — картинка, и подменять
// её на месте значит показывать половину загруженного файла.
const drawCoverButton = document.querySelector('[data-draw-cover]');
drawCoverButton?.addEventListener('click', async () => {
  try {
    await withButtonState(drawCoverButton, 'Рисую…', 'Запущено', async () => {
      const answer = await request(
        `/api/admin/lessons/${drawCoverButton.dataset.drawCover}/cover-image`,
        { method: 'POST' }
      );
      if (!answer) return;
      toast('Рисую обложку. Это минута-две — обновите страницу, когда будет готово.');
    });
  } catch (error) {
    toast(`Не нарисовалось: ${error.message}`, true);
  }
});

// Выбор между кадром из записи и нарисованной. Отдельно от рисования:
// возвращаться к кадру перерисовкой значило бы тратить минуту машины на то,
// что уже лежит в буфере.
document.querySelectorAll('[data-cover]').forEach((button) => {
  button.addEventListener('click', async () => {
    // Адрес урока берём у формы проверки: отдельный атрибут на каждой кнопке
    // был бы четвёртой копией одного и того же значения на странице.
    const slug = document.querySelector('[data-approve]')?.dataset.approve;
    if (!slug) return;
    button.disabled = true;
    const answer = await request(`/api/admin/lessons/${slug}/cover/${button.dataset.cover}`, {
      method: 'POST'
    });
    if (answer) location.reload();
    else button.disabled = false;
  });
});
