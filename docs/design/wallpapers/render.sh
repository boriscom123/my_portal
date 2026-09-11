#!/bin/sh
# Отрисовка обоев рабочего стола из wallpaper.html в PNG.
#
# Запускать из корня репозитория:
#   docs/design/wallpapers/render.sh
# Картинки лягут в docs/design/wallpapers/out/ и хранятся в git: оттуда их
# берут как готовые обои. После правки wallpaper.html перерисуйте их и
# зафиксируйте заново — иначе в репозитории останутся обои старого вида.
#
# Chromium ставится в одноразовый alpine-контейнер: локально браузера нет, а
# ставить его на сервер ради картинок незачем.
set -eu

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
mkdir -p "$here/out"

# Можно перерисовать только часть: render.sh orbit light
variants="${*:-orbit wordmark nebula blueprint light}"

# Холст страницы — 1920×1080; остальные размеры получаются масштабом.
sizes="1920x1080:1 2560x1440:1.3333333 3840x2160:2"

docker run --rm -v "$repo":/work -e variants="$variants" -e sizes="$sizes" alpine sh -c '
  apk add --no-cache chromium font-noto >/dev/null
  for v in $variants; do
    for s in $sizes; do
      name="${s%%:*}"
      scale="${s##*:}"
      # --disable-dev-shm-usage обязателен: Docker даёт /dev/shm всего 64 МБ,
      # и на тяжёлом кадре (4K, размытые пятна) Chromium молча падает, не
      # записав картинку.
      # Профиль свой на каждый запуск: два Chromium на одном профиле
      # мешают друг другу.
      # --virtual-time-budget не ставить: с ним Chromium зависает навсегда.
      # Отчёт «bytes written» Chromium пишет в stderr — поэтому 2>&1, иначе
      # удачный снимок выглядит проваленным.
      # Три попытки: изредка Chromium виснет на старте и без повтора теряется
      # случайная картинка из пятнадцати.
      result="FAIL"
      for attempt in 1 2 3; do
        if timeout 120 chromium-browser --headless --no-sandbox --disable-gpu \
          --disable-dev-shm-usage --user-data-dir="/tmp/profile-$v-$name-$attempt" \
          --hide-scrollbars --allow-file-access-from-files \
          --run-all-compositor-stages-before-draw \
          --force-device-scale-factor="$scale" --window-size=1920,1080 \
          --screenshot="/work/docs/design/wallpapers/out/solo-ai-$v-$name.png" \
          "file:///work/docs/design/wallpapers/wallpaper.html#$v" 2>&1 \
          | grep -q "written"; then
          result="ok  "
          break
        fi
      done
      echo "$result $v $name"
    done
  done
'
