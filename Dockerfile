# Образ портала. Многоступенчатая сборка: в готовый образ не попадают ни
# инструменты сборки, ни devDependencies, ни история git — меньше поверхность
# и меньше вес. Запуск не от root: базовая гигиена, которую видно в файле.
# Node 24 «Krypton» — актуальный LTS, поддержка до апреля 2028.
# whisper.cpp: расшифровка речи считается на самом сервере, облачного
# поставщика в проекте нет. Сборка статическая (BUILD_SHARED_LIBS=OFF): иначе
# двоичный файл тянет за собой libwhisper и libggml, и копировать пришлось бы
# их все — первая сборка так и упала на «symbol not found». Готовый файл
# весит три мегабайта, модель в образ не кладётся (см. том models).
FROM alpine:3.21 AS whisper
RUN apk add --no-cache build-base cmake git
WORKDIR /src
RUN git clone --depth 1 https://github.com/ggml-org/whisper.cpp .
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
      -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON \
 && cmake --build build -j "$(nproc)" --config Release

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY migrations ./migrations
COPY public ./public
# ffmpeg нужен воркеру: извлечение звука, нарезка, кадр на обложку. В образе
# api он лишний, но два разных образа ради 135 МБ — это вторая сборка, второй
# слой в CI и второй повод им разойтись. Один образ, две команды запуска.
RUN apk add --no-cache ffmpeg libstdc++
COPY --from=whisper /src/build/bin/whisper-cli /usr/local/bin/whisper-cli
# Рабочий буфер: каталог создаётся заранее и отдаётся пользователю node,
# иначе процесс без прав root не сможет писать в него на этапе 5.
RUN mkdir -p /app/media /app/models && chown -R node:node /app/media /app/models
USER node
EXPOSE 3004
CMD ["node", "src/server.js"]
