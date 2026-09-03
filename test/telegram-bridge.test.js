// Мост между страницей входа и клиентским скриптом.
//
// Обработчик виджета объявлен прямо в разметке страницы, а его продолжение —
// в public/app.js. Имена связывают их только по написанию, и переименование в
// одном месте молча ломает вход в другом: ровно это и случилось при переводе
// имён на латиницу — виджет звал функцию, которой больше не было.
// Такую поломку не ловит ни линтер, ни обычный тест страницы: код внутри
// разметки для них просто текст.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loginPage } from '../src/views/login.js';

const config = {
  publicBaseUrl: 'https://soloaijourney.online',
  telegram: { botToken: 'т', botUsername: 'solo_ai_journey_bot' }
};

/** Имена, которыми страница входа и клиент договариваются между собой. */
const МОСТ = ['signInWithTelegram', 'pendingTelegramAuth'];

test('страница входа и клиент зовут друг друга одинаково', async () => {
  const страница = loginPage({ config });
  const клиент = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  for (const имя of МОСТ) {
    assert.ok(страница.includes(`window.${имя}`), `страница входа не упоминает window.${имя}`);
    assert.ok(клиент.includes(`window.${имя}`), `public/app.js не объявляет window.${имя}`);
  }
});

test('виджет зовёт объявленный на странице обработчик', async () => {
  const страница = loginPage({ config });
  const имя = страница.match(/data-onauth="(\w+)\(/)?.[1];
  assert.ok(имя, 'у виджета не задан обработчик');
  assert.ok(
    страница.includes(`window.${имя} = function`),
    `обработчик ${имя} не объявлен на самой странице — виджет позовёт пустоту`
  );
});
