// Запросы к MAX: та же подпись, что у fetch, но со своим корнем доверия.
//
// Задача — доверять удостоверяющему центру Минцифры РОВНО ТАМ, где это нужно.
// platform-api2.max.ru работает на его сертификате, и обычный fetch обрывает
// соединение на рукопожатии: этого центра нет в стандартном наборе корней.
//
// Почему не добавить корень в доверенные всему образу и не поставить
// NODE_EXTRA_CA_CERTS: центр, которому доверяешь целиком, может выпустить
// сертификат на любой домен — включая те, куда портал ходит с чужими токенами.
// Здесь он не может ничего, кроме как подтвердить сертификат самого MAX.
// Решение принято заказчиком, объяснение — в certs/README.md.
//
// Написано на node:https, а не на своём диспетчере fetch: undici как отдельный
// пакет в проекте не нужен, а тридцать строк здесь дешевле зависимости.
// Вызывается из src/services/platforms/max-channel.js.
import { request } from 'node:https';
import { readFileSync } from 'node:fs';

const CA_FILE = new URL('../../certs/russian-trusted-root-ca.pem', import.meta.url);
let ca = null;

/**
 * Сертификат читается при первом запросе к MAX, а не при загрузке файла.
 *
 * Разница важна: этот файл добирается до кода площадок из маршрутов, то есть
 * из всего портала. Читай мы сертификат сразу — его отсутствие роняло бы
 * портал целиком, включая страницы, которые про MAX ничего не знают. Ровно это
 * и случилось на сборщике GitHub, когда правило «*.pem» унесло сертификат из
 * репозитория: падал каждый тест, который поднимает приложение.
 */
function rootCertificate() {
  if (ca) return ca;
  try {
    ca = readFileSync(CA_FILE);
  } catch (error) {
    throw new Error(
      `Нет корневого сертификата для MAX (certs/russian-trusted-root-ca.pem): ${error.code ?? error.message}`
    );
  }
  return ca;
}

// Адрес, к которому применяется особое доверие. Проверяется, а не
// подразумевается: та же функция с чужим адресом означала бы, что корень
// Минцифры незаметно расползся по остальным запросам портала.
const ALLOWED_HOST = 'platform-api2.max.ru';

/** Ответ в том же виде, в каком его ждёт код, написанный под fetch. */
function toResponse(status, text) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text)
  };
}

export function maxFetch(url, options = {}) {
  const address = new URL(String(url));
  if (address.hostname !== ALLOWED_HOST) {
    throw new Error(`Особое доверие к сертификату действует только для ${ALLOWED_HOST}`);
  }

  return new Promise((resolve, reject) => {
    const call = request(
      {
        hostname: address.hostname,
        path: `${address.pathname}${address.search}`,
        method: options.method ?? 'GET',
        headers: options.headers ?? {},
        ca: rootCertificate()
      },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (text += chunk));
        response.on('end', () => resolve(toResponse(response.statusCode, text)));
      }
    );
    call.on('error', reject);
    if (options.body) call.write(options.body);
    call.end();
  });
}
