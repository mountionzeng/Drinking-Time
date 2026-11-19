import { beforeEach, expect, it, vi } from "vitest";
import { prepareFrameReviewVideo } from "./frameReviewVideo";
import { runFrameRegionReview } from "./frameRegionReview";
import type { FrameRegionReview } from "../../shared/frameRegionReview";
import { isFrameReviewVideoRequest } from "../../shared/frameReviewVideo";

let review: FrameRegionReview, body: any, images: any[], material: any, d: any;
const id = "a7b27f0e-933e-4b6d-82d4-3b6d3def94c1";
const input = { userId: 1, storyId: 7, stableShotId: "shot-3",
  review: { reviewId: id, reviewRevision: 2, timelineVersion: 9 } };
beforeEach(() => {
  review = { id, revision: 2, storyId: 7, stableShotId: "shot-3", shotNo: 3,
    timelineVersion: 9, phase: "images_confirmed", createdAt: 1, updatedAt: 2, editorUserId: 1, instructions: [],
    frames: [0, 4, 8 - 1 / 30].map((sec, i) => ({ storyId: 7, stableShotId: "shot-3", shotNo: 3,
      imageId: i + 1, imageUrl: "/api/images/" + (i + 1) + ".png", sourceTimeSec: sec, shotTimeSec: sec, takeId: 10 })),
    tasks: [{ target: "forest", imageId: 2, instruction: "green", threshold: .35, area: "all", sourceSha: "sha", maskSha: "mask",
      maskUrl: "/api/images/mask.png", protectedUrl: "/api/images/protected.png", overlayUrl: "/api/images/overlay.png",
      selectedPixels: 20, candidate: { imageId: 4, imageUrl: "/api/images/4.png", changedPixels: 10, outsideChangedPixels: 0 } }],
    forestPaletteFeedback: [{ imageId: 4, decision: "accepted", at: 2, instruction: "确认图片" }] };
  body = { _revision: 1, frameRegionReviews: [review], shots: [{ stableShotId: "shot-3", videoPrompt: "Follow the plane slowly." }] };
  images = [1, 2, 3, 4].map(id => ({ id, storyId: 7, userId: 1, shotIdentity: "shot-3", imageUrl: "/api/images/" + id + ".png", parentImageId: id === 4 ? 2 : null }));
  material = { timeline: { version: 9 }, shots: [{ stableShotId: "shot-3", videoTakes: [{ id: 10, status: "available", durationSec: 8, aspectRatio: "1:1" }] }] };
  d = { story: vi.fn(async () => ({ body })), images: vi.fn(async () => images), material: vi.fn(async () => material) };
});

it("keeps source endpoints and substitutes the reviewed candidate in source-time order, without mutations", async () => {
  review.frames.reverse();
  const before = JSON.stringify(body);
  const plan = await prepareFrameReviewVideo(input, d);
  expect(plan).toMatchObject({ sourceTakeId: 10, sourceDurationSec: 8, segmentSeconds: 4, prompt: "Follow the plane slowly.", review: input.review });
  expect(plan.images.map(image => image.id)).toEqual([1, 4, 3]);
  expect(JSON.stringify(body)).toBe(before);
  expect(d.story).toHaveBeenCalledWith(7, 1);
});

it.each([
  ["unapproved", () => { review.phase = "image_review"; }],
  ["missing candidate", () => { delete review.tasks[0].candidate; }],
  ["stale review", () => { review.revision++; }],
  ["stale timeline", () => { material.timeline.version++; }],
  ["another owner", () => { review.editorUserId = 8; }],
  ["another shot", () => { review.stableShotId = "other"; }],
  ["foreign candidate", () => { images[3].userId = 8; }],
  ["missing lineage", () => { images[3].parentImageId = null; }],
  ["rejected candidate", () => { review.forestPaletteFeedback![0].decision = "rejected"; }],
  ["mixed source takes", () => { review.frames[1].takeId = 11; }],
  ["one frame", () => { review.frames = [review.frames[1]]; }],
  ["partial temporal coverage", () => { review.frames[0].sourceTimeSec = 1; }],
  ["uneven timing", () => { review.frames[1].sourceTimeSec = 3; }],
  ["source-duration mismatch", () => { material.shots[0].videoTakes[0].durationSec = 14.5; }],
  ["unavailable source", () => { material.shots[0].videoTakes[0].status = "failed"; }],
  ["source-aspect mismatch", () => { material.shots[0].videoTakes[0].aspectRatio = "9:16"; }],
  ["oversize direction", () => { body.shots[0].videoPrompt = "x".repeat(701); }],
] as const)("refuses %s rather than changing frames, timing or approval", async (_name, change) => {
  change();
  await expect(prepareFrameReviewVideo(input, d)).rejects.toThrow();
});

it("honors later rejection in another review of the same candidate", async () => {
  body.frameRegionReviews.push({ ...review, id: "b7b27f0e-933e-4b6d-82d4-3b6d3def94c1",
    forestPaletteFeedback: [{ imageId: 4, decision: "rejected", at: 3, instruction: "not happy" }] });
  await expect(prepareFrameReviewVideo(input, d)).rejects.toThrow("未认可");
});

it("does not choose between two incompatible edits of the same frame", async () => {
  images.push({ ...images[3], id: 5 });
  review.tasks.push({ ...review.tasks[0], target: "cloud", candidate: { ...review.tasks[0].candidate!, imageId: 5 } });
  await expect(prepareFrameReviewVideo(input, d)).rejects.toThrow("合成");
  images[4].parentImageId = 4;
  const plan = await prepareFrameReviewVideo(input, d);
  expect(plan.images.map(image => image.id)).toEqual([1, 5, 3]);
});

it("hands the real conversation operation to the read-only plan without editing the story", async () => {
  const update = vi.fn();
  const result = await runFrameRegionReview({ ...input, instruction: "第03镜生成视频", reviewId: id, expectedRevision: 2 },
    { ...d, update, videoPlan: (request: typeof input) => prepareFrameReviewVideo(request, d) });
  expect(result).toHaveProperty("videoPlan.images", expect.arrayContaining([expect.objectContaining({ id: 4 })]));
  expect(result.reply).toContain("尚未购买");
  expect(update).not.toHaveBeenCalled();
});

it.each(["生成视频", "检查第03镜生成视频还缺什么", "先查看视频报价", "generate video"])("routes %s to preflight", text => {
  expect(isFrameReviewVideoRequest(text)).toBe(true);
});
it.each(["不要生成视频", "先不生成视频", "don't generate video", "还要调整配色"])("does not open a quote for %s", text => {
  expect(isFrameReviewVideoRequest(text)).toBe(false);
});
