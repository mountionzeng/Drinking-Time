import type { StoryTimelineItem, StoryTimelineOverlay } from "./storyMaterial";
import { timelineFramesToMs } from "./storyMaterial";
import type { TimelineVideoEffects } from "./storyMaterial";
import type { VisualEditDocument } from "./visualClipModel";

/** The normalizer intentionally depends only on durable binding facts. */
export type LegacyOverlayStoryShot = {
  stableShotId?: unknown;
  shotIdentity?: unknown;
  shotKey?: unknown;
};

export type LegacyOverlayTake = {
  id: number;
  stableShotId: string;
  videoUrl: string | null;
};

export type LegacyOverlayNormalizationInput = {
  /** Exact legacy record identity. Never infer a target from its source shot. */
  overlayId: string;
  /** Lets a replay recognize that the target has already become canonical. */
  sourceStableShotId: string;
  /** Durable media binding retained after the overlay itself has disappeared. */
  expectedVideoUrl: string;
  storyShots: readonly LegacyOverlayStoryShot[];
  document: VisualEditDocument;
  takes: readonly LegacyOverlayTake[];
};

export type LegacyOverlayNormalizationError =
  | "invalid-input"
  | "missing-story-shot"
  | "ambiguous-story-shot"
  | "missing-timeline-item"
  | "ambiguous-timeline-item"
  | "missing-take"
  | "ambiguous-take"
  | "missing-primary-edit"
  | "binding-mismatch"
  | "ambiguous-overlay";

export type LegacyOverlayNormalizationResult =
  | {
      status: "ok";
      changed: boolean;
      document: VisualEditDocument;
      normalizedItem: StoryTimelineItem;
      removedOverlay: StoryTimelineOverlay | null;
    }
  | {
      status: "error";
      error: LegacyOverlayNormalizationError;
      message: string;
    };

function error(
  kind: LegacyOverlayNormalizationError,
  message: string
): LegacyOverlayNormalizationResult {
  return { status: "error", error: kind, message };
}

function shotMatches(
  shot: LegacyOverlayStoryShot,
  stableShotId: string
): boolean {
  return (
    shot.stableShotId === stableShotId ||
    shot.shotIdentity === stableShotId ||
    shot.shotKey === stableShotId
  );
}

function cloneEffects(effects: TimelineVideoEffects): TimelineVideoEffects {
  return {
    ...effects,
    ...(effects.motionPreset
      ? { motionPreset: { ...effects.motionPreset } }
      : { motionPreset: effects.motionPreset }),
  };
}

/**
 * Convert exactly one legacy generated-video overlay into its already-created
 * Story/Timeline item. This is a pure planner: errors return no working set,
 * and success never mutates caller-owned objects.
 */
export function normalizeLegacyOverlay(
  input: LegacyOverlayNormalizationInput
): LegacyOverlayNormalizationResult {
  const overlayId = input.overlayId.trim();
  const sourceStableShotId = input.sourceStableShotId.trim();
  const expectedVideoUrl = input.expectedVideoUrl.trim();
  if (!overlayId || !sourceStableShotId || !expectedVideoUrl) {
    return error("invalid-input", "Legacy overlay identity or media is empty");
  }

  const shots = input.storyShots.filter(shot =>
    shotMatches(shot, sourceStableShotId)
  );
  if (shots.length === 0) {
    return error("missing-story-shot", "Legacy overlay source shot is missing");
  }
  if (shots.length !== 1) {
    return error(
      "ambiguous-story-shot",
      "Legacy overlay source shot is not unique"
    );
  }

  const items = input.document.items.filter(
    item => item.stableShotId === sourceStableShotId
  );
  if (items.length === 0) {
    return error(
      "missing-timeline-item",
      "Legacy overlay timeline item is missing"
    );
  }
  if (items.length !== 1) {
    return error(
      "ambiguous-timeline-item",
      "Legacy overlay timeline item is not unique"
    );
  }
  const item = items[0];
  if (!item.primaryVideoEdit) {
    return error(
      "missing-primary-edit",
      "Legacy overlay timeline item has no primary video edit"
    );
  }

  const overlaysById = (input.document.overlays ?? []).filter(
    overlay => overlay.id === overlayId
  );
  if (overlaysById.length > 1) {
    return error("ambiguous-overlay", "Legacy overlay id is not unique");
  }
  const overlay = overlaysById[0] ?? null;
  const overlaysForSource = (input.document.overlays ?? []).filter(
    candidate => candidate.sourceStableShotId === sourceStableShotId
  );
  if (
    overlaysForSource.length > 1 ||
    (overlaysForSource.length === 1 && overlaysForSource[0].id !== overlayId)
  ) {
    return error(
      "ambiguous-overlay",
      "More than one legacy overlay is bound to the source shot"
    );
  }
  if (overlay && overlay.sourceStableShotId !== sourceStableShotId) {
    return error(
      "binding-mismatch",
      "Legacy overlay is bound to another source shot"
    );
  }

  const takeId = overlay?.takeId ?? item.primaryVideoEdit.takeId;
  const takes = input.takes.filter(take => take.id === takeId);
  if (takes.length === 0) {
    return error("missing-take", "Legacy overlay take is missing");
  }
  if (takes.length !== 1) {
    return error("ambiguous-take", "Legacy overlay take is not unique");
  }
  const take = takes[0];
  const mediaUrl = overlay?.videoUrl ?? expectedVideoUrl;
  if (
    item.primaryVideoEdit.takeId !== takeId ||
    take.stableShotId !== sourceStableShotId ||
    take.videoUrl !== mediaUrl ||
    mediaUrl !== expectedVideoUrl
  ) {
    return error(
      "binding-mismatch",
      "Story shot, timeline item, take, and media binding do not agree"
    );
  }

  if (!overlay) {
    return {
      status: "ok",
      changed: false,
      document: input.document,
      normalizedItem: item,
      removedOverlay: null,
    };
  }

  const durationFrames = overlay.mediaEndFrame - overlay.startFrame;
  if (
    !Number.isInteger(overlay.startFrame) ||
    overlay.startFrame < 0 ||
    !Number.isInteger(durationFrames) ||
    durationFrames <= 0 ||
    !Number.isInteger(overlay.stackOrder) ||
    overlay.stackOrder < 0 ||
    (overlay.visualLayer != null &&
      (!Number.isInteger(overlay.visualLayer) || overlay.visualLayer < 0))
  ) {
    return error("binding-mismatch", "Legacy overlay placement is invalid");
  }

  const normalizedItem: StoryTimelineItem = {
    ...item,
    timelineStartFrame: overlay.startFrame,
    durationFrames,
    plannedDurationMs: timelineFramesToMs(durationFrames),
    stackOrder: overlay.stackOrder,
    visualLayer: overlay.visualLayer ?? 1,
    transform: { ...overlay.transform },
    primaryVideoEdit: {
      ...item.primaryVideoEdit,
      effects: cloneEffects(overlay.effects ?? item.primaryVideoEdit.effects),
    },
  };
  return {
    status: "ok",
    changed: true,
    document: {
      ...input.document,
      items: input.document.items.map(candidate =>
        candidate === item ? normalizedItem : candidate
      ),
      overlays: (input.document.overlays ?? []).filter(
        candidate => candidate !== overlay
      ),
    },
    normalizedItem,
    removedOverlay: overlay,
  };
}
