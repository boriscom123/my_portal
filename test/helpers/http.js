// Помощник для HTTP-тестов: поднимает приложение на свободном порту и гасит
// после проверки. Зачем: без него каждый тест повторял бы возню с listen,
// адресом и close, а забытый close вешает прогон тестов.
// Вызывается из всех тестов, которые ходят в приложение по HTTP.
export async function withServer(app, fn) {
  // Порт 0 — просьба к системе выдать любой свободный: параллельные тесты не
  // должны драться за один номер.
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
