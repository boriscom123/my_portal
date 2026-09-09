# Заявка на проверку доступа к YouTube

Проверка (verification) снимает принудительную приватность роликов: после неё
портал сможет выкладывать сразу публично, и переключатель в настройках
заработает по-настоящему.

Порядок у Google жёсткий, шаги идут только в этом порядке:

1. подтвердить владение доменом — в Google Search Console, property типа
   **Domain**, а не URL prefix;
2. подтвердить бренд — кнопка «Verify branding» на вкладке Branding;
   **результат живёт 7 дней**, за это время надо успеть опубликовать;
3. подать заявку на доступ к данным — то, ради чего написан этот файл.

## Что вписать в заявку

Формы Google меняются, но спрашивают всегда одно и то же. Ниже — готовые
ответы по-английски: их читает проверяющий-человек. Рядом по-русски сказано, что
каждый ответ утверждает, — отправлять стоит только то, за что вы отвечаете.

### What does your app do?

> Solo AI Journey (https://soloaijourney.online) is a personal educational
> portal run by a single author. It publishes the author's own video lessons on
> software development, together with transcripts, subtitles and viewer
> feedback. The portal has exactly one administrator — the author — and no other
> user connects a Google account to it.

*По-русски: портал одного автора, публикует собственные уроки; аккаунт Google к
нему подключает только он сам.*

### How will the requested scopes be used?

> The portal uploads the author's own lesson recordings from the portal to the
> author's own YouTube channel, and completes each upload with a subtitle track
> and a custom thumbnail.
>
> We request one scope — https://www.googleapis.com/auth/youtube.force-ssl —
> because our flow needs four API methods and this is the narrowest single scope
> that covers all of them:
>
> - videos.insert — upload the lesson recording;
> - captions.insert — attach the Russian subtitle track produced by the portal
>   from the lesson audio;
> - thumbnails.set — set the lesson cover image as the video thumbnail;
> - videos.list — read back the privacy status of the uploaded video, so that the
>   portal publishes a link to it on the lesson page only after the owner has
>   made the video public.
>
> https://www.googleapis.com/auth/youtube.upload alone is not sufficient:
> captions.insert requires youtube.force-ssl.
>
> The portal never reads, edits or deletes any other video, comment, playlist or
> subscriber data.

*По-русски: одна область доступа вместо трёх, потому что субтитры без неё не
загрузить; перечислены ровно те четыре метода, которые портал правда вызывает, —
это проверяется по коду и по видео.*

### How do you store and protect user data?

> Access and refresh tokens are stored on our own server, encrypted with
> AES-256-GCM; the key lives in the server environment, outside the database, so
> a database dump alone is useless. Tokens are never shared with third parties.
> Access can be revoked at any time from the portal's settings page or from the
> user's Google account.
>
> Our privacy policy is published at https://soloaijourney.online/privacy and
> describes the YouTube access separately.

*По-русски: то, что портал правда делает, — шифрование токенов и отзыв доступа
двумя способами. Проверяющий откроет ссылку на политику, поэтому она и написана.*

## Сценарий демо-видео

Проверяющий сверяет заявленное с увиденным. Поэтому в кадре должно быть ровно
то, что написано выше, и ничего лишнего.

Общее: запись экрана без монтажа и музыки, три-пять минут, адресная строка
браузера видна всё время. Готовое видео залить на YouTube как «по ссылке»
(unlisted) и вставить ссылку в заявку.

1. **Адрес портала.** Откройте https://soloaijourney.online — пусть в кадре
   будет адресная строка. Покажите пару уроков: видно, что это настоящий сайт, а
   не заглушка ради заявки.
2. **Вход.** Войдите в кабинет. Достаточно показать, что вход есть и что вы —
   владелец сайта.
3. **Где начинается подключение.** Настройки → Площадки → YouTube. Видно имя
   приложения и кнопку «Подключить канал».
4. **Экран согласия Google.** Нажмите кнопку. Задержитесь на экране согласия так,
   чтобы читались имя приложения и запрашиваемый доступ. Это ключевой кадр
   заявки — его смотрят в первую очередь.
5. **Возврат.** Разрешите доступ. Видно, что портал вернул вас в настройки и
   пишет «Канал подключён».
6. **Использование доступа.** Экран урока → «Отправить на YouTube». Покажите, как
   меняется состояние: заливается → лежит на канале.
7. **Результат на площадке.** Откройте YouTube Studio и покажите на этом ролике
   три вещи, по одной на каждый метод из заявки: сам ролик, дорожку субтитров,
   обложку.
8. **Отзыв доступа.** Вернитесь в настройки и покажите кнопку «Отключить канал».
   Google отдельно смотрит, может ли человек забрать доступ обратно.

Чего в кадре быть не должно: чужих аккаунтов, чужих каналов, посторонних
вкладок с личной перепиской, ключей приложения и содержимого файла `.env`.

## Частые причины отказа

| Причина | Как не попасть |
|---|---|
| Область доступа шире, чем нужно по видео | На видео показаны все четыре действия из заявки — загрузка, субтитры, обложка, проверка приватности |
| Домен не подтверждён | Шаг 1: property типа Domain в Search Console, TXT-запись в DNS |
| Политика конфиденциальности не открывается или не про это приложение | https://soloaijourney.online/privacy открыта всем, и доступ к YouTube описан в ней отдельным разделом |
| Бренд не опубликован | Проверка бренда живёт 7 дней — публиковать сразу после неё |
