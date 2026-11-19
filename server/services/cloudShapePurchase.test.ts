import { beforeEach, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import type { FrameRegionReview, FrameRegionTask } from "../../shared/frameRegionReview";

const m = vi.hoisted(() => ({ story: vi.fn(), update: vi.fn(), images: vi.fn(), create: vi.fn(), material: vi.fn(), read: vi.fn(), store: vi.fn(), submit: vi.fn(), recover: vi.fn(), edit: vi.fn() }));
vi.mock("../repositories/stories", () => ({ getStoryById: m.story, updateStoryBodyIfRevision: m.update }));
vi.mock("../repositories/images", () => ({ getStoryGeneratedImages: m.images, createGeneratedImage: m.create }));
vi.mock("./storyMaterials", () => ({ getStoryMaterialState: m.material }));
vi.mock("./chatColorTransfer", () => ({ readStoryImageBytes: m.read }));
vi.mock("./imageGen", () => ({ storeImageBytes: m.store, editImage: m.edit }));
vi.mock("./storyboardImageTask", () => ({ runStoryboardImageTask: m.submit, recoverStoryboardImageTask: m.recover }));
import { generateCloudShape, prepareCloudShapeQuote, type CloudShapeInput } from "./cloudShapeEdit";

let review: FrameRegionReview, body: any, input: CloudShapeInput;
const bytes = new Map<string, Buffer>();
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
beforeEach(async () => {
  vi.clearAllMocks(); bytes.clear();
  const source = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#8090aa" } }).png().toBuffer();
  const region = Buffer.alloc(1600);
  for (let y = 10; y < 25; y++) for (let x = 10; x < 25; x++) region[y * 40 + x] = 255;
  const mask = await sharp(region, { raw: { width: 40, height: 40, channels: 1 } }).png().toBuffer();
  const protection = await sharp(Buffer.alloc(1600), { raw: { width: 40, height: 40, channels: 1 } }).png().toBuffer();
  bytes.set("/api/images/base.png", source); bytes.set("/api/images/region.png", mask); bytes.set("/api/images/protect.png", protection);
  const base = { id: 10, storyId: 7, userId: 1, shotIdentity: "third", imageUrl: "/api/images/base.png" } as any;
  const task: FrameRegionTask = { target: "cloud", imageId: 10, instruction: "更厚一点，白一点，饱和度要高", threshold: .35, area: "all", sourceSha: sha(source), maskSha: sha(mask), maskUrl: "/api/images/region.png", protectedUrl: "/api/images/protect.png", overlayUrl: "/api/images/region.png", selectedPixels: 225 };
  review = { id: randomUUID(), revision: 2, storyId: 7, stableShotId: "third", shotNo: 3, timelineVersion: 9, phase: "scope_review", activeTarget: "cloud", tasks: [task], instructions: [task.instruction], editorUserId: 1, createdAt: Date.now(), updatedAt: Date.now(),
    frames: [{ storyId: 7, stableShotId: "third", shotNo: 3, imageId: 10, imageUrl: base.imageUrl, takeId: 1, timelineVersion: 9, timelineFrame: 100, sourceTimeSec: 4, shotTimeSec: 4 }] };
  m.read.mockImplementation(async ({ imageUrl }) => { if (!bytes.has(imageUrl)) throw new Error("missing image"); return bytes.get(imageUrl); });
  m.store.mockImplementation(async (data, _mime, { storageKey }) => { const imageUrl = `/api/images/${storageKey.split("/").at(-1)}`; bytes.set(imageUrl, data); return { status: "ok", imageUrl }; });
  task.shapeQuote = await prepareCloudShapeQuote({ review, task, images: [base], instruction: task.instruction });
  const q = task.shapeQuote;
  body = { _revision: 1, frameRegionReviews: [structuredClone(review)], storyboardImageTasks: [], unrelated: "keep" };
  m.story.mockImplementation(async (_id, userId) => userId === 1 ? { body: structuredClone(body) } : undefined);
  m.images.mockResolvedValue([base]); m.material.mockResolvedValue({ timeline: { version: 9 } });
  m.update.mockImplementation(async ({ body: next, expectedRevision }) => { if (body._revision !== expectedRevision) return false; body = structuredClone(next); return true; });
  const changed = await sharp(source).raw().toBuffer(); changed[(15 * 40 + 15) * 3] = 200;
  bytes.set("/api/images/result.png", await sharp(changed, { raw: { width: 40, height: 40, channels: 3 } }).png().toBuffer());
  m.recover.mockResolvedValue({ status: "ok", imageId: 11, imageUrl: "/api/images/result.png", candidates: [{ imageId: 11, imageUrl: "/api/images/result.png" }] });
  input = { userId: 1, storyId: 7, reviewId: review.id, expectedRevision: review.revision, stableShotId: "third", requestId: q.requestId, confirmation: { accepted: true, fingerprint: q.fingerprint, estimatedCny: q.estimatedCny } };
});

it.each(["revision", "timeline", "cancelled", "quote", "amount", "source", "ownership", "expired", "art direction"])("rejects %s changes before purchasing", async kind => {
  if (kind === "revision") input.expectedRevision--;
  if (kind === "timeline") m.material.mockResolvedValue({ timeline: { version: 10 } });
  if (kind === "cancelled") body.frameRegionReviews[0].phase = "cancelled";
  if (kind === "quote") input.confirmation.fingerprint = "0".repeat(64);
  if (kind === "amount") input.confirmation.estimatedCny += 1;
  if (kind === "art direction") body.frameRegionReviews[0].tasks[0].shapeQuote.artDirection.textureRepetition = "reduce";
  if (kind === "source") bytes.set("/api/images/base.png", Buffer.from("changed"));
  if (kind === "ownership") input.userId = 2;
  if (kind === "expired") vi.spyOn(Date, "now").mockReturnValue(review.tasks[0].shapeQuote!.expiresAt + 1);
  try { await expect(generateCloudShape(input)).rejects.toThrow(); } finally { vi.restoreAllMocks(); }
  expect(m.submit).not.toHaveBeenCalled(); expect(m.edit).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
});

it("never purchases when asked only to retrieve a missing receipt", async () => {
  await expect(generateCloudShape({ ...input, recoverOnly: true })).rejects.toThrow("不会购买");
  expect(m.submit).not.toHaveBeenCalled(); expect(m.recover).not.toHaveBeenCalled();
});

it("blocks a stale cloud purchase after rejecting its forest base, but keeps paid receipts recoverable", async () => {
  body.frameRegionReviews.push({...structuredClone(review),id:randomUUID(),forestPaletteFeedback:[{imageId:10,decision:'rejected',at:Date.now(),instruction:'森林配色不满意'}]});
  await expect(generateCloudShape(input)).rejects.toThrow('配色已被否定');
  expect(m.submit).not.toHaveBeenCalled(); expect(m.edit).not.toHaveBeenCalled();
  body.storyboardImageTasks.push({requestId:input.requestId,shotIdentity:'third'});
  expect(await generateCloudShape({...input,recoverOnly:true})).toMatchObject({status:'ok'});
  expect(m.submit).not.toHaveBeenCalled();
});

it("recovers an existing receipt once and returns the same candidate on an old-response retry", async () => {
  body.storyboardImageTasks.push({ requestId: input.requestId, shotIdentity: "third" });
  const result = await generateCloudShape({ ...input, recoverOnly: true });
  expect(result).toMatchObject({ status: "ok", frameReview: { phase: "image_review", revision: 3 } });
  const revision = body._revision;
  expect(await generateCloudShape(input)).toMatchObject({ status: "ok", imageId: 11, frameReview: { revision: 3 } });
  expect(body._revision).toBe(revision);
  expect(body.unrelated).toBe("keep");
  expect(m.submit).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
});

it("validates a schema-round-tripped quote and passes the exact source and mask to one submission", async () => {
  m.submit.mockImplementation(async (_scope, execute) => execute((fn: any) => fn(vi.fn())));
  m.edit.mockResolvedValue({ status: "ok", imageUrl: "/api/images/result.png" });
  m.create.mockResolvedValue({ id: 11, imageUrl: "/api/images/result.png" });
  expect(await generateCloudShape(input)).toMatchObject({ status: "ok", imageId: 11 });
  expect(m.submit).toHaveBeenCalledTimes(1);
  expect(m.edit).toHaveBeenCalledWith("/api/images/base.png", expect.any(String), expect.objectContaining({
    editMaskImageUrl: review.tasks[0].shapeQuote!.maskUrl, localImagePatch: true, localImagePatchFeatherPixels: 6,
  }));
  expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ parentImageId: 10, isCurrent: false }));
});

it("protects the confirmed forest ancestry when recovering an already paid cloud result", async () => {
  const forestPixels = Buffer.alloc(1600); forestPixels[15 * 40 + 15] = 255;
  const forestMask = await sharp(forestPixels, { raw: { width: 40, height: 40, channels: 1 } }).png().toBuffer();
  bytes.set("/api/images/forest.png", forestMask);
  body.frameRegionReviews.push({ ...review, id: randomUUID(), tasks: [{ ...review.tasks[0], target: "forest", imageId: 9,
    instruction: "森林沿用上一帧绿色", shapeQuote: undefined, approvedRevision: 1,
    maskUrl: "/api/images/forest.png", maskSha: sha(forestMask),
    candidate: { imageId: 10, imageUrl: "/api/images/base.png", changedPixels: 1, outsideChangedPixels: 0 },
  }] });
  const output = await sharp(bytes.get("/api/images/result.png")!).raw().toBuffer();
  output[(20 * 40 + 20) * 3] = 200;
  bytes.set("/api/images/result.png", await sharp(output, { raw: { width: 40, height: 40, channels: 3 } }).png().toBuffer());
  body.storyboardImageTasks.push({ requestId: input.requestId, shotIdentity: "third" });
  const ownedImages = await m.images(); ownedImages[0].parentImageId = 9;
  const safeQuote = await prepareCloudShapeQuote({ review, task: review.tasks[0], images: ownedImages,
    instruction: review.tasks[0].instruction, history: body.frameRegionReviews });
  const safeMask = await sharp(bytes.get(safeQuote.maskUrl)!).ensureAlpha().raw().toBuffer();
  expect(safeMask[(15 * 40 + 15) * 4 + 3]).toBe(255);
  expect(safeMask[(20 * 40 + 20) * 4 + 3]).toBe(0);
  m.create.mockImplementation(async image => { const row = { ...image, id: 12 }; ownedImages.push(row); return row; });
  const result = await generateCloudShape({ ...input, recoverOnly: true });
  expect(result).toMatchObject({ status: "ok", imageId: 12 });
  if (result.status !== "ok") throw new Error("no candidate");
  const corrected = await sharp(bytes.get(result.imageUrl)!).ensureAlpha().raw().toBuffer();
  const original = await sharp(bytes.get("/api/images/base.png")!).ensureAlpha().raw().toBuffer();
  expect(corrected.subarray((15 * 40 + 15) * 4, (15 * 40 + 15) * 4 + 4)).toEqual(original.subarray((15 * 40 + 15) * 4, (15 * 40 + 15) * 4 + 4));
  expect(corrected[(20 * 40 + 20) * 4]).toBeGreaterThan(original[(20 * 40 + 20) * 4]);
  expect(m.submit).not.toHaveBeenCalled(); expect(m.edit).not.toHaveBeenCalled();
  const revision = body._revision;
  expect(await generateCloudShape(input)).toMatchObject({ status: "ok", imageId: 12 });
  expect(m.create).toHaveBeenCalledTimes(1); expect(body._revision).toBe(revision);
});

it("keeps the fixed forest reference protected after the active forest task moved to another frame", async () => {
  const forestPixels=Buffer.alloc(1600); forestPixels[15*40+15]=255;
  const forestMask=await sharp(forestPixels,{raw:{width:40,height:40,channels:1}}).png().toBuffer();
  bytes.set('/api/images/forest-fixed.png',forestMask);
  review.fixedForestPalette={sourceReviewId:review.id,sourceRevision:1,imageId:10,imageUrl:'/api/images/base.png',imageSha:sha(bytes.get('/api/images/base.png')!),
    maskUrl:'/api/images/forest-fixed.png',maskSha:sha(forestMask),protectedUrl:'/api/images/protect.png',protectedSha:sha(bytes.get('/api/images/protect.png')!),instruction:'softened green'};
  const quote=await prepareCloudShapeQuote({review,task:review.tasks[0],images:await m.images(),instruction:review.tasks[0].instruction,history:[review]});
  const mask=await sharp(bytes.get(quote.maskUrl)!).ensureAlpha().raw().toBuffer();
  expect(mask[(15*40+15)*4+3]).toBe(255);
  expect(mask[(20*40+20)*4+3]).toBe(0);
  expect(m.submit).not.toHaveBeenCalled();
});
