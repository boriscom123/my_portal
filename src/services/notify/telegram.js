// Канал телеграм-бота. Задача — доставить уведомление тому, у кого нет
// установленного приложения, но есть привязанный телеграм. Зачем через тот же
// токен, что и вход: бот один, и человек, вошедший его виджетом, уже разрешил
// ему писать (data-request-access="write").
// Вызывается из слоя уведомлений (src/services/notify/index.js).

export function createTelegramChannel(config, fetchImpl = fetch) {
  // Как и у Web Push: не настроен бот — канала нет, приложение работает.
  if (!config.telegram?.botToken) return null;

  return async (chatId, сообщение) => {
    const текст = [
      сообщение.title,
      '',
      сообщение.body,
      `${config.publicBaseUrl}${сообщение.url ?? '/'}`
    ].join('\n');

    const res = await fetchImpl(`https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: текст,
        // Превью ссылки раздувает сообщение на пол-экрана, а заголовок и так
        // есть в тексте.
        link_preview_options: { is_disabled: true }
      })
    });
    if (!res.ok) throw new Error(`Telegram не принял сообщение: ${res.status}`);
  };
}
