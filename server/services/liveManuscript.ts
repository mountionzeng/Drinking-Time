import { stripAssistantReasoning } from "../../shared/assistantReplyText";
import { parse } from "partial-json";
import { readBookAudio } from "../../shared/bookAudioBlock";
import { readBookImage } from "../../shared/bookImageBlock";
import { writingModuleTexts } from "../../shared/bookWritingStyle";
import type { ManuscriptContent } from "../../shared/bookWorkflow";

type Owner = { userId: number; storyId: number };
type Line = { number?: number; format: "title" | "shot" | "text"; text: string };
type Entry = { id: string; owner: Owner; kind: "text" | "storyboard"; raw: string; final?: Line[]; expires: number; showScenes?: boolean; shotNo?: number };
const entries = new Map<string, Entry>();
const key = (owner: Owner, id: string) => [owner.userId, owner.storyId, id].join(":");
const visible = (text: unknown): text is string => typeof text === "string" && Boolean(text.trim()) && !readBookAudio(text) && !readBookImage(text);

// Extract only manuscript fields. Provider reasoning, source metadata and incomplete JSON never appear on the page.
function previewLines(entry: Entry): Line[] {
  if (entry.shotNo !== undefined) return proseLines({ body: stripAssistantReasoning(entry.raw) });
  let value;
  try { value = parse(entry.raw.trimStart().replace(/^\x60\x60\x60(?:json)?\s*/u, "")); } catch { return []; }
  if (value?.draft) return proseLines(value.draft);
  if (Array.isArray(value?.changes)) {
    const lines: Line[]=[];
    let previous=0;
    for (const change of value.changes) {
      if (!Number.isSafeInteger(change?.shot) || change.shot<1 || !visible(change.text)) continue;
      if (previous!==change.shot) lines.push({format:"shot",number:change.shot,text:""});
      lines.push({format:"text",text:change.text});previous=change.shot;
    }
    return lines;
  }
  if (!Array.isArray(value?.chapters)) return [];
  const lines: Line[] = [];
  for (const chapter of value.chapters) {
    if (visible(chapter?.title)) lines.push({ format: "title", text: chapter.title });
    if (!Array.isArray(chapter?.modules)) continue;
    for (const m of chapter.modules) {
      if (!visible(m?.text) || m.media !== undefined || !m.format || (m.format === "scene" && !entry.showScenes)) continue;
      lines.push({ format: m.format === "shot" ? "shot" : "text", text: m.text });
    }
  }
  return lines;
}

function proseLines(draft: { title?: string; body?: string }): Line[] {
  const result: Line[] = [];
  if (visible(draft.title)) result.push({ format: "title", text: draft.title });
  if (visible(draft.body)) result.push({ format: "text", text: draft.body });
  return result;
}

/** Transient display only. Saving, adoption and billing use the validated final result. */
export function beginLiveManuscript(owner: Owner, id: string, kind: Entry["kind"], options: { showScenes?: boolean; shotNo?: number } = {}) {
  const k = key(owner, id);
  const entry: Entry = { owner: { storyId: owner.storyId, userId: owner.userId }, id, kind, ...options, raw: "", expires: Date.now() + 15 * 60_000 };
  entries.set(k, entry);
  const expiry = setTimeout(() => { if (entries.get(k) === entry) entries.delete(k); }, 15 * 60_000);
  expiry.unref();
  const finish = (lines: Line[]) => {
    entry.raw = ""; entry.final = lines; entry.expires = Date.now() + 60_000;
    clearTimeout(expiry);
    setTimeout(() => { if (entries.get(k) === entry) entries.delete(k); },60_000).unref();
  };
  return {
    append(text: string) { if (entry.raw.length < 500_000) entry.raw += text; },
    fail() { clearTimeout(expiry); if (entries.get(k) === entry) entries.delete(k); },
    finishText(draft: { title: string; body: string }) { finish(proseLines(draft)); },
    finishChapters(chapters: ManuscriptContent[]) {
      const lines: Line[] = [];
      for (const c of chapters) {
        lines.push({ format: "title", text: c.title });
        writingModuleTexts(c.blocks.body, c.blocks.writingStyle).forEach((text, i) => {
          const format = c.blocks.writingStyle?.[i]?.format;
          if (visible(text) && (format !== "scene" || entry.showScenes)) lines.push({ format: format === "shot" ? "shot" : "text", text });
        });
      }
      finish(lines);
    },
  };
}

export function liveManuscripts(owner: Owner) {
  return [...entries.values()].filter(e => e.owner.userId === owner.userId && e.owner.storyId === owner.storyId && e.expires > Date.now())
    .map(e => ({ id: e.id, kind: e.kind, shotNo: e.shotNo, complete: Boolean(e.final), lines: e.final ?? previewLines(e) }));
}
