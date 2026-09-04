// Черновик заголовка, описания и тегов из расшифровки. Модели у портала нет —
// облака не будет, — поэтому здесь не сочинение, а извлечение. Проверяется
// именно то, что делает извлечение полезным: не служебные слова в тегах и не
// приветствие в заголовке.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  suggestTitle,
  suggestDescription,
  suggestTags,
  suggestFromTranscript,
  sentences
} from '../src/lib/summary.js';

// Кусок настоящей расшифровки урока заказчика: на выдуманном тексте эти
// правила выглядели бы работающими, а на живой речи — нет.
const REAL = `Итак, мы продолжаем первой серии уроков. Мы создали приложение,
которое собирает форма обратной связи, какие-то реакции, шлёт на реакции в
Telegram. Я считаю, что для проверки своей идеи этого вполне хватит. Дальше мы
поднимем docker и настроим docker compose. Затем разберём, как работает docker
в связке с nginx. Всё это будет на VPS, потому что VPS дешевле.`;

test('заголовок не начинается с приветствия', () => {
  // Уроки начинаются с «Итак, мы продолжаем» — такой заголовок не говорит о
  // содержании ничего.
  const title = suggestTitle(REAL);
  assert.ok(!/^Итак/.test(title), `взято приветствие: ${title}`);
  assert.ok(title.length > 10);
});

test('заголовок не длиннее строки в ленте площадки', () => {
  assert.ok(suggestTitle(REAL).length <= 71);
});

test('заголовок не кончается запятой перед многоточием', () => {
  // Обрезка часто приходится на запятую, и «…связи,…» читается как сбой.
  const title = suggestTitle('Мы создали приложение, которое собирает форму обратной связи, реакции и прочее что нужно');
  assert.ok(!/[,;:]…$/.test(title), title);
});

test('описание собирается по предложениям, а не по знакам', () => {
  const description = suggestDescription(REAL);
  // Оборванная на середине мысль в описании читается как ошибка загрузки.
  assert.ok(/[.!?…]$/.test(description), description.slice(-40));
  assert.ok(description.length <= 401);
});

test('в теги идут слова о содержании, а не служебные', () => {
  const tags = suggestTags(REAL);
  assert.ok(tags.includes('docker'), `docker сказан четырежды, а тегов вышло: ${tags}`);
  // Первый прогон на настоящем уроке дал «поэтому, только, именно, через» —
  // частые в любой речи и о содержании не говорящие.
  for (const junk of ['поэтому', 'только', 'именно', 'через', 'потому']) {
    assert.ok(!tags.includes(junk), `служебное слово в тегах: ${junk}`);
  }
});

test('слово, сказанное один раз, темой урока не считается', () => {
  const tags = suggestTags('уникальное слово встретилось однажды и больше нигде не повторялось');
  assert.deepEqual(tags, []);
});

test('латиница попадает в теги наравне с кириллицей', () => {
  // В уроках про docker и vps это как раз нужные слова.
  assert.ok(suggestTags(REAL).includes('docker'));
});

test('пустая расшифровка не роняет заполнение', () => {
  // Расшифровки может не быть вовсе: урок без речи или шаг ещё не выполнен.
  assert.deepEqual(suggestFromTranscript(''), { title: '', description: '', tags: [] });
  assert.deepEqual(sentences(''), []);
});

test('заполнение отдаёт все три поля разом', () => {
  const result = suggestFromTranscript(REAL);
  assert.ok(result.title);
  assert.ok(result.description);
  assert.ok(Array.isArray(result.tags));
});
