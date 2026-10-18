// Агент роликов: темы, черновики и настройки.
//
// Задача — держать в одном месте всё, что агент помнит между шагами: какие
// новости уже взяты, где каждый черновик на пути к выкладке и сколько роликов
// в день от него ждут. Сами шаги (сбор, сборка, выкладка) — в src/jobs/,
// разговор с автором — в src/routes/telegram-bot.js.
//
// Ролик агента — обычный ролик раздела «Ролики» (origin = 'agent'): тот же
// плеер, та же выкладка в каналы. Своё у него только состояние черновика.
// Вызывается из src/jobs/agent-*.js, src/routes/telegram-bot.js и настроек.
import { saveShort } from './shorts.js';

/** Голоса синтезатора. Тот же список, что в tts/server.mjs. */
export const AGENT_VOICES = [
  { name: 'denis', title: 'Денис' },
  { name: 'dmitri', title: 'Дмитрий' },
  { name: 'ruslan', title: 'Руслан' },
  { name: 'irina', title: 'Ирина' }
];

// Свежесть темы. Трое суток: ролик про новость недельной давности в ленте уже
// никому не нужен, а у выходных должен быть шанс попасть в понедельник.
const FRESH_MS = 3 * 24 * 3600 * 1000;

/** Настройки агента. Строка одна, заведена миграцией. */
export async function loadAgentSettings(pool) {
  const { rows } = await pool.query(
    'SELECT enabled, per_day, run_hour, voice FROM agent_settings WHERE id'
  );
  const row = rows[0] ?? { enabled: true, per_day: 2, run_hour: 10, voice: 'ruslan' };
  return { enabled: row.enabled, perDay: row.per_day, runHour: row.run_hour, voice: row.voice };
}

/**
 * Сохраняет настройки. Значения приходят из формы — проверяем здесь: неверное
 * число в базе означало бы агента, который молча перестал работать.
 */
export async function saveAgentSettings(pool, { enabled, perDay, runHour, voice }) {
  const count = Number(perDay);
  const hour = Number(runHour);
  if (!Number.isInteger(count) || count < 1 || count > 10) {
    throw new Error('Роликов в день — от 1 до 10');
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('Час сбора — от 0 до 23');
  if (!AGENT_VOICES.some((item) => item.name === voice)) throw new Error('Нет такого голоса');

  // Вставкой с заменой, а не правкой: строку заводит миграция, но правка
  // пропавшей строки молча не сохранила бы ничего.
  await pool.query(
    `INSERT INTO agent_settings (id, enabled, per_day, run_hour, voice) VALUES (true, $1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET enabled = EXCLUDED.enabled, per_day = EXCLUDED.per_day,
            run_hour = EXCLUDED.run_hour, voice = EXCLUDED.voice, updated_at = now()`,
    [enabled === true, count, hour, voice]
  );
  return loadAgentSettings(pool);
}

/**
 * Кандидаты в темы: свежие и ещё не взятые.
 * Без даты запись не берём: «непонятно когда» для новостного ролика хуже,
 * чем «давно».
 */
export function freshCandidates(items, takenUrls, { now = Date.now() } = {}) {
  const taken = new Set(takenUrls);
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.url || !item?.title || taken.has(item.url) || seen.has(item.url)) return false;
    seen.add(item.url);
    const at = item.publishedAt instanceof Date ? item.publishedAt.getTime() : Number(item.publishedAt);
    return Number.isFinite(at) && at > 0 && now - at <= FRESH_MS;
  });
}

/** Какие из адресов уже стали темами. */
export async function takenTopicUrls(pool, urls) {
  if (!urls.length) return [];
  const { rows } = await pool.query('SELECT url FROM agent_topics WHERE url = ANY($1::text[])', [
    urls
  ]);
  return rows.map((row) => row.url);
}

/**
 * Заводит черновик: тема, ролик в разделе и состояние «собирается».
 * Тема записывается первой и с ON CONFLICT: два сбора подряд не должны
 * сделать два ролика об одной новости.
 * null — тему уже взял кто-то другой.
 */
export async function createDraft(pool, { topic, script }) {
  const { rows: topics } = await pool.query(
    `INSERT INTO agent_topics (url, title, source, summary) VALUES ($1, $2, $3, $4)
     ON CONFLICT (url) DO NOTHING RETURNING id`,
    [topic.url, topic.title, topic.source ?? '', String(topic.summary ?? '').slice(0, 2000)]
  );
  if (!topics.length) return null;

  const short = await saveShort(pool, {
    title: script.title,
    description: script.description,
    hashtags: script.hashtags
  });
  await pool.query(`UPDATE shorts SET origin = 'agent' WHERE id = $1`, [short.id]);
  await pool.query(
    `INSERT INTO agent_drafts (short_id, topic_id, script) VALUES ($1, $2, $3::jsonb)`,
    [short.id, topics[0].id, JSON.stringify(script)]
  );
  return getDraft(pool, short.id);
}

function toDraft(row) {
  return {
    shortId: Number(row.short_id),
    slug: row.slug,
    state: row.state,
    script: row.script ?? {},
    voice: row.voice,
    authorFileId: row.author_file_id,
    instruction: row.instruction,
    botMessageId: row.bot_message_id === null ? null : Number(row.bot_message_id),
    error: row.error,
    topic: { url: row.topic_url, title: row.topic_title, source: row.topic_source, summary: row.topic_summary }
  };
}

const DRAFT_SELECT = `SELECT d.*, s.slug, t.url AS topic_url, t.title AS topic_title,
                             t.source AS topic_source, t.summary AS topic_summary
                        FROM agent_drafts d
                        JOIN shorts s ON s.id = d.short_id
                        JOIN agent_topics t ON t.id = d.topic_id`;

/** Черновик по номеру ролика. */
export async function getDraft(pool, shortId) {
  const { rows } = await pool.query(`${DRAFT_SELECT} WHERE d.short_id = $1`, [shortId]);
  return rows.length ? toDraft(rows[0]) : null;
}

/**
 * Черновик, который ждёт ответа автора словами или голосом.
 * Самый свежий: автор отвечает на то, что нажал последним.
 */
export async function draftWaitingFor(pool, state) {
  const { rows } = await pool.query(
    `${DRAFT_SELECT} WHERE d.state = $1 ORDER BY d.updated_at DESC LIMIT 1`,
    [state]
  );
  return rows.length ? toDraft(rows[0]) : null;
}

/**
 * Переводит черновик в новое состояние.
 * from — из каких состояний переход допустим: кнопка в старом сообщении или
 * повтор обновления от Telegram не должны выложить выброшенное. false —
 * перехода не было.
 */
export async function moveDraft(pool, shortId, { from, to, fields = {} }) {
  const columns = {
    script: 'script',
    voice: 'voice',
    authorFileId: 'author_file_id',
    instruction: 'instruction',
    botMessageId: 'bot_message_id',
    error: 'error'
  };
  const sets = ['state = $3', 'updated_at = now()'];
  const values = [shortId, from, to];
  for (const [key, value] of Object.entries(fields)) {
    if (!columns[key]) throw new Error(`у черновика нет поля ${key}`);
    values.push(key === 'script' ? JSON.stringify(value) : value);
    sets.push(`${columns[key]} = $${values.length}${key === 'script' ? '::jsonb' : ''}`);
  }
  const { rowCount } = await pool.query(
    `UPDATE agent_drafts SET ${sets.join(', ')} WHERE short_id = $1 AND state = ANY($2::text[])`,
    values
  );
  return rowCount > 0;
}

/** Сколько черновиков агент завёл с начала суток по Москве — чтобы не превысить норму. */
export async function draftsToday(pool) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM agent_topics
      WHERE picked_at >= date_trunc('day', now() AT TIME ZONE 'Europe/Moscow') AT TIME ZONE 'Europe/Moscow'`
  );
  return rows[0].n;
}
