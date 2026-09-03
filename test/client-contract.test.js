// Договор между клиентом и приложением.
//
// Клиентский код без браузера не запускается, поэтому его логику тестами не
// покрыть. Но несколько строк в нём — несущие: без регистрации service
// worker'а нет ни офлайна, ни уведомлений, а без обработчика push уведомление
// не покажется. Обе такие строки уже пропадали при правках соседнего кода и
// молчали до жалобы заказчика. Здесь проверяется, что они на месте.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const читать = (имя) => readFile(new URL(`../public/${имя}`, import.meta.url), 'utf8');

test('клиент регистрирует service worker', async () => {
  const app = await читать('app.js');
  assert.match(
    app,
    /navigator\.serviceWorker\.register\('\/sw\.js'\)/,
    'без этой строки не работают ни офлайн, ни уведомления'
  );
});

test('ошибка регистрации не глушится', async () => {
  const app = await читать('app.js');
  // Пустой catch здесь означает, что причина сбоя останется невидимой и нам,
  // и человеку у экрана.
  assert.ok(
    !/register\('\/sw\.js'\)\.catch\(\(\) => \{\s*\}\)/.test(app),
    'ошибка регистрации проглатывается'
  );
  assert.match(app, /reportError\('sw-register'/);
});

test('worker принимает уведомления и открывает страницу по нажатию', async () => {
  const sw = await читать('sw.js');
  assert.match(sw, /addEventListener\('push'/);
  assert.match(sw, /showNotification/);
  assert.match(sw, /addEventListener\('notificationclick'/);
});

test('worker не кеширует ответы API', async () => {
  const sw = await читать('sw.js');
  // Ответ /api/ зависит от того, кто спрашивает: закешированный отдал бы
  // одному человеку страницу другого.
  assert.match(sw, /startsWith\('\/api\/'\)/);
});
