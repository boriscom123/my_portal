// Сервер синтеза речи: текст → wav голосом Piper.
//
// Задача — дать воркеру портала голос за кадром для роликов агента, не платя
// за облачный синтез. Один маршрут: POST /synthesize { text, voice } → wav.
// Слушает только внутреннюю сеть compose: наружу порт не публикуется.
//
// Голоса — из закрытого списка: имя голоса попадает в путь к файлу и в адрес
// загрузки, и свободный текст там — приглашение прочитать чужой файл.
// Запускается в контейнере tts (см. tts/Dockerfile и docker-compose.yml).
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { access, mkdir, rename, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.PORT ?? 5002);
const VOICES_DIR = process.env.VOICES_DIR ?? '/voices';
const PIPER = process.env.PIPER_BIN ?? '/opt/piper/piper';
const VOICE_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/ru/ru_RU';

// Русские голоса Piper. Все — среднего качества: высокого для русского нет, а
// низкое заметно хрипит.
const VOICES = ['denis', 'dmitri', 'ruslan', 'irina'];

// Предел текста за раз. Ролик — это полторы сотни слов; больше — не ролик, и
// держать процессор минутами ради чужой ошибки незачем.
const TEXT_LIMIT = 2000;

/** Скачивает голос, если его ещё нет. Через временное имя: обрыв не оставит половину файла. */
async function ensureVoice(voice) {
  const model = path.join(VOICES_DIR, `${voice}.onnx`);
  try {
    await access(model);
    await access(`${model}.json`);
    return model;
  } catch {
    // нет — качаем ниже
  }
  await mkdir(VOICES_DIR, { recursive: true });
  for (const suffix of ['.onnx', '.onnx.json']) {
    const response = await fetch(`${VOICE_BASE}/${voice}/medium/ru_RU-${voice}-medium${suffix}`);
    if (!response.ok) throw new Error(`голос ${voice} не скачался: ${response.status}`);
    const temporary = path.join(VOICES_DIR, `${voice}${suffix}.part`);
    await writeFile(temporary, Buffer.from(await response.arrayBuffer()));
    await rename(temporary, path.join(VOICES_DIR, `${voice}${suffix}`));
  }
  return model;
}

/** Запускает Piper: текст на вход, wav в файл. */
function runPiper(model, text, output) {
  return new Promise((resolve, reject) => {
    const child = spawn(PIPER, ['--model', model, '--output_file', output], {
      stdio: ['pipe', 'ignore', 'pipe']
    });
    let errors = '';
    child.stderr.on('data', (chunk) => {
      errors = (errors + chunk).slice(-2000);
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`piper завершился с кодом ${code}: ${errors.trim()}`))
    );
    child.stdin.end(text);
  });
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > TEXT_LIMIT * 4) throw new Error('слишком длинный запрос');
  }
  return JSON.parse(body || '{}');
}

const server = createServer(async (req, res) => {
  const reply = (status, payload) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  };

  if (req.method === 'GET' && req.url === '/health') return reply(200, { ok: true, voices: VOICES });
  if (req.method !== 'POST' || req.url !== '/synthesize') return reply(404, { error: 'нет такого' });

  let output = null;
  try {
    const { text, voice = VOICES[0] } = await readJson(req);
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!clean) return reply(400, { error: 'нет текста' });
    if (clean.length > TEXT_LIMIT) return reply(400, { error: `текст длиннее ${TEXT_LIMIT} знаков` });
    if (!VOICES.includes(voice)) return reply(400, { error: `нет голоса ${voice}` });

    const model = await ensureVoice(voice);
    output = path.join(tmpdir(), `${randomUUID()}.wav`);
    await runPiper(model, clean, output);
    const wav = await readFile(output);
    res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length });
    res.end(wav);
  } catch (error) {
    reply(500, { error: error.message });
  } finally {
    if (output) await rm(output, { force: true });
  }
});

server.listen(PORT, () => console.log(`Синтез речи слушает порт ${PORT}`));
