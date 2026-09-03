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
