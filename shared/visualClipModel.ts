/**
 * 普通多轨剪辑的唯一领域模型。
 *
 * 历史上「一个可拖动的剪辑块」在数据里有四种互不相同的形状：镜头 item 用绝对帧、
 * 图片 imageClip 用相对 owner 的 offsetFrames、附加片段 visualClip 用相对 owner 的
 * offsetMs、遗留 overlay 用另一套绝对帧。于是「把一张图片往右拖」被迫变成「客户端
 * 重建整份时间线再全量覆盖」，任何一处推导出错都表现为「拖了没反应」。
 *
 * 这个模块把四种形状投影成同一种 VisualClip，并且只暴露一个移动命令：
 * 一次调用只改一个 clip 的 track 与 start，其它 clip 的绝对位置一帧都不许变。
 * 它是唯一的兼容层——组件和 mutation 不应再自己理解 offsetFrames / owner 起点。
 */
import type {
  StoryTimelineItem,
  StoryTimelineOverlay,
  StoryTimelineVisualLayerState,
} from "./storyMaterial";
import {
  timelineFramesToMs,
  timelineImageClipStartFrame,
  timelineMsToFrames,
  timelineOffsetMsToFrames,
} from "./storyMaterial";
import {
  buildTimelineLayout,
  durationFramesForItem,
  overlayVisualLayer,
} from "./timelineLayout";
import { normalizeVisualLayer } from "./timelineVisualPriority";

export type VisualEditDocument = {
  items: StoryTimelineItem[];
  overlays?: StoryTimelineOverlay[];
  visualLayerState?: StoryTimelineVisualLayerState;
};

type VisualClipKind = "image" | "video";

/** clip 落在哪个持久化实体上。移动命令据此只改那一处。 */
export type VisualClipOrigin =
  | { kind: "shot"; stableShotId: string }
  | { kind: "image-clip"; ownerStableShotId: string; clipId: string }
  | { kind: "video-clip"; ownerStableShotId: string; clipId: string }
  | { kind: "overlay"; overlayId: string };

export type VisualClip = {
  /** 稳定且不透明；调用方只负责原样传回，不要解析。 */
  id: string;
  kind: VisualClipKind;
  trackId: string;
  /** 30fps 绝对起点。 */
  startFrame: number;
  /** 结构时长；一帧图片严格是 1。 */
  durationFrames: number;
  origin: VisualClipOrigin;
};

export type InsertVisualImageClipInput = {
  /** 稳定 id；同 id 重复插入只会替换那一个 clip，不会产生副本。 */
  clipId: string;
  imageId: number;
  imageUrl: string;
  label: string;
  trackId: string;
  startFrame: number;
  /** 抽帧默认严格一帧。 */
  durationFrames?: number;
};

type InsertVisualClipError =
  | "invalid-track"
  | "invalid-start"
  | "empty-timeline";

export type InsertVisualClipResult =
  | {
      status: "ok";
      document: VisualEditDocument;
      clip: VisualClip;
      /** false when the same placement intent was already fully applied. */
      changed: boolean;
    }
  | { status: "error"; error: InsertVisualClipError; message: string };

type RemoveVisualClipError = "clip-not-found" | "unsupported-kind";

export type RemoveVisualClipResult =
  | { status: "ok"; document: VisualEditDocument; removed: VisualClip }
  | { status: "error"; error: RemoveVisualClipError; message: string };

export type MoveVisualClipInput = {
  clipId: string;
  toTrackId: string;
  toStartFrame: number;
};

type MoveVisualClipError =
  | "clip-not-found"
  | "invalid-track"
  | "invalid-start"
  | "before-owner-start";

export type MoveVisualClipResult =
  | {
      status: "ok";
      document: VisualEditDocument;
      clip: VisualClip;
      /** false 表示目标与当前位置一致；重试同一次移动是幂等的。 */
      changed: boolean;
    }
  | { status: "error"; error: MoveVisualClipError; message: string };

const TRACK_ID_PREFIX = "track-";

export function visualTrackId(layer: number): string {
  return `${TRACK_ID_PREFIX}${normalizeVisualLayer(layer)}`;
}

/** 非法 trackId 返回 null，绝不猜一个层号——猜出来的层会把素材放到用户没选的地方。 */
function parseVisualTrackId(trackId: string): number | null {
  if (!trackId.startsWith(TRACK_ID_PREFIX)) return null;
  const raw = trackId.slice(TRACK_ID_PREFIX.length);
  if (!/^\d+$/.test(raw)) return null;
  return Number.parseInt(raw, 10);
}

function shotClipId(stableShotId: string): string {
  return `shot:${stableShotId}`;
}

function imageClipId(clipId: string): string {
  return `image:${clipId}`;
}

function videoClipId(clipId: string): string {
  return `video:${clipId}`;
}

function overlayClipId(overlayId: string): string {
  return `overlay:${overlayId}`;
}

function positiveFrames(value: number): number {
  return Math.max(1, Math.round(value));
}

/**
 * 把整份时间线投影成一组普通 clip。
 *
 * 这是读路径的唯一入口：调用方拿到的每个 clip 都已经是绝对帧，不需要再知道
 * 自己挂在谁下面。
 */
export function projectVisualClips(doc: VisualEditDocument): VisualClip[] {
  const clips: VisualClip[] = [];
  for (const row of buildTimelineLayout(doc.items)) {
    const item = row.item;
    clips.push({
      id: shotClipId(item.stableShotId),
      kind: item.primaryVideoEdit ? "video" : "image",
      trackId: visualTrackId(normalizeVisualLayer(item.visualLayer)),
      startFrame: row.startFrame,
      durationFrames: row.durationFrames,
      origin: { kind: "shot", stableShotId: item.stableShotId },
    });
    for (const clip of item.imageClips ?? []) {
      clips.push({
        id: imageClipId(clip.id),
        kind: "image",
        trackId: visualTrackId(normalizeVisualLayer(clip.visualLayer)),
        startFrame: timelineImageClipStartFrame(clip, row.startFrame),
        durationFrames: positiveFrames(clip.durationFrames),
        origin: {
          kind: "image-clip",
          ownerStableShotId: item.stableShotId,
          clipId: clip.id,
        },
      });
    }
    for (const clip of item.visualClips ?? []) {
      clips.push({
        id: videoClipId(clip.id),
        kind: "video",
        trackId: visualTrackId(normalizeVisualLayer(clip.visualLayer)),
        startFrame: row.startFrame + timelineOffsetMsToFrames(clip.offsetMs),
        durationFrames: timelineMsToFrames(clip.durationMs),
        origin: {
          kind: "video-clip",
          ownerStableShotId: item.stableShotId,
          clipId: clip.id,
        },
      });
    }
  }
  for (const overlay of doc.overlays ?? []) {
    clips.push({
      id: overlayClipId(overlay.id),
      kind: "video",
      trackId: visualTrackId(overlayVisualLayer(overlay)),
      startFrame: Math.max(0, Math.round(overlay.startFrame)),
      durationFrames: positiveFrames(overlay.endFrame - overlay.startFrame),
      origin: { kind: "overlay", overlayId: overlay.id },
    });
  }
  return clips;
}

function findVisualClip(
  doc: VisualEditDocument,
  clipId: string
): VisualClip | null {
  return projectVisualClips(doc).find(clip => clip.id === clipId) ?? null;
}

/**
 * 把所有派生位置钉成绝对值。
 *
 * 旧数据里 item 可以没有 timelineStartFrame（由前一个镜头的结尾推出来），图片可以
 * 只有 offsetFrames（由 owner 起点推出来）。只要还剩一个派生位置，移动任意一个
 * clip 都可能顺带挪动别人——这正是「移动底层视频带走上层图片」的来源。
 * 每次写入前先做一次这个迁移，之后每个 clip 的位置都只属于它自己。
 */
export function materializeAbsolutePlacements(
  doc: VisualEditDocument
): VisualEditDocument {
  const rows = buildTimelineLayout(doc.items);
  const rowByShotId = new Map(
    rows.map(row => [row.item.stableShotId, row] as const)
  );
  const items = doc.items.map(item => {
    const row = rowByShotId.get(item.stableShotId);
    const startFrame = row?.startFrame ?? 0;
    const next: StoryTimelineItem = {
      ...item,
      timelineStartFrame: startFrame,
      durationFrames: row?.durationFrames ?? durationFramesForItem(item),
    };
    if (item.imageClips?.length) {
      next.imageClips = item.imageClips.map(clip => {
        const absolute = timelineImageClipStartFrame(clip, startFrame);
        return {
          ...clip,
          timelineStartFrame: absolute,
          offsetFrames: Math.max(0, absolute - startFrame),
        };
      });
    }
    return next;
  });
  return { ...doc, items };
}

function replaceItem(
  doc: VisualEditDocument,
  stableShotId: string,
  update: (item: StoryTimelineItem) => StoryTimelineItem
): VisualEditDocument {
  return {
    ...doc,
    items: doc.items.map(item =>
      item.stableShotId === stableShotId ? update(item) : item
    ),
  };
}

/**
 * 唯一的移动命令：把一个 clip 原子地移到 (toTrackId, toStartFrame)。
 *
 * 规则：
 * - 图片和视频走同一条路径，一次斜向拖动只提交一次调用。
 * - 只写目标 clip 所在的那一个实体；其它 clip 的绝对位置必须逐帧不变。
 * - 移动镜头会带走它自己的内部片段（visualClips 是这个镜头的素材本身），
 *   但绝不带动独立的图片 clip、overlay 或别的镜头。
 * - 目标与当前位置相同时返回 changed:false，重试不会移动两次。
 */
export function moveVisualClip(
  doc: VisualEditDocument,
  input: MoveVisualClipInput
): MoveVisualClipResult {
  const layer = parseVisualTrackId(input.toTrackId);
  if (layer === null) {
    return {
      status: "error",
      error: "invalid-track",
      message: `无法识别的轨道：${input.toTrackId}`,
    };
  }
  if (!Number.isFinite(input.toStartFrame) || input.toStartFrame < 0) {
    return {
      status: "error",
      error: "invalid-start",
      message: "目标位置必须是不小于 0 的帧号",
    };
  }
  const toStartFrame = Math.round(input.toStartFrame);

  const base = materializeAbsolutePlacements(doc);
  const clip = findVisualClip(base, input.clipId);
  if (!clip) {
    return {
      status: "error",
      error: "clip-not-found",
      message: `时间线上找不到这个素材：${input.clipId}`,
    };
  }

  const targetTrackId = visualTrackId(layer);
  const changed =
    clip.trackId !== targetTrackId || clip.startFrame !== toStartFrame;

  let next: VisualEditDocument;
  switch (clip.origin.kind) {
    case "shot": {
      const stableShotId = clip.origin.stableShotId;
      next = replaceItem(base, stableShotId, item => {
        const moved: StoryTimelineItem = {
          ...item,
          timelineStartFrame: toStartFrame,
          visualLayer: layer,
        };
        // 图片 clip 的绝对位置已经钉死，这里只把相对字段跟着改回一致，
        // 免得两套坐标再次给出不同答案。
        if (item.imageClips?.length) {
          moved.imageClips = item.imageClips.map(imageClip => ({
            ...imageClip,
            offsetFrames: Math.max(
              0,
              timelineImageClipStartFrame(imageClip, clip.startFrame) -
                toStartFrame
            ),
          }));
        }
        return moved;
      });
      break;
    }
    case "image-clip": {
      const { ownerStableShotId, clipId } = clip.origin;
      next = replaceItem(base, ownerStableShotId, item => ({
        ...item,
        imageClips: (item.imageClips ?? []).map(imageClip =>
          imageClip.id === clipId
            ? {
                ...imageClip,
                timelineStartFrame: toStartFrame,
                offsetFrames: Math.max(
                  0,
                  toStartFrame - (item.timelineStartFrame ?? 0)
                ),
                visualLayer: layer,
              }
            : imageClip
        ),
      }));
      break;
    }
    case "video-clip": {
      const { ownerStableShotId, clipId } = clip.origin;
      const owner = base.items.find(
        item => item.stableShotId === ownerStableShotId
      );
      const ownerStart = owner?.timelineStartFrame ?? 0;
      // 附加片段只能表示成「owner 起点之后的偏移」，没有绝对字段可写。
      // 与其静默夹到 owner 起点（用户会看到素材跳到别处），不如明确失败。
      if (toStartFrame < ownerStart) {
        return {
          status: "error",
          error: "before-owner-start",
          message: "附加片段还不能移到所属镜头开始之前",
        };
      }
      next = replaceItem(base, ownerStableShotId, item => ({
        ...item,
        visualClips: (item.visualClips ?? []).map(videoClip =>
          videoClip.id === clipId
            ? {
                ...videoClip,
                offsetMs: timelineFramesToMs(toStartFrame - ownerStart),
                visualLayer: layer,
              }
            : videoClip
        ),
      }));
      break;
    }
    case "overlay": {
      const overlayId = clip.origin.overlayId;
      next = {
        ...base,
        overlays: (base.overlays ?? []).map(overlay => {
          if (overlay.id !== overlayId) return overlay;
          const delta = toStartFrame - overlay.startFrame;
          return {
            ...overlay,
            startFrame: toStartFrame,
            targetEndFrame: overlay.targetEndFrame + delta,
            mediaEndFrame: overlay.mediaEndFrame + delta,
            endFrame: overlay.endFrame + delta,
            visualLayer: layer,
          };
        }),
      };
      break;
    }
  }

  const movedClip = findVisualClip(next, input.clipId);
  return {
    status: "ok",
    document: next,
    clip: movedClip ?? clip,
    changed,
  };
}

/**
 * 挑一个宿主 item 存放图片 clip。
 *
 * 图片 clip 在存储上仍然挂在某个 item 的 imageClips 里，但位置已经是绝对帧，
 * 所以宿主是谁**不再影响它出现在哪里**——这里只需要一个确定的、可复现的选择：
 * 优先落在覆盖该帧的最底层镜头上，否则取它左边最近的那个，再否则取第一个。
 */
function hostItemForFrame(
  doc: VisualEditDocument,
  startFrame: number
): string | null {
  const rows = buildTimelineLayout(doc.items);
  if (rows.length === 0) return null;
  const covering = rows
    .filter(row => startFrame >= row.startFrame && startFrame < row.endFrame)
    .sort(
      (left, right) =>
        normalizeVisualLayer(left.item.visualLayer) -
          normalizeVisualLayer(right.item.visualLayer) ||
        left.startFrame - right.startFrame
    );
  if (covering.length > 0) return covering[0].item.stableShotId;
  const before = rows
    .filter(row => row.startFrame <= startFrame)
    .sort((left, right) => right.startFrame - left.startFrame);
  if (before.length > 0) return before[0].item.stableShotId;
  return rows[0].item.stableShotId;
}

/**
 * 插入一个普通图片 clip。
 *
 * 调用方只说「哪张图、去哪条轨、去哪一帧」，不需要（也不应该）知道它会被挂到
 * 哪个镜头下面。同一个 clipId 再插一次就是替换，不会留下重复素材。
 */
export function insertVisualImageClip(
  doc: VisualEditDocument,
  input: InsertVisualImageClipInput
): InsertVisualClipResult {
  const layer = parseVisualTrackId(input.trackId);
  if (layer === null) {
    return {
      status: "error",
      error: "invalid-track",
      message: `无法识别的轨道：${input.trackId}`,
    };
  }
  if (!Number.isFinite(input.startFrame) || input.startFrame < 0) {
    return {
      status: "error",
      error: "invalid-start",
      message: "落点必须是不小于 0 的帧号",
    };
  }
  const startFrame = Math.round(input.startFrame);
  const requestedDurationFrames = positiveFrames(input.durationFrames ?? 1);
  const base = materializeAbsolutePlacements(doc);
  const hostId = hostItemForFrame(base, startFrame);
  if (!hostId) {
    return {
      status: "error",
      error: "empty-timeline",
      message: "时间线上还没有任何镜头，无法放置素材",
    };
  }
  const existingProjection = findVisualClip(base, `image:${input.clipId}`);
  const existingImage = base.items
    .flatMap(item => item.imageClips ?? [])
    .find(clip => clip.id === input.clipId);
  if (
    existingProjection?.origin.kind === "image-clip" &&
    existingImage &&
    existingProjection.trackId === visualTrackId(layer) &&
    existingProjection.startFrame === startFrame &&
    existingProjection.durationFrames === requestedDurationFrames &&
    existingImage.imageId === input.imageId &&
    existingImage.imageUrl === input.imageUrl &&
    existingImage.label === input.label
  ) {
    return {
      status: "ok",
      document: doc,
      clip: existingProjection,
      changed: false,
    };
  }
  const hostStart =
    base.items.find(item => item.stableShotId === hostId)?.timelineStartFrame ??
    0;
  const inserted = {
    id: input.clipId,
    imageId: input.imageId,
    imageUrl: input.imageUrl,
    label: input.label,
    offsetFrames: Math.max(0, startFrame - hostStart),
    timelineStartFrame: startFrame,
    durationFrames: requestedDurationFrames,
    visualLayer: layer,
  };
  const next: VisualEditDocument = {
    ...base,
    items: base.items.map(item => {
      // 同 id 的旧 clip 无论挂在谁下面都先摘掉，避免换宿主时留下副本。
      const retained = (item.imageClips ?? []).filter(
        clip => clip.id !== input.clipId
      );
      if (item.stableShotId === hostId) {
        return { ...item, imageClips: [...retained, inserted] };
      }
      return retained.length === (item.imageClips ?? []).length
        ? item
        : { ...item, imageClips: retained };
    }),
  };
  const clip = findVisualClip(next, `image:${input.clipId}`);
  return {
    status: "ok",
    document: next,
    changed: true,
    clip: clip ?? {
      id: `image:${input.clipId}`,
      kind: "image",
      trackId: visualTrackId(layer),
      startFrame,
      durationFrames: inserted.durationFrames,
      origin: {
        kind: "image-clip",
        ownerStableShotId: hostId,
        clipId: input.clipId,
      },
    },
  };
}

/**
 * 移除一个普通 clip。
 *
 * 只处理「素材块」：图片 clip、镜头内部片段和遗留 overlay。删除一个镜头
 * （shot）牵涉故事分镜本身，不属于剪辑命令，这里明确拒绝而不是偷偷做掉。
 */
export function removeVisualClip(
  doc: VisualEditDocument,
  clipId: string
): RemoveVisualClipResult {
  const base = materializeAbsolutePlacements(doc);
  const clip = findVisualClip(base, clipId);
  if (!clip) {
    return {
      status: "error",
      error: "clip-not-found",
      message: `时间线上找不到这个素材：${clipId}`,
    };
  }
  switch (clip.origin.kind) {
    case "shot":
      return {
        status: "error",
        error: "unsupported-kind",
        message: "删除镜头要走分镜操作，不是剪辑块的删除",
      };
    case "image-clip": {
      const clipKey = clip.origin.clipId;
      return {
        status: "ok",
        removed: clip,
        document: {
          ...base,
          items: base.items.map(item =>
            item.imageClips?.some(candidate => candidate.id === clipKey)
              ? {
                  ...item,
                  imageClips: item.imageClips.filter(
                    candidate => candidate.id !== clipKey
                  ),
                }
              : item
          ),
        },
      };
    }
    case "video-clip": {
      const clipKey = clip.origin.clipId;
      return {
        status: "ok",
        removed: clip,
        document: {
          ...base,
          items: base.items.map(item =>
            item.visualClips?.some(candidate => candidate.id === clipKey)
              ? {
                  ...item,
                  visualClips: item.visualClips.filter(
                    candidate => candidate.id !== clipKey
                  ),
                }
              : item
          ),
        },
      };
    }
    case "overlay": {
      const overlayId = clip.origin.overlayId;
      return {
        status: "ok",
        removed: clip,
        document: {
          ...base,
          overlays: (base.overlays ?? []).filter(
            overlay => overlay.id !== overlayId
          ),
        },
      };
    }
  }
}
