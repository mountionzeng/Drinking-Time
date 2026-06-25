import { describe, expect, it } from "vitest";
import { inferSelectionMaterialStatus } from "./selectionContext";

describe("selection material status", () => {
  it("keeps explicit material status when provided", () => {
    expect(
      inferSelectionMaterialStatus({
        sourceType: "animatic-video",
        videoTakeId: 2,
        materialStatus: "failed-video",
      })
    ).toBe("failed-video");
  });

  it("infers timeline ranges before generic video/image context", () => {
    expect(
      inferSelectionMaterialStatus({
        sourceType: "timeline-range",
        videoTakeId: 2,
        rangeId: 7,
      })
    ).toBe("timeline-range");
  });

  it("infers current image for storyboard image selections", () => {
    expect(
      inferSelectionMaterialStatus({
        sourceType: "storyboard-image",
        imageId: 9,
      })
    ).toBe("current-image");
  });
});
