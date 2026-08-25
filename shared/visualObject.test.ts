import { describe, expect, it } from "vitest";
import { visualObjectRefFromClip, visualObjectRefKey } from "./visualObject";

describe("visualObjectRefFromClip", () => {
  it.each([
    [
      { kind: "shot", stableShotId: "shot-a" },
      "story-shot",
      "story-shot:shot-a",
    ],
    [
      { kind: "video-clip", ownerStableShotId: "shot-a", clipId: "clip-v" },
      "owned-video-clip",
      "owned-video-clip:shot-a:clip-v",
    ],
    [
      { kind: "image-clip", ownerStableShotId: "shot-a", clipId: "clip-i" },
      "image-clip",
      "image-clip:shot-a:clip-i",
    ],
  ] as const)("maps %o without parsing the clip id", (origin, type, key) => {
    const ref = visualObjectRefFromClip({ id: "opaque", origin });
    expect(ref?.type).toBe(type);
    expect(ref && visualObjectRefKey(ref)).toBe(key);
  });

  it("keeps legacy overlays readable but out of the canonical object model", () => {
    expect(
      visualObjectRefFromClip({
        id: "opaque",
        origin: { kind: "overlay", overlayId: "old" },
      })
    ).toBeNull();
  });

  it("does not alias identically named clips owned by different shots", () => {
    expect(
      visualObjectRefKey({
        type: "image-clip",
        clipId: "same",
        ownerStableShotId: "a",
      })
    ).not.toBe(
      visualObjectRefKey({
        type: "image-clip",
        clipId: "same",
        ownerStableShotId: "b",
      })
    );
  });
});
