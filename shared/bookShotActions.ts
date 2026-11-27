import { generatedSubtitleSpans } from "./generatedSubtitles";
import { spokenBookDialogue } from "./bookSound";
import { explicitScreenText } from "./bookScreenText";
import { readShotField, splitSoundSpeechTiming } from "./bookShotFormat";
import { readBookImage } from "./bookImageBlock";
import { readBookAudio } from "./bookAudioBlock";
import { pictureDirections } from "./stillVisualDescription";

export const shotOutputLabels = {
  image: {name:"画面描述", hint:"渲染成图片"},
  video: {name:"视频", hint:"渲染成视频"},
  subtitle: {name:"字幕", hint:"生成字幕"},
  narration: {name:"台词", hint:"生成配音"},
  music: {name:"音乐", hint:"渲染成音乐"},
  sfx: {name:"音效", hint:"渲染成音效"},
} as const;
export type ShotOutput = keyof typeof shotOutputLabels;

function firstCue(text: string) {
  const first = text.split("\n", 1)[0];
  const line = first.trim().replace(/\\$/, "").replace(/\*\*/g, "").replace(/^#{1,6}\s+/, "").trim();
  const field = readShotField(line);
  if (!field || field.kind === "source" || field.kind === "timing" || field.kind === "emotion") return;
  const label = line.split(/[:：]/)[0].trim();
  if (/^(素材待准备|参考素材)/.test(label)) return;
  const output: ShotOutput = { picture: "image", motion: "video", voice: "narration", subtitle: "subtitle", music: "music", sound: "sfx" }[field.kind] as ShotOutput;
  const qualifier = label.match(/[｜|（(].*$/u)?.[0] ?? "";
  const role = label.match(/^(开场|结束|参考)画面/u)?.[1];
  const colon = first.search(/[:：]/);
  const delimiter = colon < 0 ? first + "\n" : first.slice(0, colon + 1);
  const closeBold = colon >= 0 && first.slice(0, colon).split("**").length % 2 === 0 && first.slice(colon + 1).startsWith("**");
  const prefix = delimiter + (closeBold ? "**" : "");
  return { kind: field.kind, output, label, detail: (role ? " · " + role : "") + qualifier, prefix };
}

/** Keep the original prefix for saving and cursor offsets. A nested legacy alias is one heading. */
export function shotActionHeading(text: string) {
  const first = firstCue(text);
  if (!first) return;
  let { prefix, detail } = first;
  let body = text.slice(prefix.length);
  while (body) {
    const nested = firstCue(body);
    if (!nested || nested.output !== first.output || nested.label === first.label || nested.detail && detail) break;
    detail ||= nested.detail;
    prefix += nested.prefix;
    body = body.slice(nested.prefix.length);
  }
  return { ...first, detail, prefix, inline: body.trim() };
}

type Row = {id: string; text: string; format: string; parentId: string | null; videoRole?: string};

/** A dedicated screen-text field may contain several sentences or physical lines. */
function captionContent(content: string) {
  const text = content.trim().replace(/^(?:「([\s\S]*)」|“([\s\S]*)”|"([\s\S]*)"|『([\s\S]*)』)$/u,
    (_, ...matches) => matches.slice(0,4).find(value=>value !== undefined) ?? "");
  return /^(?:无|无字幕|不显示|留白|none)$/iu.test(text) ? "" : text;
}

export function resolveShotAction(rows: Row[], index: number) {
  const row = rows[index];
  const field = row && shotActionHeading(row.text);
  if (!field || row.format !== "text" || (row.videoRole==="dialogue" && field.kind!=="voice") || !rows.some(r => r.id === row.parentId && r.format === "shot")) return;
  const parts = [];
  if (field.inline) parts.push({id: row.id, text: row.text, content: field.inline});
  for (const next of rows.slice(index + 1)) {
    if (next.parentId !== row.parentId || next.format !== "text") break;
    if (readShotField(next.text.split("\n")[0])) {
      const body = shotActionHeading(next.text);
      if (!parts.length && body?.output === field.output && body.inline && !body.detail) {
        parts.push({id: next.id, text: next.text, content: body.inline});
        continue;
      }
      break;
    }
    if (next.videoRole === "dialogue" && field.kind !== "voice") break;
    if (readBookImage(next.text) || readBookAudio(next.text)) continue;
    if (next.text.trim()) parts.push({id: next.id, text: next.text, content: next.text});
  }
  const content = parts.map(p => p.content).join("\n\n");
  const directions = field.output === "image" ? pictureDirections(content) : undefined;
  const prompt = field.output === "sfx" ? content.split("\n").map(line => splitSoundSpeechTiming(line).sound).join("\n").trim() : directions?.picture ?? content;
  return {...field, parts, prompt, embeddedMotion: directions?.motion};
}

/** The manuscript menu addresses an actual shot, including when opened on one of its children. */
export function shotOutputSource(rows:Row[], index:number, kind:ShotOutput) {
  // Older manuscripts can keep several labelled fields inside one editable module.
  // Split only the read projection. Saving and source checks still use the full original row.
  if (!rows[index]) return;
  const projected: Row[] = [];
  const original = new Map<string, Row>();
  let selected = 0;
  for (const [i, row] of rows.entries()) {
    if (i === index) selected = projected.length;
    const pieces: string[] = [];
    if (row.format === "text" && row.videoRole !== "dialogue" && row.text.includes("\n")) {
      for (const line of row.text.split("\n")) {
        if (!pieces.length || readShotField(line)) pieces.push(line);
        else pieces[pieces.length - 1] += "\n" + line;
      }
    }
    if (pieces.length < 2) projected.push(row);
    else for (const [part, text] of pieces.entries()) {
      const id = JSON.stringify([row.id, part]);
      projected.push({ ...row, id, text });
      original.set(id, row);
    }
  }
  const result = readOutputSource(projected, selected, kind);
  if (!result || !original.size) return result;
  const parts: typeof result.parts = [];
  for (const part of result.parts) {
    const row = original.get(part.id);
    const source = row ? { ...part, id: row.id, text: row.text } : part;
    if (!parts.some(p => p.id === source.id)) parts.push(source);
  }
  return { ...result, moduleId: original.get(result.moduleId)?.id ?? result.moduleId, parts };
}

function readOutputSource(rows:Row[], index:number, kind:ShotOutput) {
  let owner = rows[index];
  const parents = new Set<string>();
  while (owner && owner.format !== "shot" && owner.parentId && !parents.has(owner.id)) {
    parents.add(owner.id);
    const parent = rows.find(r=>r.id===owner.parentId);
    if (!parent) return;
    owner = parent;
  }
  if (owner?.format !== "shot") return;
  const children = rows.filter(r=>r.parentId===owner.id && r.format==="text");
  const selected = resolveShotAction(rows,index);
  const scoped = selected?.output===kind;
  const output = kind==="subtitle" && !scoped ? "narration" : kind;
  const headings = scoped ? [rows[index]] : children.filter(r=>shotActionHeading(r.text)?.output===output);
  let parts: {id:string;text:string;content:string}[] = [];
  let label = "";
  for (const heading of headings) {
    const pos = rows.indexOf(heading);
    const action = resolveShotAction(rows,pos);
    if (action) { parts.push(...action.parts.filter(part => !parts.some(p => p.id === part.id))); label ||= action.label; }
  }
  if (!parts.length && kind === "video") {
    for (const child of children) {
      const action = resolveShotAction(rows, rows.indexOf(child));
      if (action?.embeddedMotion) parts.push({id:child.id,text:child.text,content:action.embeddedMotion});
    }
  }
  if (!scoped && (kind==="subtitle" || kind==="narration")) {
    for (const r of children) if(r.videoRole==="dialogue" && !parts.some(p=>p.id===r.id)) parts.push({...r,content:spokenBookDialogue(r.text)});
    parts.sort((a,b)=>children.findIndex(r=>r.id===a.id)-children.findIndex(r=>r.id===b.id));
  }
  if (scoped && kind==="subtitle") {
    parts = parts.map(p=>({...p,content:captionContent(p.content)})).filter(p=>p.content);
    label = "屏幕文字";
  } else if (!parts.length && kind==="subtitle") {
    const screen = children.flatMap(r=>{
      if (r.videoRole === "dialogue") return [];
      if (shotActionHeading(r.text)?.output === "subtitle") {
        const field = resolveShotAction(rows,rows.indexOf(r));
        return (field?.parts ?? []).map(p=>({...p,content:captionContent(p.content)})).filter(p=>p.content);
      }
      return explicitScreenText(r.text).map(content=>({...r,content}));
    });
    parts.push(...screen);
    if (screen.length) label="屏幕文字";
  }
  const images = children.filter(r=>readBookImage(r.text));
  const content = parts.map(p=>p.content).join("\n\n").trim();
  if ((kind === "narration" || (kind === "subtitle" && label !== "屏幕文字")) && !/第\s*\d+\s*秒/.test(label)) {
    const sound = children.flatMap(row => shotActionHeading(row.text)?.output === "sfx" ? [resolveShotAction(rows, rows.indexOf(row))] : []);
    const speech = sound.flatMap(action => action?.parts.flatMap(part => part.content.split("\n").map(line => splitSoundSpeechTiming(line).speech)) ?? []).find(Boolean);
    if (speech) label = (label || "旁白") + "｜" + speech;
  }
  const prompt = kind === "image" ? pictureDirections(content).picture : kind === "sfx" ? content.split("\n").map(line => splitSoundSpeechTiming(line).sound).join("\n").trim() : content;
  return {owner,moduleId:scoped ? rows[index].id : owner.id,parts,label,images,prompt};
}

export function requestsSilentTrack(kind: ShotOutput, prompt: string) {
  const text = prompt.trim().replace(/[。.!！]+$/u, "");
  if (kind === "narration") return /^(?:本镜|全程)?(?:无旁白|无台词|没有旁白|无人声|留白|静音)$/u.test(text);
  if (kind !== "music" && kind !== "sfx") return false;
  if (/^(?:本镜|全程|整镜)?(?:留白|静音|无声|保持安静|无)$/u.test(text)) return true;
  return kind === "music"
    ? /^(?:本镜|全程|整镜)?(?:无|不加|不需要|不要|不用|没有)(?:任何)?(?:背景)?(?:配乐|音乐)$/u.test(text)
    : /^(?:本镜|全程|整镜)?(?:无|不加|不要|不用)(?:环境声|音效)$/u.test(text);
}

/** Use the manuscript's explicit spoken interval, otherwise the shot span. */
export function shotCaptionSpans(text:string, heading:string, frames:number) {
  const seconds = (match:RegExpMatchArray|null) => match ? Math.round(Number(match[1])*30) : undefined;
  const start = seconds(heading.match(/第\s*(\d+(?:\.\d+)?)\s*秒\s*(?:开始|开口|起)/)) ?? 0;
  const end = seconds(heading.match(/第\s*(\d+(?:\.\d+)?)\s*秒(?:前)?\s*(?:收住|结束|停止)/)) ?? frames;
  return generatedSubtitleSpans(text,start,Math.min(end,frames)-start);
}
