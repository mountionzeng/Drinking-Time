/**
 * 多轨剪辑的唯一写入口。
 *
 * 以前客户端要移动一个素材，必须自己重建整份 items 数组，再连同 expectedVersion
 * 整份覆盖回来：服务端无从知道用户想动哪一个 clip，也就无法验证「只有它该动」；
 * 客户端拿着的版本号一旦被别处的自动保存顶掉，整次拖动就悄悄回滚。
 *
 * 这里改成服务端自己读—改—写：调用方只说「哪个 clip、去哪条轨、去哪一帧」。
 */
import type {
  StoryTimelineItem,
  StoryTimelineOverlay,
  StoryTimelineVisualLayerState,
} from "../../shared/storyMaterial";
import {
  insertVisualImageClip,
  moveVisualClip,
  removeVisualClip,
  type InsertVisualImageClipInput,
  type VisualEditDocument,
} from "../../shared/visualClipModel";
import { getStoryTimeline, updateStoryTimeline } from "../db";

export type VisualClipEditResult =
  | {
      status: "ok";
      timelineVersion: number;
      /** false 表示目标位置与当前一致，没有写入。 */
      changed: boolean;
    }
  | { status: "error"; error: string };

async function loadVisualEditDocument(
  storyId: number,
  userId: number
): Promise<
  { document: VisualEditDocument; version: number } | { error: string }
> {
  const row = await getStoryTimeline(storyId, userId);
  if (!row) return { error: "这个故事还没有时间线" };
  if (!Array.isArray(row.items)) return { error: "时间线数据异常，无法编辑" };
  return {
    document: {
      items: row.items as StoryTimelineItem[],
      ...(Array.isArray(row.overlays)
        ? { overlays: row.overlays as StoryTimelineOverlay[] }
        : {}),
      ...(row.visualLayerState
        ? {
            visualLayerState:
              row.visualLayerState as StoryTimelineVisualLayerState,
          }
        : {}),
    },
    version: row.version,
  };
}

/**
 * 每个命令都是同一套动作：读文档 → 纯函数改它 → 服务端自己持有版本 CAS 写回。
 * 三个命令时这段还能靠复制粘贴过日子，加到十个就不行了——所以在扩之前先抽出来，
 * 让「命令」这件事只剩下「你要对文档做什么」这一个变量。
 */
type VisualEditMutation = (
  document: VisualEditDocument
) =>
  | { status: "ok"; document: VisualEditDocument; changed?: boolean }
  | { status: "error"; message: string };

async function withVisualEditDocument(
  input: { storyId: number; userId: number; failureMessage: string },
  mutate: VisualEditMutation
): Promise<VisualClipEditResult> {
  const loaded = await loadVisualEditDocument(input.storyId, input.userId);
  if ("error" in loaded) return { status: "error", error: loaded.error };

  const result = mutate(loaded.document);
  if (result.status === "error") {
    return { status: "error", error: result.message };
  }
  // 目标与当前一致：不写库，也就不会因为重试把版本号越推越高。
  if (result.changed === false) {
    return { status: "ok", timelineVersion: loaded.version, changed: false };
  }

  try {
    const saved = await updateStoryTimeline({
      storyId: input.storyId,
      userId: input.userId,
      // 版本来自刚刚这次服务端读取，客户端不再持有版本号。
      expectedVersion: loaded.version,
      items: result.document.items,
      ...(result.document.overlays === undefined
        ? {}
        : { overlays: result.document.overlays }),
      ...(result.document.visualLayerState === undefined
        ? {}
        : { visualLayerState: result.document.visualLayerState }),
    });
    return { status: "ok", timelineVersion: saved.version, changed: true };
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : input.failureMessage,
    };
  }
}

export async function moveVisualClipForStory(input: {
  storyId: number;
  userId: number;
  clipId: string;
  toTrackId: string;
  toStartFrame: number;
}): Promise<VisualClipEditResult> {
  return withVisualEditDocument(
    { storyId: input.storyId, userId: input.userId, failureMessage: "移动没有保存成功" },
    document =>
      moveVisualClip(document, {
        clipId: input.clipId,
        toTrackId: input.toTrackId,
        toStartFrame: input.toStartFrame,
      })
  );
}

export async function insertVisualImageClipForStory(input: {
  storyId: number;
  userId: number;
  clip: InsertVisualImageClipInput;
}): Promise<VisualClipEditResult> {
  return withVisualEditDocument(
    { storyId: input.storyId, userId: input.userId, failureMessage: "素材没有放置成功" },
    document => insertVisualImageClip(document, input.clip)
  );
}

export async function removeVisualClipForStory(input: {
  storyId: number;
  userId: number;
  clipId: string;
}): Promise<VisualClipEditResult> {
  return withVisualEditDocument(
    { storyId: input.storyId, userId: input.userId, failureMessage: "素材没有删除成功" },
    document => removeVisualClip(document, input.clipId)
  );
}
