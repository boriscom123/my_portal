// Что уезжает на YouTube: какой файл, какие субтитры, какие поля.
//
// Отдельным файлом от запросов к API, потому что это чистые решения: их можно
// проверить целиком, не поднимая ни сети, ни базы, ни файлов. Ошибка здесь
// стоит дорого — заметить перепутанные субтитры можно только на готовом ролике,
// ближе к концу, и уже после выкладки.
// Вызывается из src/jobs/publish-youtube.js и src/routes/admin.js.
import { validChapters, chaptersBlock } from '../../lib/chapters.js';

// Пределы площадки. Проверено по документации 2026-09-08.
const TITLE_LIMIT = 100;
const DESCRIPTION_LIMIT = 5000;
const TAGS_TOTAL_LIMIT = 500;

// Образование. Строкой с номером — так этого требует площадка.
const CATEGORY_EDUCATION = '27';

/** Смонтированная запись, если она собрана; иначе исходник. */
export function pickVideoAsset(assets) {
  return (
    assets.find((asset) => asset.kind === 'trimmed') ??
    assets.find((asset) => asset.kind === 'source') ??
    null
  );
}

// Как конвейер называет субтитры. Имя видео тут не помощник: исходник носит имя,
// которое дал ему автор («L2-2.mp4»), а субтитры к нему шаг субтитров кладёт под
// именем subtitles.srt. Совпадают имена только у монтажа — и полагаться на это
// совпадение значит однажды взять к исходнику чужие субтитры.
const SUBTITLES_NAME = { trimmed: 'trimmed.srt', source: 'subtitles.srt' };

/**
 * Субтитры в пару к тому файлу, который уезжает.
 *
 * Монтаж сдвигает времена, и рядом с ним лежат собственные субтитры. Взять к
 * монтажу субтитры исходника значит получить подписи, которые к концу урока
 * опаздывают на суммарную длину вырезанных пауз. Своих субтитров нет — молчим:
 * лучше ролик без подписей, чем ролик с чужими.
 */
export function pickSubtitlesAsset(assets, videoAsset, settings = {}) {
  // Подписи уже вшиты автором — свой трек дал бы две строки на экране.
  if (settings.burnedSubtitles) return null;

  const name = SUBTITLES_NAME[videoAsset?.kind];
  if (!name) return null;

  const dir = videoAsset.path.slice(0, videoAsset.path.lastIndexOf('/') + 1);
  return assets.find((asset) => asset.kind === 'subtitles' && asset.path === `${dir}${name}`) ?? null;
}

/** Обрезает по границе слова: рваное слово в заголовке читается как опечатка. */
function trimWords(text, limit) {
  const value = String(text ?? '').trim();
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > limit / 2 ? cut.slice(0, lastSpace) : cut).trim();
}

/** Теги, пока не кончился общий предел площадки. */
function fitTags(tags, limit) {
  const kept = [];
  let total = 0;
  for (const tag of tags ?? []) {
    if (total + tag.length > limit) break;
    kept.push(tag);
    total += tag.length;
  }
  return kept;
}

/** Тело запроса на создание ролика. */
export function buildVideoBody({ lesson, publicBaseUrl, privacy, chapters: given = null }) {
  const link = `${publicBaseUrl}/lesson/${lesson.slug}`;

  // Главы отдельным блоком после текста автора, а не внутри него: иначе правка
  // описания однажды сломает главы, и понять это можно будет только по ролику.
  // Негодный по правилам площадки список отбрасывается целиком — YouTube в
  // таком случае молча не покажет ни одной главы, и лучше их не обещать.
  // Главы доводом — уже на шкале уезжающего файла (см. chaptersForVideo):
  // у смонтированной записи они сдвинуты относительно исходной.
  const chapters = chaptersBlock(
    given ?? validChapters(lesson.chapters, (lesson.durationSeconds ?? 0) * 1000 || Infinity)
  );

  const description = trimWords(
    [lesson.description ?? '', chapters, `Урок на портале: ${link}`]
      .filter(Boolean)
      .join('\n\n')
      .trim(),
    DESCRIPTION_LIMIT
  );

  return {
    snippet: {
      title: trimWords(lesson.title, TITLE_LIMIT),
      description,
      tags: fitTags(lesson.tags, TAGS_TOTAL_LIMIT),
      categoryId: CATEGORY_EDUCATION,
      defaultLanguage: 'ru'
    },
    status: {
      privacyStatus: privacy,
      // Обязательное поле: без него площадка отказывает в загрузке целиком.
      selfDeclaredMadeForKids: false
    }
  };
}
