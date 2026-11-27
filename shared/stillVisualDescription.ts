import { pictureSourcePages } from "./pictureSourcePages";
import { stripExplicitScreenText } from "./bookScreenText";
import { readShotField } from "./bookShotFormat";

const interval = /^(?:在\s*)?(?:前|后|最后|开始的|开头的)\s*[\d.一二两三四五六七八九十半]+\s*秒(?:钟|内)?/u;
const elapsed = /^(?:约|大约)?(?:[零〇一二两三四五六七八九十半]+|\d+(?:\.\d+)?)\s*秒(?:钟)?(?:之?后|时)/u;
const timePrefix = /^(?:约?第\s*[\d.一二三四五六七八九十半]+\s*秒(?:钟|时)?(?!的)|\d+(?:\.\d+)?\s*[-–—至到]\s*\d+(?:\.\d+)?\s*秒)/u;
const transition = /^(?:(?:镜头|画面)?从.+?(?:直接|缓慢|逐渐)?|(?:镜头|画面|随后|然后|再|直接)?)(?:切换[到至为]|切[到至入回]|转场[到至]|叠化[到至为])\s*(.+)$/u;
const camera = /^(?:(?:镜头|相机|画面|摄影机|随后|然后|再)\s*)*(?:缓缓|慢慢|缓慢|逐渐|轻轻|轻微|快速|向[左右前后])?(?:推近|推进|拉远|拉开|平移|移向|摇镜|跟拍|摇摄|慢推|移镜|推镜|固定镜头|固定机位|定格|停留|淡[入出]|叠化)(?=$|[至向到于在约一两半片几\d]|镜头|画面)/u;
const cameraTarget = /^(?:(?:镜头|相机|画面|摄影机|随后|然后|再)\s*)*(?:缓缓|缓慢|逐渐|慢慢)?(?:推近至?|拉近至?|移向|移至|定格在|停在)(.+)$/u;
const production = /^(?:按(?:照)?全片时间|(?:按|暂按).+试排|(?:这|前|后|最后).{0,8}秒.{0,6}试排|配音后|(?:无|没有)旁白|(?:字幕|屏幕文字|小字)(?:在|于|淡入|淡出|出现|显示|渐显|停留|并|[：“「])|(?:完整|短暂)?停留|稍停(?:后)?$|(?:约.{0,5}秒后)?(?:听到|响起)(?:旁白|配音|音乐|音效)|说到|^短暂停留后)/u;

/** Read mixed legacy picture fields without changing the manuscript or quoted lettering on props. */
export function pictureDirections(value: string) {
  const quotes: string[] = [];
  const protectedText = value.replace(/「[^」\n]*」|“[^”\n]*”|"[^"\n]*"|『[^』\n]*』/gu,
    literal => "\u0001" + (quotes.push(literal) - 1) + "\u0002");
  const restore = (s: string) => s.replace(/\u0001(\d+)\u0002/gu, (_, i) => quotes[Number(i)]);
  const visual: string[] = [], motion: string[] = [], captionTiming: string[] = [], timing: string[] = [], speechTiming: string[] = [];
  let skipSection = false;
  const lines = protectedText.replace(/([，,。；;])\s*(?=(?:运镜提示词|视频要求|台词|旁白|音效提示词|音乐|配乐|画面提示词)\s*[：:])/gu, "$1\n");
  for (const line of lines.split("\n")) {
    const heading = readShotField(line);
    if (heading && !heading.inline) {
      skipSection = heading.kind !== "picture" || /屏幕文字|字幕|素材待准备|参考素材/u.test(line);
      continue;
    }
    // Spoken text and a picture can also occur on the same line of an old script.
    const clean = stripExplicitScreenText(line
      .replace(/(?:屏幕文字|字幕|画面文字)(?:淡入|渐显|出现|显示)?\s*[：:]\s*\u0001\d+\u0002/gu, "")
      .replace(/(?:画外音(?:继续)?|旁白(?:继续)?|对白|台词|声音建议|音效|配乐|voice[- ]?over|narration|dialogue|sound)(?:[（(][^）)\n]{0,30}[）)])?\s*[：:]\s*(?:\u0001\d+\u0002|.*?(?=(?:画面|visuals?)\s*[：:]|$))/giu, "")
    ).trim();
    const field = readShotField(clean);
    if (field) {
      skipSection = !field.inline && field.kind !== "picture";
      if (field.kind === "motion" && field.inline) motion.push(restore(field.inline));
      if (field.kind !== "picture") continue;
    }
    if (skipSection) continue;
    const content = (field?.inline ?? clean)
      .replace(/(?:图片要求(?:（最高优先级）)?|画面动作|画面(?:提示词|描述|要求)?|visuals?)\s*[：:]/giu, "")
      .replace(/【[^】]+】/gu, "").trim();
    let frame = "", movement = "", time = "", captionActive = false;
    for (const match of content.matchAll(/([^，,。；;]+)([，,。；;]?)/gu)) {
      const [, raw, punctuation] = match;
      const prefix = (raw.trim().match(timePrefix) ?? raw.trim().match(elapsed) ?? raw.trim().match(interval))?.[0] ?? "";
      const remainder = raw.trim().slice(prefix.length).trim();
      const clause = prefix ? remainder.replace(/^[:：]\s*/u,"") : remainder;
      if (prefix) time = prefix + (clause ? "" : punctuation);
      if (!clause) continue;
      const screenCue = /^(?:字幕|屏幕文字|小字)(?:在|于|淡入|淡出|出现|显示|渐显|停留)/u.test(clause);
      if (screenCue || (captionActive && /^(?:完整|继续)?(?:停留|淡入|淡出|消失|显示|保持)/u.test(clause))) {
        captionTiming.push(restore(time + clause + punctuation));
        time = ""; captionActive = !/[。；;]/u.test(punctuation);
        continue;
      }
      captionActive = false;
      if (/^(?:听到|响起)(?:旁白|配音)|^(?:旁白|台词|配音)(?:读完|开始|开口|结束|收住)|^说到/u.test(clause)) {
        speechTiming.push(restore(time + clause + punctuation)); time = ""; continue;
      }
      if (/^(?:(?:镜头|画面)(?:再|继续)?|再|继续)?(?:停留|定格|保持)(?:约)?[\d.零一二两三四五六七八九十半]+\s*秒/u.test(clause)) {
        movement += time + clause + punctuation; time = ""; continue;
      }
      if (/^(?:持续|时长(?:约|为)?|约)[\d.一二两三四五六七八九十半]+\s*秒(?:钟)?$/u.test(clause) || production.test(clause)) { timing.push(restore(time + clause + punctuation)); time = ""; continue; }
      // Editorial overlays and holding a still have a duration; their subjects remain visible in the still.
      const reveal = /^(?:再|随后)?(?:依次|逐一|先后)(?:标出|标注|点亮|高亮)(.+)$/u.exec(clause);
      const held = /^(.+?)(?:静止呈现|静止显示|保持静止呈现)$/u.exec(clause);
      if (reveal || held) {
        frame += (reveal ?? held)![1] + punctuation;
        movement += time + clause + punctuation;
        time = "";
        continue;
      }
      const cut = transition.exec(clause) ?? /^(?:cut|dissolve) to\s+(.+)$/iu.exec(clause);
      const destination = cameraTarget.exec(clause);
      const dissolve = /^(?:与|和).+(?:叠化|交叉淡化)$/u.test(clause);
      const cameraMove = /^(?:画面|镜头)(?:缓缓|随后|慢慢)?(?:落在|移向|停在)/u.test(clause) || camera.test(clause) || Boolean(destination) || /^(?:(?:the )?camera\s+)?(?:slowly\s+)?(?:push(?:es)? in|pull(?:s)? back|pan(?:s)? (?:left|right))\.?$/iu.test(clause);
      if (cut || dissolve || cameraMove || time) {
        movement += time + clause + punctuation;
        time = "";
      }
      const visible = cut?.[1] ?? destination?.[1] ?? (cameraMove || dissolve ? "" : clause);
      if (visible) frame += (prefix || cut || destination ? visible : raw) + punctuation;
    }
    const tidy = (s: string) => restore(s.trim().replace(/[，,；;]+$/u, "")).trim();
    const picture = pictureSourcePages(tidy(frame)).text.trim();
    if (picture) visual.push(picture);
    if (tidy(movement)) motion.push(tidy(movement));
    if (time) timing.push(restore(time));
  }
  return { picture: visual.join("\n"), motion: motion.join("\n"), captionTiming: captionTiming.join(""), timing: timing.join(""), speechTiming: speechTiming.join("") };
}

export function stillVisualDescription(value: string): string {
  return pictureDirections(value).picture;
}
