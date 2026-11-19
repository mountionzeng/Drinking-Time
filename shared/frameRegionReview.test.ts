import { describe, expect, it } from "vitest";
import { isForestGreenMatchEdit, cloudArtDirection, forestPaletteFeedbackDecision, forestPaletteStatus, isFrameRegionReviewImage, isFrameRegionChat, latestFrameRegionReview, regionReviewDecision, regionInheritanceDecision, regionTargets, regionInstruction, forestPaletteConsistencyDecision, reviseRegionScope, type FrameRegionReview } from "./frameRegionReview";
import { isFrameReferenceChat, referenceFrameOffsets } from "./chatFrameReference";

describe("multi-frame review routing", () => {
  it('hands object deletion to the review service for clarification, never treating it as approval', () => {
    for (const phase of ['scope_review', 'cancelled']) {
      const review = { phase, tasks: [], activeTarget: 'plane' } as any;
      for (const text of ['我的意思是只留一个飞机就好了', '不是这个范围，你只需要去掉一个飞机和他的尾巴就好了', '删除右边的小飞机']) {
        expect(isFrameRegionChat(text, review)).toBe(true);
        expect(regionReviewDecision(text)).toBeNull();
      }
    }
  });
  it("keeps explicit new scope requests local after cancellation without reviving old approvals", () => {
    const cancelled = { phase: "cancelled", tasks: [] } as any;
    expect(isFrameRegionChat("重新显示森林树冠范围，让绿色更协调统一", cancelled)).toBe(true);
    expect(isFrameRegionChat("确认森林范围", cancelled)).toBe(false);
    expect(isFrameRegionChat("确认图片", cancelled)).toBe(false);
    expect(isFrameRegionChat("确认生成云层", cancelled)).toBe(false);
  });
  it("recognizes coordinated greens without treating a refusal as a match request", () => {
    expect(isForestGreenMatchEdit("让绿色更协调统一、有层次")).toBe(true);
    expect(regionTargets("让森林树冠的绿色更协调统一、有层次。保护树干、飞机、云、地面和原有明暗。")).toEqual(["forest"]);
    expect(isForestGreenMatchEdit("不要统一绿色，只降低亮度")).toBe(false);
    expect(isForestGreenMatchEdit("各自配色，让绿色更协调")).toBe(false);
  });
  it("replaces earlier extra-cloud intent with less density without changing color intent", () => {
    const previous = cloudArtDirection('云再多一点，高光白色，阴影五颜六色，纹理少重复');
    for (const text of ['云还是太密集了', '少一点', '云稀疏一点', 'fewer clouds', 'less dense']) {
      expect(isFrameRegionChat(text, {phase:'image_review',activeTarget:'cloud',tasks:[]} as any)).toBe(true);
      expect(cloudArtDirection(text, previous)).toEqual({...previous,quantity:'fewer'});
    }
    expect(cloudArtDirection('不要减少云的数量', previous).quantity).toBe('preserve');
    expect(cloudArtDirection('云不够密集，再多一点', previous).quantity).toBe('slightly_more');
  });
  it("does not mistake generation, consistency or scope approval for color approval", () => {
    for (const text of ['确认范围','所有森林颜色保持一致','沿用上一帧','OK','森林颜色可以吗','不要确认森林配色'])
      expect(forestPaletteFeedbackDecision(text)).toBeNull();
    for (const text of ['森林配色我不满意','现在生成的这个图片更丑','reject forest colors','还要调整配色','森林配色还要调整 #2116'])
      expect(forestPaletteFeedbackDecision(text)).toBe('rejected');
    expect(forestPaletteFeedbackDecision('云层不好看')).toBeNull();
    expect(forestPaletteFeedbackDecision('不需要调整配色')).toBeNull();
    expect(forestPaletteFeedbackDecision('云层配色还要调整')).toBeNull();
    for (const text of ['确认森林配色','森林颜色可以','approve forest colors']) expect(forestPaletteFeedbackDecision(text)).toBe('accepted');
    expect(isFrameRegionChat('这个森林改色我不满意', {phase:'image_review',tasks:[]} as any)).toBe(true);
  });
  it("blocks descendants and transferred palettes after rejection, without affecting unrelated images", () => {
    const reviews = [{forestPaletteFeedback:[{imageId:10,decision:'rejected',at:1}],forestPaletteApplications:[{imageId:12,referenceImageId:10}]}] as FrameRegionReview[];
    expect(forestPaletteStatus(10,reviews)).toBe('rejected');
    expect(forestPaletteStatus(11,reviews,[{id:11,parentImageId:10}])).toBe('rejected');
    expect(forestPaletteStatus(12,reviews)).toBe('rejected');
    expect(forestPaletteStatus(13,reviews)).toBe('unreviewed');
    reviews.push({forestPaletteFeedback:[{imageId:12,decision:'accepted',at:2}]} as FrameRegionReview);
    expect(forestPaletteStatus(12,reviews)).toBe('accepted');
    expect(forestPaletteStatus(10,reviews)).toBe('rejected');
  });
  it("persists white highlights and colorful shadows independently across follow-ups", () => {
    const direction = cloudArtDirection('云高光是白色，阴影处五颜六色');
    expect(direction).toMatchObject({ highlights: 'white', shadows: 'colorful' });
    expect(cloudArtDirection('再厚一点', direction)).toEqual(direction);
    expect(cloudArtDirection('高光颜色保持原样', direction)).toMatchObject({ highlights: 'preserve', shadows: 'colorful' });
    expect(cloudArtDirection('white highlights, colorful shadows')).toMatchObject({ highlights: 'white', shadows: 'colorful' });
    expect(isFrameRegionChat('云高光是白色，阴影处五颜六色', { phase:'scope_review',activeTarget:'cloud',tasks:[] } as any)).toBe(true);
  });
  it("separates forest continuity from cloud color instructions", () => {
    const text='所有的森林颜色都是一致的，云高光是白色，阴影处五颜六色';
    expect(forestPaletteConsistencyDecision(text)).toBe('lock');
    expect(forestPaletteConsistencyDecision('不再统一森林配色')).toBe('release');
    expect(forestPaletteConsistencyDecision('所有森林颜色一致吗')).toBeNull();
    expect(regionInstruction(text,'cloud')).toBe('云高光是白色；阴影处五颜六色');
    expect(regionInstruction(text,'forest')).not.toContain('云');
  });
  it("retains texture intent on later refinements but allows an explicit correction", () => {
    const first=cloudArtDirection('云再多一点，纹理不要那么重复');
    expect(first).toEqual({quantity:'slightly_more',textureRepetition:'reduce'});
    expect(cloudArtDirection('云略多')).toMatchObject({quantity:'slightly_more'});
    expect(cloudArtDirection('白一点',first)).toEqual({...first,highlights:'white'});
    expect(cloudArtDirection('云数量保持不变，纹理保持原样',first)).toEqual({quantity:'preserve',textureRepetition:'preserve'});
    expect(cloudArtDirection('more clouds, avoid cloned textures')).toEqual(first);
  });
  it("requires an explicit inheritance decision, including in English", () => {
    for (const text of ["沿用上一帧", "确认继承", "use previous green", "沿用上一帧的森林处理", "继承上一帧的处理", "use previous forest treatment"]) expect(regionInheritanceDecision(text)).toBe("accept");
    for (const text of ["不继承", "不要沿用上一帧", "do not inherit"]) expect(regionInheritanceDecision(text)).toBe("decline");
    for (const text of ["沿用上一帧吗", "沿用上一帧之前先改范围", "OK"]) expect(regionInheritanceDecision(text)).toBeNull();
  });
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

import { regionTemporalFrames } from "./frameRegionReview";
it("keeps object edits separate and chooses frames from the requested temporal segment", () => {
  const text = "飞机只有一个，从第一帧面板飞出来；森林改成绿色；最后几帧云层更大更厚";
  const frames = [1,2,3,4,5].map(imageId => ({ imageId }));
  expect(regionInstruction(text,"forest")).toBe("森林改成绿色");
  expect(regionTemporalFrames(regionInstruction(text,"plane"),frames)).toEqual([1,2]);
  expect(regionTemporalFrames(regionInstruction(text,"cloud"),frames)).toEqual([4,5]);
});


it("keeps selected source derivatives and candidates in the existing region conversation", () => {
  const review = { frames: [{ imageId: 1 }], sourceImages: [{ imageId: 2 }], tasks: [
    { imageId: 2, candidate: { imageId: 3 }, shapeQuote: { sourceImageId: 4 } },
  ] } as FrameRegionReview;
  for (const id of [1, 2, 3, 4]) expect(isFrameRegionReviewImage(review, id)).toBe(true);
  expect(isFrameRegionReviewImage(review, 99)).toBe(false);
  expect(isFrameRegionReviewImage(undefined, 2)).toBe(false);
});
