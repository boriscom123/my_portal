// Синтез речи для роликов агента: обращение к контейнеру tts.
//
// Задача — получить wav по тексту. Сам синтезатор живёт отдельным контейнером
// (tts/), потому что Piper не запускается на Alpine; здесь — только запрос к
// нему по внутренней сети.
// Вызывается из src/jobs/agent.js.

/** Клиент синтеза. url — адрес контейнера (TTS_URL, по умолчанию http://tts:5002). */
export function createTts(config, fetchImpl = fetch) {
  const url = (config.tts?.url ?? 'http://tts:5002').replace(/\/+$/, '');
  return {
    /** Текст → wav-байты. Отказ — с текстом самого синтезатора. */
    async synthesize(text, voice) {
      const response = await fetchImpl(`${url}/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Минута с запасом: предложение синтезируется за доли секунды, но
        // первый запрос голоса ещё и скачивает его — 60 МБ.
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({ text, voice })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(`синтез речи не удался (${response.status}): ${body.error ?? 'без объяснения'}`);
      }
      return Buffer.from(await response.arrayBuffer());
    }
  };
}
