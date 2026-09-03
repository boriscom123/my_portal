# Образ портала. Многоступенчатая сборка: в готовый образ не попадают ни
# инструменты сборки, ни devDependencies, ни история git — меньше поверхность
# и меньше вес. Запуск не от root: базовая гигиена, которую видно в файле.
# Node 24 «Krypton» — актуальный LTS, поддержка до апреля 2028.
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
RUN apk add --no-cache ffmpeg
# Рабочий буфер: каталог создаётся заранее и отдаётся пользователю node,
# иначе процесс без прав root не сможет писать в него на этапе 5.
RUN mkdir -p /app/media && chown -R node:node /app/media
USER node
EXPOSE 3004
CMD ["node", "src/server.js"]
