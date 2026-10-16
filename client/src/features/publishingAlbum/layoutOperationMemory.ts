import { z } from "zod";
import { selectionContentFingerprint } from "@shared/selectionContext";
import {
  layoutOperationKindSchema,
  type LayoutMemoryContext,
  type LayoutOperationKind,
} from "@shared/layoutOperationMemory";
import type { ImagePackModule, ModuleDocument } from "./imagePackModules";

const eventSchema = z.object({
  id: z.string(),
  scope: z.string().max(2000),
  at: z.number().finite().nonnegative(),
  kind: layoutOperationKindSchema,
  summary: z.string().min(1).max(700),
  before: z.string(),
  after: z.string(),
  undone: z.boolean(),
});
export type LayoutOperation = z.infer<typeof eventSchema>;
export type LayoutAction = {
  kind: LayoutOperationKind;
  moduleId?: string;
  page: number;
};
export const LAYOUT_MEMORY_EVENT = "dt:layout-operation-memory";
export const layoutMemoryKey = (accountId: number, storyId: number) =>
  `dt:layout-memory:v1:${accountId}:${storyId}`;
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readLayoutMemory(
  storage: Pick<StorageLike, "getItem"> | null,
  key: string
): LayoutOperation[] {
  try {
    const parsed = z
      .array(eventSchema)
      .safeParse(JSON.parse(storage?.getItem(key) ?? "[]"));
    return parsed.success ? parsed.data.slice(-100) : [];
  } catch {
    return [];
  }
}

const fingerprint = (document: ModuleDocument) =>
  selectionContentFingerprint(JSON.stringify(document));
function find(document: ModuleDocument, id?: string) {
  for (const [page, value] of document.pages.entries()) {
    const module = value.modules.find(item => item.id === id);
    if (module) return { module, page };
  }
  return undefined;
}
const excerpt = (text: string) => text.replace(/\s+/g, " ").slice(0, 110);
const position = (module: ImagePackModule) =>
  `左侧${(module.rect.x / 9).toFixed(1)}%、顶部${(module.rect.y / 12).toFixed(1)}%`;
const size = (module: ImagePackModule) =>
  `页宽${(module.rect.width / 9).toFixed(1)}% × 页高${(module.rect.height / 12).toFixed(1)}%`;
const style = (module: ImagePackModule) =>
  module.kind === "text"
    ? `${module.emphasis === "bright" ? "加粗浅色字" : "正常文字"}、${module.backdrop ? "有半透明底色" : "无底色"}`
    : "";

export function describeLayoutOperation(
  before: ModuleDocument,
  after: ModuleDocument,
  action: LayoutAction
) {
  const old = find(before, action.moduleId),
    next = find(after, action.moduleId);
  const module = next?.module ?? old?.module;
  const label = `第 ${(next?.page ?? old?.page ?? action.page) + 1} 页${module ? `的${module.kind === "text" ? "文字" : "图片"}模块` : ""}`;
  switch (action.kind) {
    case "text":
      return `${label}改字：由「${old?.module.kind === "text" ? excerpt(old.module.text) : ""}」改为「${next?.module.kind === "text" ? excerpt(next.module.text) : ""}」。`;
    case "style":
      return `${label}：由${old ? style(old.module) : "原样式"}改为${next ? style(next.module) : "新样式"}。`;
    case "move":
      return `${label}移动：${old ? position(old.module) : "原位置"} → ${next ? position(next.module) : "新位置"}。`;
    case "resize":
      return `${label}缩放：${old ? size(old.module) : "原尺寸"} → ${next ? size(next.module) : "新尺寸"}。`;
    case "crop":
      return `${label}裁切：${old?.module.kind === "image" ? JSON.stringify(old.module.crop) : ""} → ${next?.module.kind === "image" ? JSON.stringify(next.module.crop) : ""}（原图比例）。`;
    case "move-page":
      return `把${module?.kind === "text" ? "文字" : "图片"}模块从第 ${(old?.page ?? action.page) + 1} 页移到第 ${(next?.page ?? action.page) + 1} 页。`;
    case "add-text":
      return `${label}新增文字。`;
    case "add-image":
      return `${label}加入一张图片。`;
    case "delete-module":
      return `删除${label}${old?.module.kind === "text" ? `「${excerpt(old.module.text)}」` : ""}。`;
    case "insert-page":
      return `在第 ${action.page + 1} 页位置插入空白页，整套从${before.pages.length}页变成${after.pages.length}页。`;
    case "delete-page":
      return `删除第 ${action.page + 1} 页，整套从${before.pages.length}页变成${after.pages.length}页。`;
    case "arrange":
      return `主动整理第 ${action.page + 1} 页的模块排列。`;
  }
}

export function recordLayoutOperation(
  events: LayoutOperation[],
  scope: string,
  before: ModuleDocument,
  after: ModuleDocument,
  action: LayoutAction
): LayoutOperation[] {
  const beforeId = fingerprint(before),
    afterId = fingerprint(after);
  if (beforeId === afterId) return events;
  return [
    ...events,
    {
      id: crypto.randomUUID(),
      scope,
      at: Date.now(),
      kind: action.kind,
      summary: describeLayoutOperation(before, after, action),
      before: beforeId,
      after: afterId,
      undone: false,
    },
  ].slice(-100);
}

/** Undo/redo change the interpretation of the original gesture, never count as a preference. */
export function markLayoutOperation(
  events: LayoutOperation[],
  scope: string,
  before: ModuleDocument,
  after: ModuleDocument,
  undo: boolean
) {
  const beforeId = fingerprint(undo ? after : before),
    afterId = fingerprint(undo ? before : after);
  const index = events.findLastIndex(
    item =>
      item.scope === scope &&
      item.before === beforeId &&
      item.after === afterId &&
      item.undone !== undo
  );
  return index < 0
    ? events
    : events.map((item, at) =>
        at === index ? { ...item, undone: undo } : item
      );
}

export function layoutMemoryContext(
  events: LayoutOperation[],
  storyId: number,
  scope: string
): LayoutMemoryContext {
  return {
    storyId,
    scope,
    total: events.length,
    recent: events.slice(-20).map(item => ({
      kind: item.kind,
      summary: item.summary,
      undone: item.undone,
      at: item.at,
      sameSource: item.scope === scope,
    })),
  };
}

export function clearLayoutMemory(accountId: number, storyId: number) {
  const key = layoutMemoryKey(accountId, storyId);
  localStorage.removeItem(key);
  window.dispatchEvent(new CustomEvent(LAYOUT_MEMORY_EVENT, { detail: key }));
}
