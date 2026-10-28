import { createContext, useContext, useEffect } from "react";
import {
  layoutMemoryContextSchema,
  type LayoutMemoryContext,
} from "@shared/layoutOperationMemory";
import {
  layoutModuleContextSchema,
  type LayoutModuleContext,
} from "@shared/layoutModuleContext";
import type { TextDraftContent } from "@shared/textDraftHistory";
import type { PublishingPlatformId } from "@shared/publishingDraft";
import type { MobileWritingContext } from "./mobileConversationStore";
export type MemoryFollowupSource = {
  kind?: "story" | "memory" | "text" | "video" | "layout";
  module?: LayoutModuleContext;
  layoutMemory?: LayoutMemoryContext;
  title?: string;
  stableShotId?: string;
  storyId: number;
  id: string;
  content: string;
  origin: "user" | "assistant" | "note";
  text?: {
    content: TextDraftContent;
    parentId: string | null;
    platform?: PublishingPlatformId;
    versionId?: string;
    bodyRevision?: number;
    cursor?: number;
    selection?: { start: number; end: number };
  };
};
export function mobileWritingContext(
  source: MemoryFollowupSource
): MobileWritingContext | undefined {
  if (source.kind === "layout" && (source.module || source.layoutMemory))
    return {
      draft: source.module?.pageText ?? "",
      cursor: 0,
      scope: source.module?.scope ?? source.layoutMemory!.scope,
      fullDraft: true,
      module: source.module,
      layoutMemory: source.layoutMemory,
    };
  if (source.kind !== "text") return undefined;
  const draft = source.text?.content.body ?? source.content;
  return {
    draft,
    cursor: source.text?.selection?.start ?? source.text?.cursor ?? draft.length,
    selection: source.text?.selection,
    scope: source.id,
    fullDraft: true,
  };
}

/** Every entry opens the same mounted chat, including entries inside editors. */
export function openMobileCompanion(source: MemoryFollowupSource) {
  window.dispatchEvent(
    new CustomEvent("dt:open-mobile-companion", { detail: source })
  );
}
export const MobileMemoryFollowup = createContext<{
  source: MemoryFollowupSource | null;
  select: (source: MemoryFollowupSource | null) => void;
  moduleSource?: MemoryFollowupSource | null;
  selectModule?: (source: MemoryFollowupSource | null) => void;
  storySource?: MemoryFollowupSource | null;
  selectStory?: (source: MemoryFollowupSource | null) => void;
}>({ source: null, select: () => {} });
export function memoryFollowupMessage(
  source: MemoryFollowupSource,
  thought: string
) {
  if (source.kind === "story") return thought.trim();
  const role =
    source.origin === "assistant"
      ? "小忆当时的回应（不是我的事实陈述）"
      : source.origin === "user"
        ? "我当时说的话"
        : "已保存的记事";
  const label = companionSourceLabel(source);
  return `我想接着这段${label}聊。请围绕我的新想法回应，需要时只问一个简短问题，不要擅自生成文字稿或视频，也不要编造经历。\n\n【引用${source.kind && source.kind !== "memory" ? label : "旧回忆"} · ${role} · 来源 ${source.id}】\n${source.content}\n【引用结束】\n\n【这次的新想法】\n${thought.trim()}`;
}

export const memoryFollowupKey = (userId: number) =>
  `dt:mobile:new-story:v1:${userId}:memory-followup`;
export function readMemoryFollowup(
  storage: Pick<Storage, "getItem"> | null,
  userId: number
): {
  source: MemoryFollowupSource | null;
  draft: string;
  baseline: string[] | null;
} {
  const empty = { source: null, draft: "", baseline: null };
  try {
    const value = JSON.parse(
      storage?.getItem(memoryFollowupKey(userId)) ?? "null"
    );
    const s = value?.source;
    if (
      !s ||
      !Number.isSafeInteger(s.storyId) ||
      s.storyId <= 0 ||
      typeof s.id !== "string" ||
      typeof s.content !== "string" ||
      !["user", "assistant", "note"].includes(s.origin) ||
      typeof value.draft !== "string" ||
      (s.kind === "layout" && !s.module && !s.layoutMemory) ||
      (s.module !== undefined &&
        (!layoutModuleContextSchema.safeParse(s.module).success ||
          s.module.storyId !== s.storyId)) ||
      (s.layoutMemory !== undefined &&
        (!layoutMemoryContextSchema.safeParse(s.layoutMemory).success ||
          s.layoutMemory.storyId !== s.storyId))
    )
      return empty;
    return {
      source: s,
      draft: value.draft,
      baseline:
        Array.isArray(value.baseline) &&
        value.baseline.every((x: unknown) => typeof x === "string")
          ? value.baseline
          : null,
    };
  } catch {
    return empty;
  }
}

export function companionSourceLabel(source: MemoryFollowupSource) {
  return source.kind === "story"
    ? "故事"
    : source.kind === "layout"
      ? source.module
        ? "排版模块"
        : "排版"
      : source.kind === "text"
        ? "文字"
        : source.kind === "video"
          ? "视频"
          : "回忆";
}
export function storyFollowupSource(
  storyId: number,
  title: string
): MemoryFollowupSource {
  return {
    kind: "story",
    storyId,
    id: `story:${storyId}`,
    title,
    content: title,
    origin: "note",
  };
}
export function videoFollowupSource(
  storyId: number,
  video: {
    id: number;
    stableShotId: string;
    subtitle: string | null;
    prompt: string;
    videoUrl: string | null;
  }
): MemoryFollowupSource {
  return {
    storyId,
    id: `video:${video.id}`,
    kind: "video",
    origin: "note",
    stableShotId: video.stableShotId,
    content: `视频素材 ${video.id}\n字幕：${video.subtitle || "无"}\n制作说明：${video.prompt || "无"}\n素材地址：${video.videoUrl || "尚未就绪"}\n以上是素材记录，不代表已观看或识别视频画面。`,
  };
}
export function useCompanionPageContext(source: MemoryFollowupSource | null) {
  const { select } = useContext(MobileMemoryFollowup);
  const serialized = JSON.stringify(source);
  useEffect(() => {
    select(JSON.parse(serialized));
    return () => select(null);
  }, [select, serialized]);
}
