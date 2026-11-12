import { describe, expect, it } from "vitest";
import { isFrameRegionChat, latestFrameRegionReview, regionReviewDecision, regionTargets, reviseRegionScope, type FrameRegionReview } from "./frameRegionReview";
import { isFrameReferenceChat, referenceFrameOffsets } from "./chatFrameReference";

describe("multi-frame review routing", () => {
  it("captures the requested count, opening and closing source moments", () => {
    for (const text of ["第03镜抽5帧", "抽取五张关键帧", "capture 5 frames"]) {
      expect(isFrameReferenceChat(text)).toBe(true);
      expect(referenceFrameOffsets(text, 240)).toEqual([0, 60, 120, 179, 239]);
    }
    expect(referenceFrameOffsets("抽3帧", 240)).toEqual([0, 120, 239]);
    expect(referenceFrameOffsets("抽5帧", 2)).toEqual([0, 1]);
    expect(isFrameReferenceChat("不要抽5帧")).toBe(false);
    expect(() => referenceFrameOffsets("抽7帧", 240)).toThrow();
  });
  it("keeps protected objects out of targets and never guesses a confirmation", () => {
    expect(regionTargets("森林改绿色，城市不动，云层保持原样，飞机只有一个")).toEqual(["forest", "plane"]);
    expect(regionReviewDecision("确认范围")).toBe("confirm_scope");
    expect(regionReviewDecision("确认森林范围")).toBe("confirm_scope");
    expect(regionReviewDecision("确认森林范围之前再检查")).toBeNull();
    for (const text of ["范围还不对", "确认范围之前再扩大一点", "不要确认范围", "OK", "确认"]) expect(regionReviewDecision(text)).toBeNull();
    expect(isFrameRegionChat("把森林改绿色")).toBe(false);
  });
  it("narrows a selected target while respecting threshold bounds", () => {
    expect(reviseRegionScope({ threshold: .69, area: "all" }, "森林范围缩小，只选左边")).toEqual({ threshold: .7, area: "left" });
    expect(reviseRegionScope({ threshold: .16, area: "right" }, "范围扩大一点，整片")).toEqual({ threshold: .15, area: "all" });
  });
  it("does not borrow a review from another shot or story", () => {
    const review = { storyId: 7, stableShotId: "third", shotNo: 3 } as FrameRegionReview;
    const messages = [{ frameReview: review }];
    expect(latestFrameRegionReview(messages, 7, "第3镜森林改绿", "other")).toBe(review);
    expect(latestFrameRegionReview(messages, 8, "确认范围")).toBeUndefined();
    expect(latestFrameRegionReview(messages, 7, "确认范围", "other")).toBeUndefined();
  });
});

import { regionInstruction, regionTemporalFrames } from "./frameRegionReview";
it("keeps object edits separate and chooses frames from the requested temporal segment", () => {
  const text = "飞机只有一个，从第一帧面板飞出来；森林改成绿色；最后几帧云层更大更厚";
  const frames = [1,2,3,4,5].map(imageId => ({ imageId }));
  expect(regionInstruction(text,"forest")).toBe("森林改成绿色");
  expect(regionTemporalFrames(regionInstruction(text,"plane"),frames)).toEqual([1,2]);
  expect(regionTemporalFrames(regionInstruction(text,"cloud"),frames)).toEqual([4,5]);
});
