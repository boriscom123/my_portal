// Настройки подготовки урока.
//
// Задача — держать в одном месте то, что решает автор, а не разработчик: как
// выглядят подписи и надо ли вырезать паузы. Зачем не константами в коде:
// обводка, хорошая на светлом кадре записи экрана, слишком жирна на тёмном
// терминале, и правильного значения на все уроки не существует.
//
// Значения приходят из формы, то есть от человека, и попадают в аргументы
// ffmpeg — поэтому каждое проверяется здесь, а не по дороге.
// Вызывается из src/routes/admin.js, src/jobs/make-clips.js и src/jobs/trim-pauses.js.

/** Что применяется, пока автор ничего не выбрал. */
export const DEFAULT_SETTINGS = {
  // Толщина обводки подписи в условных точках libass — их примерно семь на
  // точку кадра. Восемь десятых это пять точек: читается и не жирно.
  subtitleOutline: 0.8,
  // Цвет подписи. Белый на обводке читается на любом кадре.
  subtitleColor: '#ffffff',
  // Вырезать ли паузы из записи. По умолчанию нет: монтаж занимает полчаса
  // машины, и включать его без спроса нельзя.
  cutPauses: false,
  // Пауза короче этой не режется: без неё речь звучит рублено, будто человек
  // говорит без дыхания.
  minPauseSeconds: 2
};

const LIMITS = {
  subtitleOutline: { min: 0, max: 4 },
  minPauseSeconds: { min: 0.5, max: 30 }
};

const COLOR = /^#[0-9a-f]{6}$/i;

/** Число из формы: приходит строкой, может прийти чем угодно. */
function clampNumber(value, { min, max }, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/**
 * Сводит сохранённые настройки с умолчаниями и отбрасывает негодные значения.
 * Возвращает полный набор: вызывающему не приходится помнить про умолчания.
 */
export function readSettings(stored = {}) {
  const source = stored && typeof stored === 'object' ? stored : {};
  return {
    subtitleOutline: clampNumber(
      source.subtitleOutline ?? DEFAULT_SETTINGS.subtitleOutline,
      LIMITS.subtitleOutline,
      DEFAULT_SETTINGS.subtitleOutline
    ),
    subtitleColor: COLOR.test(String(source.subtitleColor ?? ''))
      ? String(source.subtitleColor).toLowerCase()
      : DEFAULT_SETTINGS.subtitleColor,
    cutPauses: source.cutPauses === true || source.cutPauses === 'on',
    minPauseSeconds: clampNumber(
      source.minPauseSeconds ?? DEFAULT_SETTINGS.minPauseSeconds,
      LIMITS.minPauseSeconds,
      DEFAULT_SETTINGS.minPauseSeconds
    )
  };
}

/**
 * Переводит цвет из привычного #rrggbb в то, что понимает libass.
 * Там свой порядок — &HBBGGRR, синий первым, — и перепутанный порядок даёт не
 * ошибку, а неожиданный цвет: красный вместо синего.
 */
export function toAssColor(hex) {
  const value = COLOR.test(String(hex)) ? String(hex).slice(1) : DEFAULT_SETTINGS.subtitleColor.slice(1);
  const [r, g, b] = [value.slice(0, 2), value.slice(2, 4), value.slice(4, 6)];
  return `&H${b}${g}${r}`.toUpperCase();
}
