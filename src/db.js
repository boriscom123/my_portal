// Пул подключений к PostgreSQL. Задача — держать один набор соединений на
// процесс: открывать соединение на каждый запрос дорого, а без ограничения
// сверху приложение упирается в лимит базы. Зачем отдельным файлом: параметры
// пула — это настройка эксплуатации, и менять её надо в одном месте.
// Вызывается из src/server.js один раз при старте.
import pg from 'pg';

// Десяти соединений хватает: у портала один процесс, а общий постгрес делится
// с другими проектами — забирать больше без нужды невежливо.
const MAX_CLIENTS = 10;

export function createPool(dbConfig) {
  return new pg.Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.name,
    user: dbConfig.user,
    password: dbConfig.password,
    max: MAX_CLIENTS
  });
}
