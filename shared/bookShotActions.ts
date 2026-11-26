import { generatedSubtitleSpans } from "./generatedSubtitles";
import { spokenBookDialogue } from "./bookSound";
import { explicitScreenText } from "./bookScreenText";
import { readShotField } from "./bookShotFormat";
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
export function shotMenuOutputs(audio: "music" | "sfx" = "music"): ShotOutput[] {
  return ["image","video","subtitle","narration",audio];
}

export function shotActionHeading(text: string) {
  const [first, ...rest] = text.split("\n");
  const line = first.trim().replace(/\\$/, "").replace(/\*\*/g, "").replace(/^#{1,6}\s+/, "").trim();
  const field = readShotField(line);
  if (!field || field.kind === "source" || field.kind === "timing") return;
  const label = line.split(/[:：]/)[0].trim();
  if (/^(素材待准备|参考素材)/.test(label)) return;
  const output: ShotOutput = field.kind === "picture" ? (/^(屏幕文字|字幕)/u.test(label) ? "subtitle" : "image") :
    field.kind === "motion" ? "video" : field.kind === "voice" ? "narration" :
    /^(音乐|配乐|背景音乐)/u.test(label) ? "music" : "sfx";
  const qualifier = label.match(/[｜|（(].*$/u)?.[0] ?? "";
  const role = label.match(/^(开场|结束|参考)画面/u)?.[1];
  return {kind:field.kind, output, label, detail:(role ? " · "+role : "")+qualifier, inline:[field.inline,...rest].join("\n").trim()};
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
    if (next.parentId !== row.parentId || next.format !== "text" || readShotField(next.text.split("\n")[0].replace(/\\\s*$/, ""))) break;
    if (next.videoRole === "dialogue" && field.kind !== "voice") break;
    if (readBookImage(next.text) || readBookAudio(next.text)) continue;
    if (next.text.trim()) parts.push({id: next.id, text: next.text, content: next.text});
  }
  const content = parts.map(p => p.content).join("\n\n");
  const directions = field.output === "image" ? pictureDirections(content) : undefined;
  return {...field, parts, prompt: directions?.picture ?? content, embeddedMotion: directions?.motion};
}

/** The manuscript menu addresses an actual shot, including when opened on one of its children. */
export function shotOutputSource(rows:Row[], index:number, kind:ShotOutput) {
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
    if (action) { parts.push(...action.parts); label ||= action.label; }
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
  if (!parts.length && !scoped && (kind==="music" || (kind==="image" && !children.some(r=>readShotField(r.text.split("\n")[0])?.kind==="picture")))) parts.push({...owner,content:owner.text});
  const images = children.filter(r=>readBookImage(r.text));
  const content = parts.map(p=>p.content).join("\n\n").trim();
  return {owner,moduleId:scoped ? rows[index].id : owner.id,parts,label,images,prompt:kind==="image" ? pictureDirections(content).picture : content};
}

/** Use the manuscript's explicit spoken interval, otherwise the shot span. */
export function shotCaptionSpans(text:string, heading:string, frames:number) {
  const seconds = (match:RegExpMatchArray|null) => match ? Math.round(Number(match[1])*30) : undefined;
  const start = seconds(heading.match(/第\s*(\d+(?:\.\d+)?)\s*秒\s*(?:开始|开口|起)/)) ?? 0;
  const end = seconds(heading.match(/第\s*(\d+(?:\.\d+)?)\s*秒(?:前)?\s*(?:收住|结束|停止)/)) ?? frames;
  return generatedSubtitleSpans(text,start,Math.min(end,frames)-start);
}
