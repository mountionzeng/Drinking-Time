import {
  withTimelineDurationMs,
  type StoryTimelineItem,
  type StoryTimelineVisualClip,
  type TimelineTransform,
  type TimelineVideoEffects,
} from "./storyMaterial";

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
        if (item.visualClipsReplacePrimary && clip.offsetMs >= previousEndMs - 1) {
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
