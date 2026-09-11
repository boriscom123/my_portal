// Канал телеграм-бота. Задача — доставить уведомление тому, у кого нет
// установленного приложения, но есть привязанный телеграм. Зачем через тот же
// токен, что и вход: бот один, и человек, вошедший его виджетом, уже разрешил
// ему писать (data-request-access="write").
// Вызывается из слоя уведомлений (src/services/notify/index.js).

export function createTelegramChannel(config, fetchImpl = fetch) {
  // Как и у Web Push: не настроен бот — канала нет, приложение работает.
  if (!config.telegram?.botToken) return null;

  return async (chatId, message) => {
    const text = [
      message.title,
      '',
      message.body,
      `${config.publicBaseUrl}${message.url ?? '/'}`
    ].join('\n');

    // Адрес сервера — из настроек: бот, переехавший на свой сервер Bot API,
    // в облако ходить не должен.
    const apiUrl = config.telegram.apiUrl || 'https://api.telegram.org';
    const res = await fetchImpl(`${apiUrl}/bot${config.telegram.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        // Превью ссылки раздувает сообщение на пол-экрана, а заголовок и так
        // есть в тексте.
        link_preview_options: { is_disabled: true }
      })
    });
    if (!res.ok) throw new Error(`Telegram не принял сообщение: ${res.status}`);
  };
}
