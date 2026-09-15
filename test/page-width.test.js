// Ширина шапки и подвала на больших экранах.
//
// Заказчик 2026-09-15: на широком мониторе знак уезжал в левый край, меню — в
// правый, подвал — так же, а содержимое страницы стояло узкой колонкой по
// центру. Шапка и подвал держат ту же колонку, что и содержимое; черта под
// шапкой и над подвалом при этом идёт во всю ширину экрана.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

/** Первое правило с этим селектором — до закрывающей скобки. */
function block(selector) {
  const at = styles.indexOf(`${selector} {`);
  assert.ok(at >= 0, `нет правила ${selector}`);
  return styles.slice(at, styles.indexOf('}', at));
}

test('ширина колонки задана одной переменной, и содержимое её держит', () => {
  assert.match(styles, /--page-width: 68rem;/);
  assert.match(block('main'), /max-width: var\(--page-width\)/);
});

test('шапка и подвал держат ту же колонку, что и содержимое', () => {
  // Отступ по бокам растёт так, что внутри остаётся ширина колонки; на узком
  // экране он не меньше прежнего.
  for (const selector of ['.site-header', 'footer']) {
    assert.match(
      block(selector),
      /padding-inline: max\([\s\S]*calc\(\(100% - var\(--page-width\)\) \/ 2/,
      `${selector} растягивается во всю ширину экрана`
    );
  }
});
