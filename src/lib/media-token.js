// Временная ссылка на файл рабочего буфера.
//
// Задача — дать внешнему сервису забрать файл по HTTPS, не открывая буфер
// целиком. Зачем не отдавать файлы напрямую: тогда исходники уроков лежали бы
// в открытом доступе по угадываемым адресам.
//
// Ссылка живёт час: столько занимает любая разумная обработка, а живущая
// дольше — это исходник, доступный всему интернету.
// Вызывается из задач, которым нужен внешний сервис, и из src/routes/media.js.
import { signShortLived, verifyShortLived } from './jwt.js';

const DEFAULT_TTL_SECONDS = 3600;

export function mediaLink(config, assetId, seconds = DEFAULT_TTL_SECONDS) {
  const token = signShortLived({ assetId }, config.jwtSecret, seconds);
  return `${config.publicBaseUrl}/media/${token}`;
}

/** Номер файла из токена. null на любой неудаче — чужой, просроченный, мусор. */
export function readMediaToken(config, token) {
  const payload = verifyShortLived(String(token ?? ''), config.jwtSecret);
  return payload?.assetId ?? null;
}
