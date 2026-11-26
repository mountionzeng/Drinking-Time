import { readShotField } from "@shared/bookShotFormat";
import { shotOutputSource } from "@shared/bookShotActions";
import { readBookAudio } from "@shared/bookAudioBlock";
import { readBookImage } from "@shared/bookImageBlock";
import { blockAncestors, blockBody, blockSubtreeEnd, newWritingBlock, type WritingBlock } from "./chapterBlockTree";

type MotionPart = { id: string; raw: string; start: number; end: number };
/** The stored heading stays in the manuscript while the textarea exposes its body. */
export function motionTextPrefix(text: string) {
  const first = text.split("\n",1)[0];
  if (readShotField(first)?.kind !== "motion") return "";
  const colon = first.search(/[：:]/u);
  if (colon < 0) return first + "\n";
  const after = colon + 1;
  return first.slice(0, after + (first.trimStart().startsWith("**") && first.slice(after).startsWith("**") ? 2 : 0));
}

/** Keep source offsets so the menu can focus the original motion text in mixed manuscripts. */
export function readMotionDraft(blocks: WritingBlock[], shotId: string) {
  const index = blocks.findIndex(b => b.id === shotId && b.format === "shot");
  if (index < 0) throw new Error("本镜已变化，请重新打开。");
  const parts: MotionPart[] = [];
  let motion = false;
  for (const block of blocks.slice(index + 1, blockSubtreeEnd(blocks, index))) {
    if (block.parentId !== shotId || block.format !== "text") continue;
    if (readBookImage(block.text) || readBookAudio(block.text)) continue;
    if (block.videoRole === "dialogue") { motion = false; continue; }
    let offset = 0;
    let part: MotionPart | undefined;
    for (const line of block.text.split("\n")) {
      const field = readShotField(line);
      const end = offset + line.length;
      if (field) {
        motion = field.kind === "motion";
        part = undefined;
      }
      if (motion) {
        if (!part) {
          const start = field ? Math.min(end, offset + motionTextPrefix(line).length) : offset;
          part = {id:block.id, raw:block.text, start, end};
          parts.push(part);
        } else {
          if (part.start === part.end) part.start = offset;
          part.end = end;
        }
      }
      offset = end + 1;
    }
  }
  // A heading in its own module is already represented by its editable continuation.
  const filled = parts.filter(p => p.raw.slice(p.start,p.end).trim());
  const editable = filled.length ? filled : parts.slice(0,1);
  const inherited = editable.length ? "" : shotOutputSource(blocks,index,"video")?.prompt ?? "";
  return {shotId, parts:editable, values:editable.length ? editable.map(p=>p.raw.slice(p.start,p.end)) : [inherited]};
}

export function motionEditTarget(blocks: WritingBlock[], shotId: string, selectedId: string) {
  const draft = readMotionDraft(blocks, shotId);
  const part = draft.parts.find(p => p.id === selectedId) ?? draft.parts[0];
  let next = blocks;
  let id: string, cursor: number;
  if (part) {
    id = part.id;
    cursor = part.end;
  } else {
    const field = newWritingBlock("视频：" + draft.values[0], shotId);
    const at = blockSubtreeEnd(blocks, blocks.findIndex(b => b.id === shotId));
    next = [...blocks.slice(0, at), field, ...blocks.slice(at)];
    if (blockBody(next).length > 200000) throw new Error("书稿已达到长度上限，请缩短后再保存。");
    id = field.id;
    cursor = field.text.length;
  }
  const ancestors = blockAncestors(next, id);
  if (next.some(b => b.collapsed && ancestors.includes(b.id)))
    next = next.map(b => ancestors.includes(b.id) ? {...b, collapsed:false} : b);
  return {blocks:next, id, cursor};
}
