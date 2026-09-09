# Корневой сертификат для MAX

Здесь лежит **один** публичный корневой сертификат:

```
CN = Russian Trusted Root CA
O  = The Ministry of Digital Development and Communications
sha256 D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31
```

Взят с https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt 9 сентября
2026 года.

## Зачем

`platform-api2.max.ru` работает на сертификате, выпущенном этим центром. В
стандартном наборе корневых сертификатов его нет, поэтому запрос к MAX обрывается
на рукопожатии: `unable to get local issuer certificate`.

## Как он применяется

**Только к запросам на адрес MAX** — см. `src/lib/max-fetch.js`. В доверенные
сертификаты сервера и образа он не добавляется, `NODE_EXTRA_CA_CERTS` не
используется.

Разница существенная, и решение принято заказчиком осознанно: центр, добавленный
в доверенные целиком, может выпустить сертификат на любой домен — включая те,
куда портал ходит с чужими токенами (Google, Яндекс, Telegram). Здесь он не
может ничего, кроме как подтвердить сертификат самого MAX.

Проверить сертификат можно так:

```bash
openssl x509 -in certs/russian-trusted-root-ca.pem -noout -fingerprint -sha256
openssl s_client -connect platform-api2.max.ru:443 -servername platform-api2.max.ru \
  -CAfile certs/russian-trusted-root-ca.pem </dev/null 2>/dev/null | grep "Verify return"
```
