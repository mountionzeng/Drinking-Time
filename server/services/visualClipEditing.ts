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
  projectVisualClips,
  removeVisualClip,
  type InsertVisualImageClipInput,
  type VisualClip,
  type VisualEditDocument,
} from "../../shared/visualClipModel";
import { getStoryTimeline, updateStoryTimeline } from "../db";

export type VisualClipEditResult =
  | {
      status: "ok";
      clip: VisualClip;
      clips: VisualClip[];
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

export async function listVisualClips(
  storyId: number,
  userId: number
): Promise<
  { status: "ok"; clips: VisualClip[]; timelineVersion: number } | { status: "error"; error: string }
> {
  const loaded = await loadVisualEditDocument(storyId, userId);
  if ("error" in loaded) return { status: "error", error: loaded.error };
  return {
    status: "ok",
    clips: projectVisualClips(loaded.document),
    timelineVersion: loaded.version,
  };
}

export async function moveVisualClipForStory(input: {
  storyId: number;
  userId: number;
  clipId: string;
  toTrackId: string;
  toStartFrame: number;
}): Promise<VisualClipEditResult> {
  const loaded = await loadVisualEditDocument(input.storyId, input.userId);
  if ("error" in loaded) return { status: "error", error: loaded.error };

  const moved = moveVisualClip(loaded.document, {
    clipId: input.clipId,
    toTrackId: input.toTrackId,
    toStartFrame: input.toStartFrame,
  });
  if (moved.status === "error") {
    return { status: "error", error: moved.message };
  }
  // 目标与当前一致：不写库，也就不会因为重试把版本号越推越高。
  if (!moved.changed) {
    return {
      status: "ok",
      clip: moved.clip,
      clips: projectVisualClips(loaded.document),
      timelineVersion: loaded.version,
      changed: false,
    };
  }

  try {
    const saved = await updateStoryTimeline({
      storyId: input.storyId,
      userId: input.userId,
      // 版本来自刚刚这次服务端读取，客户端不再持有版本号。
      expectedVersion: loaded.version,
      items: moved.document.items,
      ...(moved.document.overlays === undefined
        ? {}
        : { overlays: moved.document.overlays }),
      ...(moved.document.visualLayerState === undefined
        ? {}
        : { visualLayerState: moved.document.visualLayerState }),
    });
    return {
      status: "ok",
      clip: moved.clip,
      clips: projectVisualClips(moved.document),
      timelineVersion: saved.version,
      changed: true,
    };
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : "移动没有保存成功",
    };
  }
}

export async function insertVisualImageClipForStory(input: {
  storyId: number;
  userId: number;
  clip: InsertVisualImageClipInput;
}): Promise<VisualClipEditResult> {
  const loaded = await loadVisualEditDocument(input.storyId, input.userId);
  if ("error" in loaded) return { status: "error", error: loaded.error };

  const inserted = insertVisualImageClip(loaded.document, input.clip);
  if (inserted.status === "error") {
    return { status: "error", error: inserted.message };
  }
  try {
    const saved = await updateStoryTimeline({
      storyId: input.storyId,
      userId: input.userId,
      expectedVersion: loaded.version,
      items: inserted.document.items,
      ...(inserted.document.overlays === undefined
        ? {}
        : { overlays: inserted.document.overlays }),
      ...(inserted.document.visualLayerState === undefined
        ? {}
        : { visualLayerState: inserted.document.visualLayerState }),
    });
    return {
      status: "ok",
      clip: inserted.clip,
      clips: projectVisualClips(inserted.document),
      timelineVersion: saved.version,
      changed: true,
    };
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : "素材没有放置成功",
    };
  }
}

export async function removeVisualClipForStory(input: {
  storyId: number;
  userId: number;
  clipId: string;
}): Promise<VisualClipEditResult> {
  const loaded = await loadVisualEditDocument(input.storyId, input.userId);
  if ("error" in loaded) return { status: "error", error: loaded.error };

  const removed = removeVisualClip(loaded.document, input.clipId);
  if (removed.status === "error") {
    return { status: "error", error: removed.message };
  }
  try {
    const saved = await updateStoryTimeline({
      storyId: input.storyId,
      userId: input.userId,
      expectedVersion: loaded.version,
      items: removed.document.items,
      ...(removed.document.overlays === undefined
        ? {}
        : { overlays: removed.document.overlays }),
      ...(removed.document.visualLayerState === undefined
        ? {}
        : { visualLayerState: removed.document.visualLayerState }),
    });
    return {
      status: "ok",
      clip: removed.removed,
      clips: projectVisualClips(removed.document),
      timelineVersion: saved.version,
      changed: true,
    };
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : "素材没有删除成功",
    };
  }
}
