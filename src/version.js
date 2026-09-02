// Версия приложения. Задача — отдать номер сборки одной строкой всем, кому он
// нужен: ответу /healthz и странице «о проекте». Зачем отдельный файл: номер
// живёт в package.json, и дублировать его в коде нельзя — разойдётся.
// Вызывается из src/app.js (маршрут /healthz) и из тестов.
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export const version = pkg.version;
