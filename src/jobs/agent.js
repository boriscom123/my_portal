// Шаги агента роликов: сбор тем, сборка ролика, выкладка.
//
// Задача — без участия автора пройти путь «свежая новость → готовый ролик в
// личке автора», а после его «Выложить» — разослать ролик по площадкам.
// Каждый шаг — задача очереди: сборка идёт минуту, синтез и модель ходят по
// сети, а HTTP-запрос и обработчик кнопки столько ждать не могут.
//
// Ошибка любого шага приходит автору сообщением: агент работает, пока автор
// занят другим, и молча упавший сбор выглядел бы как «агент сломался».
// Вызывается воркером по именам JOBS.agentCollect, JOBS.agentRender,
// JOBS.agentPublish и JOBS.publishYoutubeShort.
import { mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { collectAnnouncements } from '../services/announcements.js';
import {
  loadAgentSettings,
  freshCandidates,
  takenTopicUrls,
  createDraft,
  getDraft,
  moveDraft,
  draftsToday
} from '../services/shorts-agent.js';
import { sendDraft, tellAdmin, draftCaption, closeDraftMessage, downloadBotFile } from '../services/agent-bot.js';
import { runFfmpeg, probeDuration, ffmpegArgsForCover, ffmpegArgsForWav } from '../lib/ffmpeg.js';
import { toSrt, splitLongSegments } from '../lib/srt.js';
import {
  layoutSentences,
  ffmpegArgsForVoice,
  ffmpegArgsForAgentVideo,
  wrapHeadline
} from '../lib/agent-video.js';
import { mediaPath, registerAsset, forgetAssetByPath, assetById } from '../services/media.js';
import { getShortById, setShortFile, publishShort } from '../services/shorts.js';
import { startPublication, markPublicationState } from '../services/publications.js';
import { addJob, JOBS } from '../queue.js';

// Имя канала внизу кадра.
const BRAND = 'Solo AI Journey';

// Длина строки титров в вертикальном кадре: шрифт крупный, и строка длиннее
// трёх десятков знаков занимает всю ширину.
const SUBTITLE_CHARS = 28;

/**
 * Сбор: свежие новости → выбор моделью → сценарии → черновики в сборку.
 * manual — нажата «Собрать сейчас»: тогда собираем полную норму, даже если
 * сегодня уже собирали, и говорим автору, когда собирать нечего.
 */
export function makeAgentCollect(config, pool, queue, texts, { fetchImpl = fetch, now = Date.now } = {}) {
  return async ({ manual = false, scheduled = false } = {}) => {
    const settings = await loadAgentSettings(pool);
    if (!manual && !settings.enabled) return { skipped: 'агент выключен' };
    // Расписание будит агента каждый час; собирает он только в свой.
    if (scheduled && moscowHour(now()) !== settings.runHour) return { skipped: 'не тот час' };
    if (!texts) {
      await tellAdmin(config, '🤖 Агент роликов: модель не настроена (нет GEMINI_API_KEY).', fetchImpl);
      return { skipped: 'нет модели' };
    }

    const count = manual ? settings.perDay : settings.perDay - (await draftsToday(pool));
    if (count <= 0) return { skipped: 'норма на сегодня собрана' };

    const { items } = await collectAnnouncements(pool, { fetchImpl });
    const taken = await takenTopicUrls(pool, items.map((item) => item.url));
    const candidates = freshCandidates(items, taken);
    if (!candidates.length) {
      if (manual) await tellAdmin(config, '🤖 Свежих новостей для роликов сейчас нет — загляну позже.', fetchImpl);
      return { drafts: 0 };
    }

    let picks;
    try {
      ({ picks } = await texts.pickShortTopics(candidates, Math.min(count, candidates.length)));
    } catch (error) {
      await tellAdmin(config, `🤖 Агент не смог выбрать темы: ${error.message}`, fetchImpl);
      throw error;
    }

    let made = 0;
    for (const { item } of picks) {
      try {
        const script = await texts.writeShortScript(item);
        const draft = await createDraft(pool, { topic: item, script });
        if (!draft) continue;
        await addJob(queue, JOBS.agentRender, { shortId: draft.shortId });
        made += 1;
      } catch (error) {
        // Одна неудачная тема не должна уносить остальные.
        await tellAdmin(config, `🤖 Не получился сценарий «${item.title}»: ${error.message}`, fetchImpl);
      }
    }
    return { drafts: made };
  };
}

/** Час по Москве. Летнего времени там нет с 2014 года — сдвиг постоянный. */
export function moscowHour(ms) {
  return new Date(ms + 3 * 3600 * 1000).getUTCHours();
}

/** Голос синтезатором: по предложению за раз, чтобы знать длину каждого. */
async function synthesizeVoice({ tts, sentences, voice, dir }) {
  const inputs = [];
  const durations = [];
  for (const [index, sentence] of sentences.entries()) {
    const file = `${dir}/sentence-${index}.wav`;
    await writeFile(file, await tts.synthesize(sentence, voice));
    const seconds = await probeDuration(file);
    if (!seconds) throw new Error(`синтезатор вернул пустой звук для предложения ${index + 1}`);
    inputs.push(file);
    durations.push(Math.round(seconds * 1000));
  }
  const output = `${dir}/voice.wav`;
  await runFfmpeg(ffmpegArgsForVoice({ inputs, durationsMs: durations, output }));
  for (const file of inputs) await rm(file, { force: true });
  return { audio: output, segments: layoutSentences(sentences, durations) };
}

/** Голос автора: голосовое из Telegram, титры — по тому, что он сказал. */
async function authorVoice({ config, speech, fileId, dir, fetchImpl }) {
  if (!speech) throw new Error('распознавание речи не настроено — титры к голосу автора не сделать');
  const ogg = await downloadBotFile(config, fileId, `${dir}/author.ogg`, fetchImpl);
  const output = `${dir}/voice.wav`;
  await runFfmpeg(ffmpegArgsForWav(ogg, output));
  const { segments } = await speech.transcribe(ogg);
  await rm(ogg, { force: true });
  if (!segments.length) throw new Error('в голосовом не распознано ни слова');
  return { audio: output, segments };
}

/**
 * Сборка ролика по черновику и отправка автору.
 * Повтор сборки (после «Надиктую сам» или «Переделать») пишет файл на то же
 * место: старый вариант автору больше не нужен.
 */
export function makeAgentRender(config, pool, { tts, speech = null, texts = null, fetchImpl = fetch } = {}) {
  return async ({ shortId, rewrite = false }) => {
    let draft = await getDraft(pool, shortId);
    if (!draft) throw new Error('черновик агента не найден');
    if (draft.state !== 'rendering') return { skipped: `черновик уже в состоянии ${draft.state}` };

    const dir = `short-${shortId}`;
    const work = mediaPath(config, `${dir}/work`);
    await mkdir(work, { recursive: true });
    try {
      // «Переделать»: сначала новый сценарий — с поправкой автора или просто
      // другой, — потом сборка как обычно.
      if (rewrite) {
        if (!texts) throw new Error('модель не настроена — переделать сценарий нечем');
        const { model: _model, ...script } = await texts.writeShortScript(draft.topic, {
          instruction: draft.instruction,
          previous: draft.script
        });
        await moveDraft(pool, shortId, { from: ['rendering'], to: 'rendering', fields: { script } });
        draft = await getDraft(pool, shortId);
      }
      const settings = await loadAgentSettings(pool);
      const { audio, segments } =
        draft.voice === 'author' && draft.authorFileId
          ? await authorVoice({ config, speech, fileId: draft.authorFileId, dir: work, fetchImpl })
          : await synthesizeVoice({
              tts,
              sentences: draft.script.sentences ?? [],
              voice: settings.voice,
              dir: work
            });

      const subtitles = `${work}/subtitles.srt`;
      await writeFile(subtitles, toSrt(splitLongSegments(segments, SUBTITLE_CHARS)));
      const headlineFile = `${work}/headline.txt`;
      await writeFile(headlineFile, wrapHeadline(draft.script.headline || draft.script.title));
      const brandFile = `${work}/brand.txt`;
      await writeFile(brandFile, BRAND);

      const relative = `${dir}/vertical.mp4`;
      const output = mediaPath(config, relative);
      await runFfmpeg(
        ffmpegArgsForAgentVideo({
          audio,
          subtitles,
          headlineFile,
          brandFile,
          durationSeconds: await probeDuration(audio),
          output
        })
      );

      await forgetAssetByPath(pool, { shortId, path: relative });
      const asset = await registerAsset(pool, config, {
        shortId,
        kind: 'vertical',
        relativePath: relative,
        bytes: (await stat(output)).size
      });
      // Заставка с середины первого предложения: на нулевом кадре только фон.
      const coverPath = `${dir}/cover.jpg`;
      await runFfmpeg(ffmpegArgsForCover({ input: output, atSeconds: 1, output: mediaPath(config, coverPath) }));
      await forgetAssetByPath(pool, { shortId, path: coverPath });
      const cover = await registerAsset(pool, config, {
        shortId,
        kind: 'cover',
        relativePath: coverPath,
        bytes: (await stat(mediaPath(config, coverPath))).size
      });
      await setShortFile(pool, shortId, { assetId: asset.id, coverUrl: `/media/asset/${cover.id}` });
      // Титры и текст — у ролика, как у загруженного: правка титров на сайте и
      // подписи площадок берут их отсюда. Заголовок и описание — из сценария:
      // после «Переделать» они новые.
      await pool.query(
        `UPDATE shorts SET segments = $2::jsonb, transcript = $3, title = $4, description = $5,
                hashtags = $6::text[] WHERE id = $1`,
        [
          shortId,
          JSON.stringify(segments),
          segments.map((segment) => segment.text).join(' '),
          draft.script.title,
          withSource(draft.script.description, draft.topic.url),
          draft.script.hashtags ?? []
        ]
      );

      const messageId = await sendDraft(
        config,
        {
          filePath: output,
          caption: draftCaption({ ...draft.script, topic: draft.topic }),
          shortId
        },
        fetchImpl
      );
      await moveDraft(pool, shortId, {
        from: ['rendering'],
        to: 'awaiting',
        fields: { botMessageId: messageId, error: null }
      });
      return { assetId: asset.id };
    } catch (error) {
      await moveDraft(pool, shortId, {
        from: ['rendering'],
        to: 'failed',
        fields: { error: error.message.slice(0, 500) }
      });
      await tellAdmin(
        config,
        `🤖 Ролик «${draft.script.title}» не собрался: ${error.message}`,
        fetchImpl
      ).catch(() => {});
      throw error;
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  };
}

/** Описание для площадок: текст модели и ссылка на источник — её добавляем сами. */
export function withSource(description, url) {
  return [String(description ?? '').trim(), url ? `Источник: ${url}` : '']
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Выкладка после «Выложить»: ролик выходит на сайте и ставится в очередь на
 * каждую подключённую площадку. Неподключённую пропускаем и говорим об этом —
 * остальные не должны ждать одну.
 */
export function makeAgentPublish(config, pool, queue, platforms, { fetchImpl = fetch } = {}) {
  return async ({ shortId }) => {
    const draft = await getDraft(pool, shortId);
    if (!draft || draft.state !== 'published') return { skipped: 'черновик не подтверждён' };

    const short = await publishShort(pool, draft.slug, true);
    const queued = [];
    const skipped = [];
    for (const target of platforms) {
      if (!(await target.ready(pool, config))) {
        skipped.push(target.title);
        continue;
      }
      const publication = await startPublication(pool, {
        shortId,
        platform: target.name,
        mode: await target.mode(pool, config)
      });
      await addJob(queue, target.job, { shortId, publicationId: publication.id });
      queued.push(target.title);
    }

    await closeDraftMessage(
      config,
      {
        messageId: draft.botMessageId,
        caption: draftCaption({ ...draft.script, topic: draft.topic }),
        outcome: `✅ Выкладываю: ${queued.join(', ') || 'никуда — площадки не подключены'}`
      },
      fetchImpl
    );
    if (skipped.length) {
      await tellAdmin(
        config,
        `Ролик «${short.title}» вышел на сайте. Не подключены: ${skipped.join(', ')}.\n${config.publicBaseUrl}/short/${short.slug}`,
        fetchImpl
      );
    }
    return { queued, skipped };
  };
}

/**
 * Выкладка ролика на YouTube как Shorts.
 * Площадка сама понимает, что это Shorts, по вертикальному кадру и длине; метка
 * #Shorts в заголовке — подсказка ей и поиску. Приватность — по режиму
 * приложения: до проверки Google публичным ролик не сделать.
 */
export function makePublishYoutubeShort(config, pool, platform, { fetchImpl = fetch } = {}) {
  return async ({ shortId, publicationId }) => {
    const publication = { id: publicationId };
    try {
      const token = await platform.accessToken(pool, config);
      if (!token) throw new Error('Канал YouTube не подключён');
      const short = await getShortById(pool, shortId);
      if (!short?.assetId) throw new Error('У ролика нет файла');
      const asset = await assetById(pool, short.assetId);
      if (!asset) throw new Error('Файл ролика пропал из буфера');

      const { rows } = await pool.query('SELECT mode FROM publications WHERE id = $1', [publicationId]);
      const privacy = rows[0]?.mode === 'auto' ? 'public' : 'private';
      const title = `${short.title}`.slice(0, 90);
      const tags = short.hashtags.map((tag) => `#${tag}`).join(' ');

      await markPublicationState(pool, publication.id, { state: 'uploading' });
      const sessionUrl = await platform.startUploadSession({
        token,
        body: {
          snippet: {
            title: `${title} #Shorts`,
            description: [short.description, tags, `${config.publicBaseUrl}/short/${short.slug}`]
              .filter(Boolean)
              .join('\n\n')
              .slice(0, 4900),
            tags: short.hashtags,
            // «Наука и техника»: ролики агента — новости ИИ, а не уроки.
            categoryId: '28',
            defaultLanguage: 'ru'
          },
          status: { privacyStatus: privacy, selfDeclaredMadeForKids: false }
        },
        fileBytes: asset.bytes,
        fetchImpl
      });
      const { videoId } = await platform.uploadVideoFile({
        sessionUrl,
        filePath: mediaPath(config, asset.path),
        fileBytes: asset.bytes,
        fetchImpl
      });
      await markPublicationState(pool, publication.id, {
        state: privacy === 'public' ? 'published' : 'ready',
        externalId: videoId,
        url: `https://youtube.com/shorts/${videoId}`
      });
      return { videoId };
    } catch (error) {
      await markPublicationState(pool, publication.id, {
        state: 'failed',
        error: error.message.slice(0, 500)
      });
      throw error;
    }
  };
}
