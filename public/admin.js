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
const settingsForm = document.querySelector('[data-settings]');
settingsForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(settingsForm);
  const rebuild = event.submitter?.value === 'yes';
  const buttons = settingsForm.querySelectorAll('button');
  buttons.forEach((button) => (button.disabled = true));

  try {
    const answer = await request(`/api/admin/lessons/${settingsForm.dataset.settings}/settings`, {
      method: 'POST',
      body: JSON.stringify({
        subtitleOutline: data.get('subtitleOutline'),
        subtitleColor: data.get('subtitleColor'),
        cutPauses: data.get('cutPauses') === 'on',
        minPauseSeconds: data.get('minPauseSeconds'),
        rebuild
      })
    });
    if (answer) {
      toast(
        rebuild
          ? 'Настройки сохранены, пересборка запущена. Монтаж часовой записи занимает около получаса.'
          : 'Настройки сохранены. Применятся при следующей сборке.'
      );
      if (rebuild) setTimeout(() => location.reload(), 1500);
    }
  } finally {
    buttons.forEach((button) => (button.disabled = false));
  }
});
