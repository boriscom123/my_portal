// Состояние урока словами.
//
// Задача — один словарь на все виды: список уроков, экран проверки, витрина у
// автора. Жил в модуле страницы кабинета, а читали его трое; со страницей
// кабинета он и уехал бы, хотя к ней отношения не имеет.
// Вызывается из src/views/admin-lessons.js, admin-review.js и feed.js.

// Что происходит с уроком — словами. «processing» на экране не объясняет
// ничего человеку, который зашёл посмотреть, готово ли.
export const PIPELINE_LABELS = {
  idle: '',
  uploading: 'загружается',
  processing: 'обрабатывается',
  review: 'ждёт проверки',
  failed: 'обработка упала'
};

// Что именно сейчас считается. Расшифровка часового урока идёт полчаса, и
// «обрабатывается» всё это время не отвечает на единственный вопрос автора —
// далеко ли до конца. Заказчик уже жаловался ровно на это: «отобразилось
// сообщение — и всё, больше ничего не происходит».
export const STEP_LABELS = {
  fetchSource: 'скачивается с Диска',
  extractAudio: 'извлекается звук',
  transcribe: 'распознаётся речь',
  subtitles: 'собираются субтитры',
  suggestTexts: 'готовится заголовок и описание',
  trimPauses: 'вырезаются паузы',
  makeCover: 'выбирается обложка',
  makeCoverImage: 'рисуется обложка',
  makeClips: 'режутся вертикальные ролики'
};

/** Состояние урока словами: с названием шага, если он известен. */
export function stateLabel(lesson) {
  const base = PIPELINE_LABELS[lesson.pipelineState] ?? lesson.pipelineState;
  if (lesson.pipelineState !== 'processing') return base;
  const step = STEP_LABELS[lesson.pipelineJob?.name];
  return step ? `${base}: ${step}` : base;
}
