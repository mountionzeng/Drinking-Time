import { normalizeWritingColumns, type BookWritingStyle } from "@shared/bookWritingStyle";
import type { ModuleRect } from './imagePackModules';
export type BookPlacement = { page: number; rect: ModuleRect; fontSize: number };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export function readBookPlacement(raw: unknown): BookPlacement | undefined {
  if (!raw || typeof raw !== 'object') return;
  const value = raw as BookPlacement;
  if (!Number.isInteger(value.page) || value.page < 0 || value.page > 999 || !value.rect ||
    ![value.rect.x, value.rect.y, value.rect.width, value.rect.height, value.fontSize].every(Number.isFinite)) return;
  const width = clamp(value.rect.width, 24, 900), height = clamp(value.rect.height, 24, 1200);
  return { page: value.page, fontSize: clamp(value.fontSize, 12, 120), rect: {
    width, height, x: clamp(value.rect.x, 0, 900 - width), y: clamp(value.rect.y, 0, 1200 - height),
  } };
}


import { textModuleLines } from './moduleTextEditing';

export type BlockFormat = 'text' | 'heading1' | 'heading2' | 'heading3';
export type WritingBlock = { id: string; text: string; format: BlockFormat; parentId: string | null; collapsed: boolean; emphasis?: "normal" | "bright"; backdrop?: boolean; columnGroup?: string; book?: BookPlacement };
export type BlockDrop = 'before' | 'inside' | 'after';
export const blockBody = (blocks: WritingBlock[]) => blocks.map(block => block.text).join('\n');
export const newWritingBlock = (text: string, parentId: string | null = null): WritingBlock => ({ id: crypto.randomUUID(), text, parentId, format: 'text', collapsed: false });
export const isHeading = (block: WritingBlock) => block.format !== 'text';

export function blockAncestors(blocks: WritingBlock[], id: string): string[] {
  const byId = new Map(blocks.map(block => [block.id, block]));
  const result: string[] = [];
  let parent = byId.get(id)?.parentId;
  while (parent && byId.has(parent) && !result.includes(parent)) {
    result.push(parent); parent = byId.get(parent)?.parentId;
  }
  return result;
}
export function blockSubtreeEnd(blocks: WritingBlock[], index: number) {
  let end = index + 1;
  while (end < blocks.length && blockAncestors(blocks, blocks[end].id).includes(blocks[index].id)) end++;
  return end;
}

/** A heading owns explicit children; collapsing does not change that ownership. */
export function insertBlockText(blocks: WritingBlock[], index: number, text: string) {
  const lines = textModuleLines(text);
  const current = blocks[index];
  const next = blocks.map(block => ({ ...block }));
  next[index].text = lines[0];
  const parent = isHeading(current) && !current.collapsed ? current.id : current.parentId;
  const at = isHeading(current) && current.collapsed ? blockSubtreeEnd(blocks, index) : index + 1;
  const inserted = lines.slice(1).map(line => newWritingBlock(line, parent));
  next.splice(at, 0, ...inserted);
  return { blocks: next, insertedIndex: inserted.length ? at : index };
}

export function setBlockFormat(blocks: WritingBlock[], index: number, format: BlockFormat) {
  const current = blocks[index];
  // Turning a title into ordinary text lifts its children one level without moving them.
  return blocks.map((block, i) => i === index ? { ...block, format, collapsed: false, ...(block.book ? { book: { ...block.book, fontSize: format === 'heading1' ? 36 : format === 'heading2' ? 32 : format === 'heading3' ? 28 : 24 } } : {}) } :
    format === 'text' && block.parentId === current.id ? { ...block, parentId: current.parentId } : block);
}

export function moveWritingBlock(blocks: WritingBlock[], sourceId: string, targetId: string, placement: BlockDrop): WritingBlock[] {
  const from = blocks.findIndex(block => block.id === sourceId);
  const to = blocks.findIndex(block => block.id === targetId);
  if (from < 0 || to < 0 || from === to) return blocks;
  const end = blockSubtreeEnd(blocks, from);
  if (to >= from && to < end || placement === 'inside' && !isHeading(blocks[to])) return blocks;
  const moving = blocks.slice(from, end).map(block => ({ ...block }));
  const rest = blocks.filter((_, index) => index < from || index >= end).map(block => ({ ...block }));
  const targetIndex = rest.findIndex(block => block.id === targetId);
  const target = rest[targetIndex];
  moving[0].parentId = placement === 'inside' ? target.id : target.parentId;
  const at = placement === 'before' ? targetIndex : blockSubtreeEnd(rest, targetIndex);
  if (placement === 'inside') target.collapsed = false;
  rest.splice(at, 0, ...moving);
  return rest;
}

/** Keyboard merges only adjacent visible siblings, never content hidden under a title. */
export function mergeWritingBlocks(blocks: WritingBlock[], index: number) {
  const left = blocks[index], right = blocks[index + 1];
  if (!left || !right || left.parentId !== right.parentId || isHeading(left) || isHeading(right)) return blocks;
  return [...blocks.slice(0, index), { ...left, text: left.text + right.text }, ...blocks.slice(index + 2)];
}

export function restoreWritingBlocks(value: string, saved: unknown): WritingBlock[] {
  const fresh = () => textModuleLines(value).map(line => newWritingBlock(line));
  if (!saved || typeof saved !== 'object') return fresh();
  const record = saved as { body?: unknown; blocks?: unknown; formats?: Record<string, unknown> };
  if (record.body !== value) return fresh();
  if (Array.isArray(record.blocks)) {
    const result: WritingBlock[] = [];
    for (const raw of record.blocks) {
      if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || typeof raw.text !== 'string' || raw.text.includes('\n') || !['text', 'heading1', 'heading2', 'heading3'].includes(raw.format) || result.some(b => b.id === raw.id)) return fresh();
      const parent = raw.parentId === null ? null : result.find(b => b.id === raw.parentId && isHeading(b));
      if (raw.parentId !== null && !parent) return fresh();
      result.push({ id: raw.id, text: raw.text, format: raw.format, parentId: parent?.id ?? null, collapsed: isHeading(raw) && raw.collapsed === true,
        ...(typeof raw.columnGroup === 'string' && raw.columnGroup.length > 0 && raw.columnGroup.length <= 100 ? { columnGroup: raw.columnGroup } : {}),
        ...(raw.emphasis === "bright" ? { emphasis: "bright" as const } : {}),
        ...(raw.backdrop === true ? { backdrop: true } : {}),
        ...(readBookPlacement(raw.book) ? { book: readBookPlacement(raw.book) } : {}),
      });
    }
    if (blockBody(result) !== value) return fresh();
    // Each subtree must be contiguous, or moving it could collect unrelated text.
    if (result.some((block, i) => block.parentId && !blockAncestors(result, result[i - 1]?.id ?? '').includes(block.parentId) && result[i - 1]?.id !== block.parentId)) return fresh();
    return normalizeWritingColumns(result);
  }
  // Preserve the previous preview's heading ranges when upgrading local metadata.
  const result = fresh();
  const stack: WritingBlock[] = [];
  result.forEach((block, index) => {
    const format = record.formats?.[index];
    if (format === 'heading1' || format === 'heading2' || format === 'heading3') {
      block.format = format;
      while (stack.length && stack[stack.length - 1].format >= format) stack.pop();
    }
    block.parentId = stack.at(-1)?.id ?? null;
    if (isHeading(block)) stack.push(block);
  });
  return result;
}

export const writingStyleOf = (blocks:WritingBlock[]):BookWritingStyle => blocks.map(({text,...style})=>style);
export const restoreStyledBlocks = (body:string,style:BookWritingStyle):WritingBlock[] => restoreWritingBlocks(body,{body,blocks:style.map((row,index)=>({...row,text:textModuleLines(body)[index]}))});
