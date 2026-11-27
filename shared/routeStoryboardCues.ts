import { readBookImage } from "./bookImageBlock";
import { readBookAudio } from "./bookAudioBlock";
import {
  readShotField,
  splitSoundSpeechTiming,
  type ShotField,
} from "./bookShotFormat";
import { explicitScreenText } from "./bookScreenText";
import { pictureDirections } from "./stillVisualDescription";
import { pictureSourcePages } from "./pictureSourcePages";
import { writingModuleTexts, type BookWritingStyle } from "./bookWritingStyle";

const bare = (s: string) => s.trim().replace(/[，,。；;：:\s]+$/u, "");
type Routed = {
  kind: "motion" | "subtitle" | "voice" | "timing" | "captionText";
  text: string;
};
const heading = {
  motion: "视频：",
  subtitle: "字幕｜",
  voice: "台词｜",
  timing: "时长与节奏：",
  captionText: "字幕：",
};
const containsMedia = (s: string) =>
  Boolean(readBookImage(s) || readBookAudio(s));

/** Apply the field policy to a new version. The input modules, image references and their IDs remain intact. */
export function routeStoryboardCues(
  body: string,
  style: BookWritingStyle,
  newId: () => string
) {
  const texts = writingModuleTexts(body, style);
  if (texts.length !== style.length)
    throw new Error("分镜模块和正文数量不符。");
  const shots = new Set(style.filter(r => r.format === "shot").map(r => r.id));
  const pending = new Map<string, Routed[]>(),
    owners = new Map<string, string>();
  const fields = new Map<string, ShotField>();
  const existing = new Map<string, Map<string, string[]>>();
  const endAt = new Map<string, number>();
  const voiceAt = new Map<string, number>(),
    captionAt = new Map<string, number>();
  const routedTexts = texts.map((text, index) => {
    const row = style[index];
    const shot =
      row.format === "shot"
        ? row.id
        : row.parentId
          ? owners.get(row.parentId)
          : undefined;
    if (!shot || !shots.has(shot)) return text;
    owners.set(row.id, shot);
    endAt.set(shot, index);
    if (row.format !== "text" || containsMedia(text)) return text;
    if (row.videoRole === "dialogue") {
      if (!voiceAt.has(shot)) voiceAt.set(shot, index);
      fields.delete(shot);
      return text;
    }
    const additions = pending.get(shot) ?? [];
    pending.set(shot, additions);
    const saved = existing.get(shot) ?? new Map<string, string[]>();
    existing.set(shot, saved);
    return text
      .split("\n")
      .map(line => {
        const cue = readShotField(line);
        if (cue) fields.set(shot, cue.kind);
        if (
          cue?.kind === "subtitle" &&
          !captionAt.has(shot) &&
          !text.includes("\n")
        )
          captionAt.set(shot, index);
        const kind = fields.get(shot);
        if (!kind || !line.trim()) return line;
        const content = cue ? cue.inline : line;
        if (content.trim())
          saved.set(kind, [...(saved.get(kind) ?? []), bare(content)]);
        if (!content.trim()) return line;
        if (kind === "sound") {
          const { sound, speech } = splitSoundSpeechTiming(content);
          if (speech) additions.push({ kind: "voice", text: speech });
          const audio: string[] = [];
          for (const [part] of sound.matchAll(
            /(?:[^，,。；;“「"『]|“[^”]*”|「[^」]*」|"[^"]*"|『[^』]*』)+[，,。；;]?/gu
          )) {
            const words = part.trim();
            if (
              /^(?:无旁白|没有旁白|两句(?:之间|间).*(?:停|顿)|(?:说完|读完)后.*(?:停|顿)|(?:再|随后|接着)?开口|小字出现的同时开口)/u.test(
                words
              )
            ) {
              additions.push({ kind: "voice", text: words });
              continue;
            }
            if (/读字幕|(?:字幕|小字)(?:淡入|淡出)/u.test(words)) {
              additions.push({ kind: "subtitle", text: words });
              continue;
            }
            audio.push(part);
          }
          if (!speech && audio.join("") === sound) return line;
          return audio.length
            ? (cue ? "音效：" : "") + bare(audio.join(""))
            : "";
        }
        if (kind !== "picture" || /^(?:参考素材|素材待准备)/u.test(line.trim()))
          return line;
        const directions = pictureDirections(content);
        const items: Routed[] = [
          { kind: "motion", text: directions.motion },
          { kind: "subtitle", text: directions.captionTiming },
          { kind: "voice", text: directions.speechTiming },
          { kind: "timing", text: directions.timing },
          ...explicitScreenText(content).map(text => ({
            kind: "captionText" as const,
            text,
          })),
        ].filter(item => item.text.trim()) as Routed[];
        if (!items.length) return line;
        additions.push(...items);
        const citations = pictureSourcePages(content).pages.map(p => p.label);
        const picture = [...citations, directions.picture]
          .filter(Boolean)
          .join(" ");
        return (
          (cue
            ? /^(?:画面|画面提示词|画面描述)\s*[：:]/u.test(line)
              ? "画面描述："
              : line.slice(0, line.indexOf(cue.inline))
            : "") + picture
        );
      })
      .join("\n");
  });
  const beforeVoice = new Map<number, { shot: string; text: string }>();
  for (const [shot, cues] of pending) {
    const captions = captionAt.get(shot),
      voice = voiceAt.get(shot);
    const qualifier = (kind: Routed["kind"]) =>
      [
        ...new Set(
          cues
            .filter(item => item.kind === kind)
            .map(item => bare(item.text).replace(/^字幕在(?=\d)/u, ""))
        ),
      ]
        .filter(Boolean)
        .join("；");
    const subtitle = qualifier("subtitle"),
      speech = qualifier("voice");
    if (captions !== undefined && subtitle) {
      const original = routedTexts[captions],
        colon = original.search(/[:：]/u);
      const at = colon < 0 ? original.length : colon;
      routedTexts[captions] =
        original.slice(0, at) + "｜" + subtitle + original.slice(at);
    }
    if (voice !== undefined && speech)
      beforeVoice.set(voice, { shot, text: "台词｜" + speech });
    pending.set(
      shot,
      cues.filter(
        item =>
          !(item.kind === "subtitle" && captions !== undefined) &&
          !(item.kind === "voice" && voice !== undefined)
      )
    );
  }
  const lines: string[] = [],
    writingStyle: BookWritingStyle = [];
  for (const [i, row] of style.entries()) {
    const spoken = beforeVoice.get(i);
    if (spoken) {
      lines.push(spoken.text);
      writingStyle.push({
        id: newId(),
        format: "text",
        parentId: spoken.shot,
        collapsed: false,
        lineCount: 1,
      });
    }
    const text = routedTexts[i];
    lines.push(text);
    writingStyle.push({ ...row, lineCount: text.split("\n").length });
    const shot = owners.get(row.id);
    if (!shot || endAt.get(shot) !== i) continue;
    const added = new Set<string>();
    for (const item of pending.get(shot) ?? []) {
      const value = bare(item.text);
      if (!value) continue;
      const label = heading[item.kind];
      const line =
        label +
        (item.kind === "subtitle" || item.kind === "voice"
          ? value.replace(/^字幕在(?=\d)/u, "")
          : bare(item.text) +
            (/[。！？]$/u.test(item.text.trim())
              ? item.text.trim().slice(-1)
              : ""));
      const seen =
        existing
          .get(shot)
          ?.get(item.kind === "captionText" ? "subtitle" : item.kind) ?? [];
      if (
        added.has(label + value) ||
        seen.some(prior => prior === value) ||
        texts.some(
          (s, j) => owners.get(style[j].id) === shot && bare(s) === bare(line)
        )
      )
        continue;
      added.add(label + value);
      lines.push(line);
      writingStyle.push({
        id: newId(),
        format: "text",
        parentId: shot,
        collapsed: false,
        lineCount: line.split("\n").length,
      });
    }
  }
  return { body: lines.join("\n"), writingStyle };
}
