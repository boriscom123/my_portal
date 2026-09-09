// Разбиение записи на куски для расшифровки. Чистые функции: ни файлов, ни сети.
//
// Зачем вообще резать: расход памяти у whisper почти не зависит от длины
// записи, но всё же растёт — 0.65 ГБ на пятнадцати минутах, 0.93 на
// шестидесяти шести (замерено). Куски делают расход постоянным: двухчасовой
// урок считается так же, как получасовой, и не упирается в потолок воркера.
//
// Резать по тишине, а не по часам: разрез посреди слова даёт оборванную реплику
// в конце одного куска и обрубок в начале следующего — в субтитрах это видно.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planChunks, mergeChunkResults } from '../src/lib/chunks.js';

const HALF_HOUR = 30 * 60 * 1000;

test('короткая запись не режется вовсе', () => {
  const chunks = planChunks({ durationMs: 20 * 60 * 1000, silences: [] });
  assert.deepEqual(chunks, [{ startMs: 0, endMs: 20 * 60 * 1000 }]);
});

test('запись чуть длиннее куска тоже не режется', () => {
  // Резать час на тридцать минут и тридцать одну — значит платить лишним
  // запуском модели ради ничего.
  const chunks = planChunks({ durationMs: 32 * 60 * 1000, silences: [] });
  assert.equal(chunks.length, 1);
});

test('длинная запись режется по тишине рядом с целью', () => {
  const silences = [
    { startMs: 12 * 60 * 1000, endMs: 12 * 60 * 1000 + 3000 },
    // Ближайшая к получасу — эта, по ней и режем.
    { startMs: 29 * 60 * 1000, endMs: 29 * 60 * 1000 + 4000 },
    { startMs: 44 * 60 * 1000, endMs: 44 * 60 * 1000 + 2000 }
  ];
  const chunks = planChunks({ durationMs: 66 * 60 * 1000, silences });

  assert.equal(chunks.length, 2);
  // Режем по СЕРЕДИНЕ тишины: так ни один звук не достаётся двум кускам сразу.
  assert.equal(chunks[0].endMs, 29 * 60 * 1000 + 2000);
  assert.equal(chunks[1].startMs, chunks[0].endMs, 'куски идут встык, без пропуска');
  assert.equal(chunks.at(-1).endMs, 66 * 60 * 1000);
});

test('тишины рядом нет — режем ровно пополам', () => {
  // Час непрерывной речи бывает. Разрез посреди слова хуже ровного, но лучше,
  // чем урок, который вообще не расшифровался.
  const chunks = planChunks({ durationMs: 70 * 60 * 1000, silences: [] });
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].endMs, 35 * 60 * 1000);
  assert.equal(chunks[1].startMs, 35 * 60 * 1000);
});

test('куски покрывают запись целиком и не наезжают друг на друга', () => {
  const silences = Array.from({ length: 20 }, (_, index) => ({
    startMs: (index + 1) * 5 * 60 * 1000,
    endMs: (index + 1) * 5 * 60 * 1000 + 2000
  }));
  const chunks = planChunks({ durationMs: 120 * 60 * 1000, silences });

  assert.equal(chunks[0].startMs, 0);
  assert.equal(chunks.at(-1).endMs, 120 * 60 * 1000);
  for (let i = 1; i < chunks.length; i += 1) {
    assert.equal(chunks[i].startMs, chunks[i - 1].endMs, `кусок ${i} не встык`);
    assert.ok(chunks[i].endMs > chunks[i].startMs, `кусок ${i} пустой`);
  }
});

test('огрызков в конце не бывает: куски примерно равны', () => {
  // Деление поровну само избавляет от хвоста в сорок секунд, ради которого
  // пришлось бы отдельно запускать модель.
  const chunks = planChunks({ durationMs: 100 * 60 * 1000, silences: [] });
  const lengths = chunks.map((chunk) => chunk.endMs - chunk.startMs);
  const shortest = Math.min(...lengths);
  const longest = Math.max(...lengths);
  assert.ok(longest - shortest < 60 * 1000, `куски разошлись: ${lengths.join(', ')}`);
  assert.ok(longest <= HALF_HOUR + 5 * 60 * 1000, 'кусок не длиннее предела');
});

test('времена кусков сдвигаются на их начало', () => {
  // Без сдвига субтитры второго получаса начались бы заново с начала урока, и
  // заметил бы это зритель: в кабинете расшифровка выглядит правдоподобно.
  const merged = mergeChunkResults([
    {
      startMs: 0,
      result: { text: 'первый кусок', dropped: 1, segments: [{ startedMs: 1000, endedMs: 2000, text: 'начало' }] }
    },
    {
      startMs: HALF_HOUR,
      result: { text: 'второй кусок', dropped: 2, segments: [{ startedMs: 500, endedMs: 1500, text: 'продолжение' }] }
    }
  ]);

  assert.equal(merged.segments[0].startedMs, 1000);
  assert.equal(merged.segments[1].startedMs, HALF_HOUR + 500);
  assert.equal(merged.segments[1].endedMs, HALF_HOUR + 1500);
  assert.equal(merged.text, 'первый кусок второй кусок');
  assert.equal(merged.dropped, 3, 'отброшенные заготовки считаются по всем кускам');
});

test('пустой кусок не рвёт расшифровку', () => {
  // Полчаса тишины или музыки бывают: реплик нет, а урок продолжается.
  const merged = mergeChunkResults([
    { startMs: 0, result: { text: 'речь', dropped: 0, segments: [{ startedMs: 0, endedMs: 10, text: 'речь' }] } },
    { startMs: HALF_HOUR, result: { text: '', dropped: 0, segments: [] } }
  ]);
  assert.equal(merged.segments.length, 1);
  assert.equal(merged.text, 'речь');
});
