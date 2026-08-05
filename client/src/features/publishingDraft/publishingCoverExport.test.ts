import { describe, expect, it } from "vitest";
import {
  buildPublishingCoverExportPlan,
  coverCropRect,
  publishingCoverFileName,
  wrapPublishingCoverTitle,
} from "./publishingCoverExport";

describe("publishing cover export", () => {
  it("derives different deterministic crops from the same square master", () => {
    const xCrop = coverCropRect(1080, 1080, 1600, 900);
    const xiaohongshuCrop = coverCropRect(1080, 1080, 1080, 1440);

    expect(xCrop).toEqual({
      sourceX: 0,
      sourceY: 236.25,
      sourceWidth: 1080,
      sourceHeight: 607.5,
    });
    expect(xiaohongshuCrop).toEqual({
      sourceX: 135,
      sourceY: 0,
      sourceWidth: 810,
      sourceHeight: 1080,
    });
  });

  it("uses the platform output dimensions and safe area without another image job", () => {
    const plan = buildPublishingCoverExportPlan({
      platform: "instagram",
      sourceWidth: 1024,
      sourceHeight: 1024,
    });

    expect(plan.output).toEqual({ width: 1080, height: 1350 });
    expect(plan.safeRect).toEqual({
      x: 108,
      y: 135,
      width: 864,
      height: 1080,
    });
  });

  it("wraps long titles deterministically and ellipsizes only the last line", () => {
    const lines = wrapPublishingCoverTitle({
      title: "真正稀缺的不是 token 而是人类愿意认真判断什么值得做",
      maxWidth: 70,
      maxLines: 3,
      measure: value => value.length * 10,
    });

    expect(lines).toHaveLength(3);
    expect(lines[2].endsWith("…")).toBe(true);
    expect(
      wrapPublishingCoverTitle({
        title: "   ",
        maxWidth: 100,
        maxLines: 3,
        measure: value => value.length * 10,
      })
    ).toEqual([]);
  });

  it("produces a filesystem-safe platform filename", () => {
    expect(publishingCoverFileName("AI / token 的浪费", "x")).toBe(
      "AI-token-的浪费-X-1600x900.png"
    );
  });
});
