# Синтезатор речи для роликов агента — отдельным маленьким контейнером.
#
# Зачем не в образе портала: Piper собран под glibc, а портал живёт на Alpine
# (musl). Через gcompat он запускается, но onnxruntime внутри падает на первом
# же слове — проверено. Перевозить весь портал на Debian ради одного шага
# дороже, чем держать рядом контейнер на сотню мегабайт.
#
# Версия Piper закреплена: голосовые модели собраны под неё, и молча
# подхваченная новая могла бы заговорить иначе.
FROM node:24-bookworm-slim
ARG PIPER_VERSION=2023.11.14-2
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && curl -fsSL "https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_x86_64.tar.gz" \
    | tar -xz -C /opt \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server.mjs ./
# Голоса качаются при первом запросе в том voices и переживают пересборку.
RUN mkdir -p /voices && chown node:node /voices
USER node
EXPOSE 5002
CMD ["node", "server.mjs"]
