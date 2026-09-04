import { displayShotCode } from "@shared/shotIdentity";
import {
  type TimelineTransform,
  type TimelineVideoEffects,
} from "@shared/storyMaterial";
import {
  resolveSubtitleRenderPlanAtFrame,
  type SubtitleRenderPlan,
} from "@shared/timelineSubtitleModel";

import {
  chatCutCueCode,
  chatCutPlaybackAudioTracks,
  type ChatCutTimelineManifest,
} from "./chatCutTimeline";
import type { CreationEditorShot } from "./types";
import { videoTakeAffordance } from "./videoAssetViewModel";
import type {
  VideoClipEditDraft,
  VideoClipEditorTarget,
} from "./videoClipEditorModel";

export const PREVIEW_CANVAS_INSET_PX = 12;

export type VideoEditorPreview = {
  target: VideoClipEditorTarget;
  draft: VideoClipEditDraft;
};

export function fitProjectCanvas(input: {
  stageWidth: number;
  stageHeight: number;
  projectWidth: number;
  projectHeight: number;
  inset?: number;
}) {
  const inset = Number.isFinite(input.inset)
    ? Math.max(0, input.inset ?? 0)
    : 0;
  const availableWidth = Math.max(0, input.stageWidth - inset);
  const availableHeight = Math.max(0, input.stageHeight - inset);
  const projectWidth =
    Number.isFinite(input.projectWidth) && input.projectWidth > 0
      ? input.projectWidth
      : 1;
  const projectHeight =
    Number.isFinite(input.projectHeight) && input.projectHeight > 0
      ? input.projectHeight
      : 1;
  const projectAspect = projectWidth / projectHeight;

  if (availableWidth === 0 || availableHeight === 0) {
    return { width: 0, height: 0 };
  }
  if (availableWidth / availableHeight > projectAspect) {
    return {
      width: Math.floor(availableHeight * projectAspect),
      height: Math.floor(availableHeight),
    };
  }
  return {
    width: Math.floor(availableWidth),
    height: Math.floor(availableWidth / projectAspect),
  };
}

export function shotLabel(
  shot: Pick<CreationEditorShot, "cueCode" | "shotKey" | "shotNo">
) {
  return displayShotCode(shot);
}

export function adoptedVideoTake(
  shot: CreationEditorShot | null
): NonNullable<CreationEditorShot["selectedVideoTake"]> | null {
  if (!shot) return null;
  const persistedTakeId = shot.timelineItem?.primaryVideoEdit?.takeId;
  const take =
    shot.selectedVideoTake ??
    (persistedTakeId == null
      ? null
      : (shot.videoTakes?.find(candidate => candidate.id === persistedTakeId) ??
        null));
  return take?.videoUrl && videoTakeAffordance(take.status).canPlay
    ? take
    : null;
}

export function playableVideoUrl(
  shot: CreationEditorShot | null
): string | null {
  return adoptedVideoTake(shot)?.videoUrl ?? null;
}

export function shotImageUrl(shot: CreationEditorShot | null): string | null {
  return shot?.imageUrl || shot?.promptRun?.imageUrl || null;
}

const PREVIEW_CONTROL_PAUSE_WINDOW_MS = 1_200;

export function shouldForwardPreviewPause(input: {
  timelinePlaying: boolean;
  ignoreNextPause: boolean;
  mediaIsCurrent: boolean;
  mediaConnected: boolean;
  mediaEnded: boolean;
  lastInteractionAtMs: number | null;
  nowMs: number;
}): boolean {
  const interactionAgeMs =
    input.lastInteractionAtMs == null
      ? null
      : input.nowMs - input.lastInteractionAtMs;
  return (
    input.timelinePlaying &&
    !input.ignoreNextPause &&
    input.mediaIsCurrent &&
    input.mediaConnected &&
    !input.mediaEnded &&
    interactionAgeMs != null &&
    interactionAgeMs >= 0 &&
    interactionAgeMs <= PREVIEW_CONTROL_PAUSE_WINDOW_MS
  );
}

export type EditingShortcutTargetKind = "text" | "button" | "other";

/** Preview/时间线悬停快捷键：按钮焦点可以接管，文字输入始终让开。 */
export function shouldHandleEditingShortcut(input: {
  key: string;
  zoneActive: boolean;
  defaultPrevented: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  targetKind: EditingShortcutTargetKind;
}): boolean {
  const isArrowKey = input.key === "ArrowLeft" || input.key === "ArrowRight";
  const isSpaceKey = input.key === " " || input.key === "Spacebar";
  return (
    (isArrowKey || isSpaceKey) &&
    input.zoneActive &&
    !input.defaultPrevented &&
    !input.metaKey &&
    !input.ctrlKey &&
    !input.altKey &&
    input.targetKind !== "text"
  );
}

export type TimelineVideoSource = {
  shotNo: number;
  stableShotId: string;
  takeStableShotId: string;
  takeId: number;
  rangeId: number | null;
  videoUrl: string;
  sourceStartSec: number;
  sourceEndSec: number;
  sourceTimeSec: number;
  offsetMs: number;
  durationMs: number;
  existingClipId: string | null;
  label: string;
  effects: TimelineVideoEffects;
  transform: TimelineTransform;
  overlayId?: string;
  visualLayer: number;
};

export function extractedFrameTargetVisualLayer(source: {
  visualLayer: number;
}): number {
  return Math.max(0, Math.round(source.visualLayer)) + 1;
}

export function canEditCurrentVideoFrame(input: {
  hasVideo: boolean;
  timelinePlaying: boolean;
  extracting: boolean;
}): boolean {
  return input.hasVideo && !input.timelinePlaying && !input.extracting;
}

/**
 * Storyboard 的显式镜头选择要移动唯一播放头；播放头自己推进产生的选中
 * 只更新界面投影，不能再反向 seek，否则每次跨镜都会回跳到镜头起点。
 */
export function selectedShotPlayheadSyncTarget(input: {
  selectedShotNo: number | null | undefined;
  selectionFromPlayheadShotNo: number | null | undefined;
  timing?: { startMs: number } | null;
}): number | null {
  if (input.selectedShotNo == null || !input.timing) return null;
  if (input.selectionFromPlayheadShotNo === input.selectedShotNo) return null;
  return Math.max(0, input.timing.startMs);
}

export function previewMediaLayerPlan(input: {
  timelineImageUrl?: string | null;
  editorVideoUrl?: string | null;
  timelineVideoUrl?: string | null;
  fallbackVideoUrl?: string | null;
  posterUrl?: string | null;
}) {
  const videoUrl =
    input.editorVideoUrl ??
    input.timelineVideoUrl ??
    input.fallbackVideoUrl ??
    null;
  const overlayImageUrl = videoUrl ? (input.timelineImageUrl ?? null) : null;
  return {
    videoUrl,
    overlayImageUrl,
    standaloneImageUrl: videoUrl
      ? null
      : (input.timelineImageUrl ?? input.posterUrl ?? null),
    posterUrl: input.posterUrl ?? null,
  };
}

export const VIDEO_END_HOLD_EPSILON_SECONDS = 1 / 120;

export function timelineVideoPlaybackRate(
  source: Pick<
    TimelineVideoSource,
    "sourceStartSec" | "sourceEndSec" | "durationMs"
  > & { effects?: TimelineVideoEffects }
): number {
  if (source.effects) return source.effects.playbackRate;
  const sourceDurationSec = Math.max(
    0,
    source.sourceEndSec - source.sourceStartSec
  );
  const timelineDurationSec = Math.max(0, source.durationMs / 1_000);
  if (sourceDurationSec <= 0 || timelineDurationSec <= 0) return 1;
  return Math.min(4, Math.max(0.25, sourceDurationSec / timelineDurationSec));
}

export function timelineVideoShouldHoldLastFrame(input: {
  targetTimeSec: number;
  sourceStartSec: number;
  sourceEndSec: number;
  reverse?: boolean;
}): boolean {
  if (input.sourceEndSec <= input.sourceStartSec) return false;
  return input.reverse
    ? input.targetTimeSec <=
        input.sourceStartSec + VIDEO_END_HOLD_EPSILON_SECONDS
    : input.targetTimeSec >=
        input.sourceEndSec - VIDEO_END_HOLD_EPSILON_SECONDS;
}

export type PreviewSubtitleLine = {
  id: string;
  text: string;
  /**
   * `timeline` 是已落库的正式字幕（用户改过的就是这个）；`candidate` 是还没
   * 生成字幕时按来源文字算出的只读预览，界面必须标出来，不能让人以为改得动。
   */
  source: "timeline" | "candidate";
};

/**
 * Preview 的唯一字幕来源。
 *
 * 有正式字幕轨时只消费 shared resolver 的结果（重叠 cue 按稳定顺序同时显示），
 * 不再自己解释 ChatCut 或镜头 dialogue；没有正式轨时才回落到旧候选，并明确
 * 标成 candidate。U8 的导出会消费同一份 resolver 结果。
 */
export function previewSubtitleLines(input: {
  subtitlePlan: SubtitleRenderPlan | null;
  playheadFrame: number;
  playheadMs: number;
  legacyManifest: ChatCutTimelineManifest | null;
  fallbackDialogue?: string | null;
}): PreviewSubtitleLine[] {
  const hasFormalTrack = Boolean(
    input.subtitlePlan && input.subtitlePlan.cues.length
  );
  if (hasFormalTrack) {
    return resolveSubtitleRenderPlanAtFrame(
      input.subtitlePlan!,
      input.playheadFrame
    ).map(cue => ({
      id: cue.id,
      text: cue.text,
      source: "timeline" as const,
    }));
  }
  const legacy = timelineSubtitleText(
    input.legacyManifest,
    input.playheadMs,
    input.fallbackDialogue
  );
  return legacy ? [{ id: "candidate", text: legacy, source: "candidate" }] : [];
}

export function timelineSubtitleText(
  manifest: ChatCutTimelineManifest | null,
  playheadMs: number,
  fallbackDialogue?: string | null
): string | null {
  const fallback = fallbackDialogue?.trim() || null;
  if (!manifest) return fallback;
  const activeVoiceClip = chatCutPlaybackAudioTracks(manifest)
    .flatMap(track => track.clips)
    .find(
      clip =>
        Boolean(chatCutCueCode(clip.name)) &&
        playheadMs >= clip.startMs &&
        playheadMs < clip.endMs
    );
  if (!activeVoiceClip) return null;
  const cueCode = chatCutCueCode(activeVoiceClip.name);
  const scriptedText = cueCode
    ? manifest.scriptCues.find(cue => cue.code === cueCode)?.text.trim()
    : "";
  return scriptedText || fallback;
}
