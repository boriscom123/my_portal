// Шифрование чужих токенов перед записью в базу.
//
// Задача — хранить токен доступа так, чтобы дамп базы не был утечкой. Токен
// Яндекс Диска даёт доступ ко всему диску заказчика; на этапе 7 рядом лягут
// токены площадок, и правило спеки для них то же.
//
// AES-256-GCM выбран потому, что он шифрует и подписывает одновременно:
// подмена шифротекста замечается, а не расшифровывается в мусор. Случайный
// вектор на каждое шифрование — иначе одинаковые токены давали бы одинаковый
// шифротекст, и их можно было бы сравнивать, не расшифровывая.
// Вызывается из src/services/disk.js и, с этапа 7, из адаптеров площадок.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

// Рекомендованная длина вектора для GCM: двенадцать байт.
const IV_BYTES = 12;

/**
 * Разбирает ключ из окружения.
 * Короткий ключ — это молчаливое ослабление шифрования, поэтому падаем сразу,
 * а не шифруем всерьёз только на вид.
 */
function keyBytes(hexKey) {
  const key = Buffer.from(String(hexKey), 'hex');
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY должен быть 32 байта в hex');
  return key;
}

/** Возвращает строку вида вектор:метка:шифротекст, всё в hex. */
export function encryptSecret(text, hexKey) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyBytes(hexKey), iv);
  const encrypted = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted.toString('hex')].join(
    ':'
  );
}

/** Обратная операция. Бросает, если ключ чужой или шифротекст подменён. */
export function decryptSecret(box, hexKey) {
  const [iv, tag, data] = String(box).split(':');
  const decipher = createDecipheriv(ALGORITHM, keyBytes(hexKey), Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]).toString(
    'utf8'
  );
}
