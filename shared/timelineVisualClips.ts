import {
  timelineFramesToMs,
  timelineMsToFrames,
  timelineOffsetMsToFrames,
  withTimelineDurationMs,
  type StoryTimelineItem,
  type StoryTimelineVisualClip,
  type TimelineTransform,
  type TimelineVideoEffects,
} from "./storyMaterial";
import { buildTimelineLayout } from "./timelineLayout";

export type SplitOwnedVideoClipResult =
  | { status: "ok"; items: StoryTimelineItem[]; rightClipId: string }
  | { status: "error"; message: string };

function cloneVisualClip(
  clip: StoryTimelineVisualClip
): StoryTimelineVisualClip {
  return {
    ...clip,
    ...(clip.effects
      ? {
          effects: {
            ...clip.effects,
            motionPreset: clip.effects.motionPreset
              ? { ...clip.effects.motionPreset }
              : null,
          },
        }
      : {}),
    ...(clip.transform ? { transform: { ...clip.transform } } : {}),
  };
}

/** Split one owned clip at an absolute 30fps timeline frame. */
export function splitOwnedTimelineVisualClip(input: {
  items: readonly StoryTimelineItem[];
  ownerStableShotId: string;
  clipId: string;
  cutFrame: number;
  rightClipId: string;
}): SplitOwnedVideoClipResult {
  if (!Number.isInteger(input.cutFrame)) {
    return { status: "error", message: "切点必须落在 30fps 的完整帧上" };
  }
  const owner = input.items.find(
    item => item.stableShotId === input.ownerStableShotId
  );
  if (!owner) return { status: "error", message: "找不到视频片段所属镜头" };
  const source = owner.visualClips ?? [];
  const clip = source.find(entry => entry.id === input.clipId);
  if (!clip)
    return { status: "error", message: "所属镜头中找不到这个视频片段" };
  if (
    !input.rightClipId ||
    input.rightClipId === input.clipId ||
    input.items.some(item =>
      item.visualClips?.some(entry => entry.id === input.rightClipId)
    )
  ) {
    return { status: "error", message: "新片段身份已被占用" };
  }

  // Implicitly positioned items are laid out after their predecessors. Using
  // `timelineStartFrame ?? 0` here would interpret every such owner as the
  // first shot and split at the wrong absolute frame.
  const ownerStartFrame = buildTimelineLayout(input.items).find(
    row => row.item.stableShotId === input.ownerStableShotId
  )?.startFrame;
  if (ownerStartFrame == null) {
    return { status: "error", message: "无法解析视频片段所属镜头的位置" };
  }
  const clipStartFrame =
    ownerStartFrame + timelineOffsetMsToFrames(clip.offsetMs);
  const totalFrames = timelineMsToFrames(clip.durationMs);
  const leftFrames = input.cutFrame - clipStartFrame;
  const rightFrames = totalFrames - leftFrames;
  if (leftFrames < 1 || rightFrames < 1) {
    return { status: "error", message: "切点两侧都必须至少保留一帧" };
  }
  if (!(clip.sourceEndSec > clip.sourceStartSec)) {
    return { status: "error", message: "视频片段的源范围无效" };
  }

  const spanSec = clip.sourceEndSec - clip.sourceStartSec;
  const reverse = Boolean(clip.effects?.reverse);
  const boundarySec = reverse
    ? clip.sourceEndSec - (spanSec * leftFrames) / totalFrames
    : clip.sourceStartSec + (spanSec * leftFrames) / totalFrames;
  const left = cloneVisualClip(clip);
  left.durationMs = timelineFramesToMs(leftFrames);
  left.sourceStartSec = reverse ? boundarySec : clip.sourceStartSec;
  left.sourceEndSec = reverse ? clip.sourceEndSec : boundarySec;
  const right = cloneVisualClip(clip);
  right.id = input.rightClipId;
  right.offsetMs = clip.offsetMs + left.durationMs;
  right.durationMs = timelineFramesToMs(rightFrames);
  right.sourceStartSec = reverse ? clip.sourceStartSec : boundarySec;
  right.sourceEndSec = reverse ? boundarySec : clip.sourceEndSec;

  return {
    status: "ok",
    rightClipId: input.rightClipId,
    items: input.items.map(item =>
      item.stableShotId !== input.ownerStableShotId
        ? item
        : {
            ...item,
            visualClips: (item.visualClips ?? []).flatMap(entry =>
              entry.id === input.clipId ? [left, right] : entry
            ),
          }
    ),
  };
}

function clipEndMs(clip: StoryTimelineVisualClip): number {
  return clip.offsetMs + clip.durationMs;
}

function insertionOffset(
  clips: readonly StoryTimelineVisualClip[],
  requestedOffsetMs: number | undefined
): number {
  const endMs = clips.reduce(
    (maximum, clip) => Math.max(maximum, clipEndMs(clip)),
    0
  );
  if (requestedOffsetMs == null || !Number.isFinite(requestedOffsetMs)) {
    return endMs;
  }
  const requested = Math.min(endMs, Math.max(0, requestedOffsetMs));
  const containingClip = clips.find(
    clip => requested > clip.offsetMs && requested < clipEndMs(clip)
  );
  return containingClip ? clipEndMs(containingClip) : requested;
}

/**
 * Inserts one video as a sequential clip. If the shot still uses a primary
 * video, callers can supply its lossless clip representation so the insert
 * switches the shot to multi-clip playback without replacing existing media.
 */
export function insertTimelineVisualClip(input: {
  item: StoryTimelineItem;
  clip: StoryTimelineVisualClip;
  primaryClip?: StoryTimelineVisualClip | null;
  targetOffsetMs?: number;
}): StoryTimelineItem {
  const existing = input.item.visualClipsReplacePrimary
    ? [...(input.item.visualClips ?? [])]
    : [
        ...(input.primaryClip ? [input.primaryClip] : []),
        ...(input.item.visualClips ?? []),
      ];
  const offsetMs = insertionOffset(existing, input.targetOffsetMs);
  const shifted = existing.map(clip =>
    clip.offsetMs >= offsetMs
      ? { ...clip, offsetMs: clip.offsetMs + input.clip.durationMs }
      : clip
  );
  const visualClips = [
    ...shifted,
    {
      ...input.clip,
      offsetMs,
    },
  ].sort(
    (left, right) =>
      left.offsetMs - right.offsetMs || left.id.localeCompare(right.id)
  );
  const endMs = visualClips.reduce(
    (maximum, clip) => Math.max(maximum, clipEndMs(clip)),
    0
  );
  return {
    ...withTimelineDurationMs(input.item, endMs),
    visualClips,
    visualClipsReplacePrimary: true,
  };
}

export type TimelineVideoEditInput = {
  stableShotId: string;
  takeId: number;
  clipId?: string | null;
  sourceStartSec: number;
  sourceEndSec: number;
  effects: TimelineVideoEffects;
  transform: TimelineTransform;
};

export type TimelineVideoEditResult =
  | { status: "ok"; items: StoryTimelineItem[] }
  | { status: "error"; message: string };

/**
 * 改一段视频的入出点、速度、音量与构图。
 *
 * 两种目标分开走：没有 clipId 时改的是镜头的主视频；带 clipId 时改的是镜头
 * 内部的一个片段，且要把它后面的片段整体顺移——否则改短一段会在中间留下
 * 一个空洞，改长则会和后一段重叠。
 *
 * 纯函数，服务端与测试共用；调用方只给意图，不给算好的 items。
 */
export function applyTimelineVideoEdit(
  items: readonly StoryTimelineItem[],
  input: TimelineVideoEditInput
): TimelineVideoEditResult {
  const sourceStartSec = Math.max(0, input.sourceStartSec);
  const sourceEndSec = Math.max(sourceStartSec + 1 / 30, input.sourceEndSec);
  const effects: TimelineVideoEffects = {
    playbackRate: Math.min(4, Math.max(0.25, input.effects.playbackRate)),
    reverse: Boolean(input.effects.reverse),
    volume: Math.min(2, Math.max(0, input.effects.volume)),
    muted: Boolean(input.effects.muted),
    motionPreset:
      input.effects.motionPreset?.kind === "heartbeat"
        ? {
            kind: "heartbeat",
            bpm: Math.min(180, Math.max(36, input.effects.motionPreset.bpm)),
            scaleAmount: Math.min(
              0.16,
              Math.max(0.01, input.effects.motionPreset.scaleAmount)
            ),
          }
        : null,
  };
  const durationMs = Math.max(
    100,
    Math.round(((sourceEndSec - sourceStartSec) * 1_000) / effects.playbackRate)
  );

  const currentItem = items.find(
    item => item.stableShotId === input.stableShotId
  );
  if (!currentItem) return { status: "error", message: "当前镜头不在时间线上" };

  if (input.clipId) {
    const sourceClips = currentItem.visualClips ?? [];
    const sourceClip = sourceClips.find(clip => clip.id === input.clipId);
    if (!sourceClip || sourceClip.takeId !== input.takeId) {
      return { status: "error", message: "找不到要编辑的视频片段" };
    }
  }

  const nextItems = items.map(item => {
    if (item.stableShotId !== input.stableShotId) return item;
    if (!input.clipId) {
      return {
        ...withTimelineDurationMs(item, durationMs),
        transform: input.transform,
        primaryVideoEdit: {
          takeId: input.takeId,
          sourceStartSec,
          sourceEndSec,
          effects,
        },
      };
    }

    const sourceClips = item.visualClips ?? [];
    const sourceClip = sourceClips.find(clip => clip.id === input.clipId)!;
    const previousEndMs = sourceClip.offsetMs + sourceClip.durationMs;
    const deltaMs = durationMs - sourceClip.durationMs;
    const visualClips = sourceClips
      .map(clip => {
        if (clip.id === input.clipId) {
          return {
            ...clip,
            sourceStartSec,
            sourceEndSec,
            durationMs,
            effects,
            transform: input.transform,
          };
        }
        // 只有「片段替代主画面」时后面的片段才排在一条线上，需要顺移。
        if (
          item.visualClipsReplacePrimary &&
          clip.offsetMs >= previousEndMs - 1
        ) {
          return { ...clip, offsetMs: Math.max(0, clip.offsetMs + deltaMs) };
        }
        return clip;
      })
      .sort((left, right) => left.offsetMs - right.offsetMs);
    const clipEndMs = visualClips.reduce(
      (maximum, clip) => Math.max(maximum, clip.offsetMs + clip.durationMs),
      0
    );
    return {
      ...withTimelineDurationMs(
        item,
        item.visualClipsReplacePrimary
          ? Math.max(100, clipEndMs)
          : Math.max(item.plannedDurationMs, clipEndMs)
      ),
      visualClips,
    };
  });

  return { status: "ok", items: nextItems };
}
