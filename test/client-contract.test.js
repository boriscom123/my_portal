// Договор между клиентом и приложением.
//
// Клиентский код без браузера не запускается, поэтому его логику тестами не
// покрыть. Но несколько строк в нём — несущие: без регистрации service
// worker'а нет ни офлайна, ни уведомлений, а без обработчика push уведомление
// не покажется. Обе такие строки уже пропадали при правках соседнего кода и
// молчали до жалобы заказчика. Здесь проверяется, что они на месте.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const readPublic = (name) => readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');

test('клиент регистрирует service worker', async () => {
  const app = await readPublic('app.js');
  assert.match(
    app,
    /navigator\.serviceWorker\.register\('\/sw\.js'\)/,
    'без этой строки не работают ни офлайн, ни уведомления'
  );
});

test('ошибка регистрации не глушится', async () => {
  const app = await readPublic('app.js');
  // Пустой catch здесь означает, что причина сбоя останется невидимой и нам,
  // и человеку у экрана.
  assert.ok(
    !/register\('\/sw\.js'\)\.catch\(\(\) => \{\s*\}\)/.test(app),
    'ошибка регистрации проглатывается'
  );
  assert.match(app, /reportError\('sw-register'/);
});

test('worker принимает уведомления и открывает страницу по нажатию', async () => {
  const sw = await readPublic('sw.js');
  assert.match(sw, /addEventListener\('push'/);
  assert.match(sw, /showNotification/);
  assert.match(sw, /addEventListener\('notificationclick'/);
});

test('у каждой зацепки в разметке есть обработчик в клиенте', async () => {
  // Разметку и клиент связывают только имена атрибутов. Трижды при правке
  // соседнего кода обработчик исчезал, а кнопка оставалась: «Выйти» ничего не
  // делала, колокольчик молчал, worker не регистрировался. Тест сверяет обе
  // стороны, потому что ни линтер, ни тест страницы этого не видят.
  const views = await readdir(new URL('../src/views/', import.meta.url));
  const hooks = new Set();
  for (const name of views) {
    const source = await readFile(new URL(`../src/views/${name}`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/\sdata-([a-z-]+)[=>\s]/g)) hooks.add(match[1]);
  }

  const client = [
    await readPublic('app.js'),
    await readPublic('admin.js')
  ].join('\n');

  for (const hook of hooks) {
    assert.ok(
      client.includes(`data-${hook}`),
      `в разметке есть data-${hook}, а в клиенте его никто не слушает — кнопка будет мёртвой`
    );
  }
});

test('worker не кеширует ответы API', async () => {
  const sw = await readPublic('sw.js');
  // Ответ /api/ зависит от того, кто спрашивает: закешированный отдал бы
  // одному человеку страницу другого.
  assert.match(sw, /startsWith\('\/api\/'\)/);
});

test('клиент ищет тот же класс отданной оценки, что ставит вид', async () => {
  // Вид переименовали при чистке кириллицы, клиент забыли. Ломается это тихо:
  // снять свою оценку нельзя, повторное нажатие ставит её заново.
  const view = await readFile(new URL('../src/views/lesson.js', import.meta.url), 'utf8');
  const client = await readPublic('app.js');
  const emitted = view.match(/rating-step\$\{[^}]*'\s*([a-z-]+)'/)?.[1];
  assert.ok(emitted, 'вид перестал помечать отданную оценку');
  assert.ok(
    client.includes(`classList.contains('${emitted}')`),
    `вид ставит класс ${emitted}, а клиент ищет другой`
  );
});
