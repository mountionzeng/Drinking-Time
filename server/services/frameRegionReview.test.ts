import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { runFrameRegionReview } from "./frameRegionReview";

const input = { storyId: 7, userId: 1, instruction: "第03镜抽5帧" };
let body: any, images: any[], imageBytes: Buffer, d: any;
beforeEach(async () => {
  body = { _revision: 1, otherSession: { keep: true } };
  imageBytes = await sharp({ create: { width: 12, height: 10, channels: 3, background: "#80bba1" } }).png().toBuffer();
  images = [1, 2, 3, 4, 5].map(id => ({ id, userId: 1, storyId: 7, shotIdentity: "third", imageUrl: `/api/images/${id}.png` }));
  const frames = images.map((image, i) => ({ storyId: 7, stableShotId: "third", shotNo: 3, imageId: image.id, imageUrl: image.imageUrl,
    takeId: 10, timelineVersion: 9, timelineFrame: i * 60, sourceTimeSec: i * 2, shotTimeSec: i * 2 }));
  d = {
    story: vi.fn(async () => ({ body: structuredClone(body) })), material: vi.fn(async () => ({ timeline: { version: 9 } })),
    images: vi.fn(async () => images), read: vi.fn(async () => imageBytes),
    update: vi.fn(async ({ expectedRevision, body: next }) => { if (body._revision !== expectedRevision) return false; body = structuredClone(next); return true; }),
    extract: vi.fn(async () => ({ frames, requestedCount: 5, failures: [] })),
    inspect: vi.fn(async (_frames, tasks) => tasks.map((task: any) => ({ target: task.target, imageId: task.imageId ?? (task.allowedImageIds?.includes(3) ? 3 : task.allowedImageIds?.[0] ?? 3), selectedPixels: 40, mask: imageBytes, protection: imageBytes, overlay: imageBytes }))),
    recolor: vi.fn(async () => ({ bytes: imageBytes, changedPixels: 30, outsideChangedPixels: 0 })),
    store: vi.fn(async (_bytes, _mime, options) => ({ status: "ok", imageKey: options.storageKey, imageUrl: `/api/images/${options.storageKey.split("/").at(-1)}` })),
    createImage: vi.fn(async image => { const row = { ...image, id: images.length + 1 }; images.push(row); return row; }),
  };
});
const next = (review: any, instruction: string) => ({ ...input, instruction, reviewId: review.id, expectedRevision: review.revision });
describe("persistent region approval", () => {
  it("extracts, localizes and refines without producing edits; old approval is rejected", async () => {
    const first = (await runFrameRegionReview(input, d)).frameReview;
    const second = (await runFrameRegionReview(next(first, "森林改绿色，云层大一点，飞机只要一个"), d)).frameReview;
    expect(second.tasks.map(t => t.target)).toEqual(["forest", "plane", "cloud"]);
    expect(d.recolor).not.toHaveBeenCalled(); expect(d.createImage).not.toHaveBeenCalled();
    const refined = (await runFrameRegionReview(next(second, "森林范围扩大一点，只选左边"), d)).frameReview;
    expect(refined.tasks.find(t => t.target === "forest")).toMatchObject({ threshold: .29, area: "left" });
    await expect(runFrameRegionReview(next(second, "确认范围"), d)).rejects.toThrow("已变化");
    expect(d.recolor).not.toHaveBeenCalled(); expect(body.otherSession).toEqual({ keep: true });
  });
  it("edits only after exact scope confirmation; retains original and guards missing geometry", async () => {
    const first = (await runFrameRegionReview(input, d)).frameReview;
    const located = (await runFrameRegionReview(next(first, "森林改绿色，飞机只要一个，云层大一点"), d)).frameReview;
    const edited = (await runFrameRegionReview(next(located, "确认范围"), d)).frameReview;
    expect(d.recolor).toHaveBeenCalledTimes(1);
    expect(d.createImage).toHaveBeenCalledWith(expect.objectContaining({ parentImageId: 3, isCurrent: false }));
    expect(edited.phase).toBe("image_review");
    const confirmation = await runFrameRegionReview(next(edited, "确认图片"), d);
    expect(confirmation.frameReview.phase).toBe("image_review"); expect(confirmation.reply).toContain("还没有全部");
    await expect(runFrameRegionReview(next(located, "确认范围"), d)).rejects.toThrow();
    expect(d.recolor).toHaveBeenCalledTimes(1);
  });
  it("blocks changed source, unresolved masks and timeline changes", async () => {
    const first = (await runFrameRegionReview(input, d)).frameReview;
    const located = (await runFrameRegionReview(next(first, "森林改绿色"), d)).frameReview;
    d.read.mockResolvedValue(Buffer.from("changed"));
    const result = await runFrameRegionReview(next(located, "确认范围"), d);
    expect(result.reply).toContain("未完成"); expect(d.recolor).not.toHaveBeenCalled();
    d.material.mockResolvedValue({ timeline: { version: 10 } });
    await expect(runFrameRegionReview(next(result.frameReview, "森林范围扩大"), d)).rejects.toThrow();
  });
  it("checks ownership before extraction or recognition", async () => {
    d.story.mockResolvedValue(null);
    await expect(runFrameRegionReview(input, d)).rejects.toThrow("故事不存在");
    expect(d.extract).not.toHaveBeenCalled(); expect(d.inspect).not.toHaveBeenCalled();
  });
  it("retains a partial extraction in Warehouse but does not offer it as a complete review", async () => {
    d.extract.mockResolvedValue({ frames: [], requestedCount: 5, failures: ["decoder failed"] });
    await expect(runFrameRegionReview(input, d)).rejects.toThrow("未全部完成"); expect(d.update).not.toHaveBeenCalled();
  });
});

it("allows explicit forest-only approval without approving unresolved airplane geometry", async () => {
  const first = (await runFrameRegionReview(input, d)).frameReview;
  d.inspect.mockImplementation(async (_frames: unknown, tasks: Array<{ target: string }>) => tasks.map((task: any) => ({ target: task.target, imageId: 3, selectedPixels: task.target === "plane" ? 0 : 40, mask: imageBytes, protection: imageBytes, overlay: imageBytes })));
  const located = (await runFrameRegionReview(next(first, "森林改绿色；飞机只要一个"), d)).frameReview;
  const edited = (await runFrameRegionReview(next(located, "确认森林范围"), d)).frameReview;
  expect(edited.tasks.find(t => t.target === "forest")?.candidate).toBeDefined();
  expect(edited.tasks.find(t => t.target === "plane")?.approvedRevision).toBeUndefined();
  expect(edited.approvedRevision).toBeUndefined();
  await runFrameRegionReview(next(edited, "确认森林范围"), d);
  expect(d.recolor).toHaveBeenCalledTimes(1);
});

it("keeps the approved forest region and candidate when only cloud scope changes", async () => {
  const first = (await runFrameRegionReview(input, d)).frameReview;
  const located = (await runFrameRegionReview(next(first, "森林改绿色；最后几帧云层更大更厚"), d)).frameReview;
  const edited = (await runFrameRegionReview(next(located, "确认森林范围"), d)).frameReview;
  const forest = structuredClone(edited.tasks.find(t => t.target === "forest"));
  const refined = (await runFrameRegionReview(next(edited, "重新识别云层范围，树木保持不变"), d)).frameReview;
  expect(refined.tasks.find(t => t.target === "forest")).toEqual(forest);
  expect(refined.tasks.find(t => t.target === "cloud")?.candidate).toBeUndefined();
  expect(d.recolor).toHaveBeenCalledTimes(1);
  expect(d.inspect.mock.lastCall[1]).toEqual([expect.objectContaining({ target: "cloud" })]);
});


it("uses the clicked warehouse image as the exact base and retains other object reviews", async () => {
  const first = (await runFrameRegionReview(input, d)).frameReview;
  const located = (await runFrameRegionReview(next(first, "森林改绿色；云层更厚"), d)).frameReview;
  const cloud = structuredClone(located.tasks.find(t => t.target === "cloud"));
  images.push({ id: 99, userId: 1, storyId: 7, shotIdentity: "third", imageUrl: "/api/images/chosen.png" });
  const selected = (await runFrameRegionReview({ ...next(located, "只把树木改成绿色，其他颜色保持不变"), imageId: 99 }, d)).frameReview;
  expect(d.inspect.mock.lastCall[1]).toEqual([expect.objectContaining({ target: "forest", imageId: 99 })]);
  expect(selected.tasks.find(t => t.target === "forest")?.imageId).toBe(99);
  expect(selected.tasks.find(t => t.target === "cloud")).toEqual(cloud);
  expect(selected.frames).toEqual(located.frames);
  expect((selected as any).sourceImages).toEqual([expect.objectContaining({ imageId: 99, imageUrl: "/api/images/chosen.png" })]);
  const refined = (await runFrameRegionReview(next(selected, "森林范围扩大一点"), d)).frameReview;
  expect(refined.tasks.find(t => t.target === "forest")?.imageId).toBe(99);
  await runFrameRegionReview(next(refined, "确认森林范围"), d);
  expect(d.createImage).toHaveBeenCalledWith(expect.objectContaining({ parentImageId: 99, isCurrent: false }));
});

it.each(["missing", "other-story", "other-shot", "other-owner"])("rejects a %s selected image without falling back to a video frame", async kind => {
  const first = (await runFrameRegionReview(input, d)).frameReview;
  if (kind !== "missing") images.push({ id: 99, userId: kind === "other-owner" ? 2 : 1, storyId: kind === "other-story" ? 8 : 7,
    shotIdentity: kind === "other-shot" ? "another" : "third", imageUrl: "/api/images/other.png" });
  d.inspect.mockClear(); d.update.mockClear();
  await expect(runFrameRegionReview({ ...next(first, "只改树木绿色"), imageId: 99 }, d)).rejects.toThrow();
  expect(d.inspect).not.toHaveBeenCalled(); expect(d.update).not.toHaveBeenCalled();
});


it("persists separate object sampling masks and refuses a changed object mask", async () => {
  const first = (await runFrameRegionReview(input, d)).frameReview;
  const objects = Buffer.from("object-sampling-mask");
  d.inspect.mockImplementation(async (_frames: unknown, tasks: any[]) => tasks.map(task => ({ target: task.target, imageId: 3, selectedPixels: 40,
    mask: imageBytes, protection: imageBytes, overlay: imageBytes, objects })));
  const located = (await runFrameRegionReview(next(first, "树木改成绿色"), d)).frameReview;
  expect(located.tasks[0].objectMaskUrl).toContain("forest-objects");
  expect(d.inspect.mock.lastCall[1][0].greenEdit).toBe(true);
  d.read.mockImplementation(async (image: any) => image.imageUrl.includes("forest-objects") ? objects : imageBytes);
  await runFrameRegionReview(next(located, "确认森林范围"), d);
  expect(d.recolor).toHaveBeenCalledWith(imageBytes, imageBytes, imageBytes, objects);
  const refined = (await runFrameRegionReview(next(body.frameRegionReviews[0], "森林范围扩大一点"), d)).frameReview;
  expect(d.inspect.mock.lastCall[1][0].greenEdit).toBe(true);
  d.read.mockImplementation(async (image: any) => image.imageUrl.includes("forest-objects") ? Buffer.from("changed") : imageBytes);
  d.recolor.mockClear();
  const result = await runFrameRegionReview(next(refined, "确认森林范围"), d);
  expect(result.reply).toContain("未完成");
  expect(d.recolor).not.toHaveBeenCalled();
});
