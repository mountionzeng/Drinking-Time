import { describe, expect, it } from "vitest";

import type { StoryTimelineItem } from "@shared/storyMaterial";
import { DEFAULT_TIMELINE_TRANSFORM } from "@shared/storyMaterial";

import { previewMaskTargetChanged } from "./previewObjectMaskEditing";
import { findTimelineImageClipLocation } from "./timelineImageClipLocation";

describe("findTimelineImageClipLocation", () => {
  it("retargets an extracted frame to its authoritative host instead of its video source", () => {
    const clipId = "extracted-frame-1";
    const items: StoryTimelineItem[] = [
      {
        stableShotId: "video-source-owner",
        included: true,
        position: 0,
        plannedDurationMs: 1_000,
        transform: { ...DEFAULT_TIMELINE_TRANSFORM },
      },
      {
        stableShotId: "deterministic-image-host",
        included: true,
        position: 1,
        plannedDurationMs: 1_000,
        transform: { ...DEFAULT_TIMELINE_TRANSFORM },
        imageClips: [
          {
            id: clipId,
            imageId: 1772,
            imageUrl: "/frame.png",
            label: "抽帧",
            offsetFrames: 0,
            timelineStartFrame: 1562,
            durationFrames: 1,
            visualLayer: 1,
          },
        ],
      },
    ];

    const location = findTimelineImageClipLocation(items, clipId);
    expect(location?.stableShotId).toBe("deterministic-image-host");

    const sessionTarget = {
      targetKind: "timeline-image-clip" as const,
      clipId,
      stableShotId: location!.stableShotId,
      shotNo: 2,
      imageId: location!.clip.imageId,
      imageUrl: location!.clip.imageUrl,
      label: "当前帧",
      transform: { ...DEFAULT_TIMELINE_TRANSFORM },
      textOverlay: null,
      defaultText: "",
    };
    expect(previewMaskTargetChanged(sessionTarget, { ...sessionTarget })).toBe(
      false
    );
    expect(
      previewMaskTargetChanged(
        { ...sessionTarget, stableShotId: "video-source-owner" },
        sessionTarget
      )
    ).toBe(true);
  });
});
