import { beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const m = vi.hoisted(() => ({ resume: vi.fn() }));
vi.mock("./legnextImage", () => ({ resumeLegnextImage: m.resume }));
process.env.DATABASE_URL = "";
const { createStory, getStoryById } = await import("../repositories/stories");
const { resetMemoryStateForTesting } = await import("../repositories/runtime");
const { getStoryGeneratedImages } = await import("../repositories/images");
const { runStoryboardImageTask } = await import("./storyboardImageTask");
let scope: Parameters<typeof runStoryboardImageTask>[0];
const meta = { prompt: "paper boat", shotNo: "SH01", generationType: "initial" as const };
beforeEach(async () => {
  resetMemoryStateForTesting(); m.resume.mockReset();
  const story = await createStory({ userId: 123, title: "分镜恢复", body: { text: "原文", shots: [{ shotNo: 1, stableShotId: "shot-a" }] } });
  scope = { userId: 123, storyId: story.id, shotIdentity: "shot-a", requestId: randomUUID() };
});
async function submitPending() {
  return runStoryboardImageTask(scope, async render => {
    const result = await render(async accepted => {
      await accepted("legnext:existing");
      return { status: "error", providerTaskId: "legnext:existing", message: "pending" };
    }, meta);
    return { status: "error" as const, providerTaskId: result.providerTaskId, error: result.message ?? "pending" };
  });
}
it("resumes without another generation or paid prompt preparation", async () => {
  await submitPending();
  const execute = vi.fn();
  m.resume.mockResolvedValue({ status: "error", providerTaskId: "legnext:existing", message: "pending" });
  await runStoryboardImageTask({ ...scope, requestId: randomUUID() }, execute);
  expect(execute).not.toHaveBeenCalled(); expect(m.resume).toHaveBeenCalledWith("legnext:existing");
});
it.each(["timeout_pending", undefined])("exposes pending only for retryable supplier state: %s", async errorCode => {
  await submitPending();
  const execute = vi.fn();
  m.resume.mockResolvedValue({ status: "error", providerTaskId: "legnext:existing", errorCode, message: "supplier response" });
  expect(await runStoryboardImageTask(scope, execute)).toMatchObject({ status: "error", recoveryPending: errorCode === "timeout_pending" });
  expect(execute).not.toHaveBeenCalled();
});
it("recovers four candidates with shot identity, without selecting or erasing old assets", async () => {
  await submitPending();
  m.resume.mockResolvedValue({ status: "ok", candidates: [1,2,3,4].map(n => ({ imageUrl: `/api/images/${n}.png`, imageKey: `generated/${n}.png` })) });
  expect(await runStoryboardImageTask(scope, vi.fn())).toMatchObject({ status: "ok", candidates: expect.any(Array) });
  const images = await getStoryGeneratedImages(scope.storyId, scope.userId);
  expect(images).toHaveLength(4); expect(images.every(i=>i.shotIdentity==='shot-a' && !i.isCurrent)).toBe(true);
  await runStoryboardImageTask(scope, vi.fn()); expect(m.resume).toHaveBeenCalledTimes(1);
  expect((await getStoryById(scope.storyId,scope.userId))?.body).toMatchObject({text:"原文"});
});
it("an ambiguous submission does not allow a fresh request to purchase again", async () => {
  await runStoryboardImageTask(scope, async render => {
    await render(async () => ({ status: "error", submissionUncertain: true }), meta);
    return { status: "error", error: "unknown", submissionUncertain: true };
  });
  const execute = vi.fn();
  expect(await runStoryboardImageTask({...scope,requestId:randomUUID()},execute)).toMatchObject({ submissionUncertain: true });
  expect(execute).not.toHaveBeenCalled();
});
it("serializes concurrent first claims and rejects another owner", async () => {
  const execute = vi.fn(async () => ({ status: "error" as const, error: "unknown", submissionUncertain: true }));
  await Promise.all([runStoryboardImageTask(scope,execute),runStoryboardImageTask({...scope,requestId:randomUUID()},execute)]);
  expect(execute).toHaveBeenCalledTimes(1);
  await expect(runStoryboardImageTask({...scope,userId:999},execute)).rejects.toThrow();
});
it("serializes concurrent recovery so candidates are not inserted twice", async () => {
  await submitPending();
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  m.resume.mockImplementation(async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); return { status: "ok", candidates: [1,2,3,4].map(n => ({ imageUrl: `/api/images/${n}.png`, imageKey: `key-${n}` })) }; });
  const first = runStoryboardImageTask(scope, vi.fn());
  await started;
  try {
    expect(await runStoryboardImageTask({...scope,requestId:randomUUID()},vi.fn())).toMatchObject({ status: "error" });
    expect(m.resume).toHaveBeenCalledTimes(1);
  } finally { release(); }
  await first;
  expect(await getStoryGeneratedImages(scope.storyId,scope.userId)).toHaveLength(4);
});
it("recovery never submits when receipt is absent, and accepts an existing receipt", async () => {
  const { recoverStoryboardImageTask } = await import("./storyboardImageTask");
  expect(await recoverStoryboardImageTask(scope.storyId, scope.userId, "missing")).toMatchObject({ status: "error" });
  expect(m.resume).not.toHaveBeenCalled();
  await submitPending();
  m.resume.mockResolvedValue({ status: "error", providerTaskId: "legnext:existing", message: "pending" });
  await recoverStoryboardImageTask(scope.storyId, scope.userId, "legnext:existing");
  expect(m.resume).toHaveBeenCalledTimes(1);
  await expect(recoverStoryboardImageTask(scope.storyId, 999, "legnext:existing")).rejects.toThrow();
});
it("detaching preserves the warehouse image and rejects another owner", async () => {
  const { createGeneratedImage, detachGeneratedImageFromShot, getGeneratedImageById } = await import("../repositories/images");
  const image = await createGeneratedImage({ storyId: scope.storyId, userId: scope.userId, ...meta, shotIdentity: scope.shotIdentity, imageUrl: "/keep.png", imageKey: "keep.png", isCurrent: true });
  await expect(detachGeneratedImageFromShot(image.id, scope.storyId, 999)).rejects.toThrow();
  expect((await getGeneratedImageById(image.id))?.shotIdentity).toBe(scope.shotIdentity);
  await detachGeneratedImageFromShot(image.id, scope.storyId, scope.userId);
  expect(await getGeneratedImageById(image.id)).toMatchObject({ imageUrl: "/keep.png", imageKey: "keep.png", shotNo: null, shotIdentity: null, isCurrent: false });
  expect(await getStoryGeneratedImages(scope.storyId, scope.userId)).toHaveLength(1);
});
it("keeps recovered preview candidates unassigned and separate from the formal shot task", async () => {
  const previewScope = { ...scope, shotIdentity: `preview:batch:${scope.shotIdentity}` };
  await runStoryboardImageTask(previewScope, async render => {
    await render(async accepted => { await accepted("legnext:preview"); return { status: "error", providerTaskId: "legnext:preview" }; }, { ...meta, detached: true });
    return { status: "error", error: "pending", providerTaskId: "legnext:preview" };
  });
  m.resume.mockResolvedValue({ status: "ok", candidates: [1,2,3,4].map(n => ({ imageUrl: `/preview-${n}.png`, imageKey: `preview-${n}` })) });
  const execute = vi.fn();
  await runStoryboardImageTask(previewScope, execute);
  expect(execute).not.toHaveBeenCalled();
  const images = await getStoryGeneratedImages(scope.storyId, scope.userId);
  expect(images).toHaveLength(4); expect(images.every(i => i.shotNo === null && i.shotIdentity === null && !i.isCurrent)).toBe(true);
  const formal = vi.fn(async () => ({ status: "error" as const, error: "no purchase" }));
  await runStoryboardImageTask({ ...scope, requestId: randomUUID() }, formal);
  expect(formal).toHaveBeenCalledTimes(1);
});
it("records a provider-confirmed failure so reopening the gallery stops polling it", async () => {
  await submitPending();
  m.resume.mockResolvedValue({ status: "error", providerTaskId: "legnext:existing", message: "provider failed" });
  expect(await runStoryboardImageTask(scope, vi.fn())).toMatchObject({ status: "error", recoveryPending: false });
  await runStoryboardImageTask(scope, vi.fn());
  expect(m.resume).toHaveBeenCalledTimes(1);
  expect((await getStoryById(scope.storyId, scope.userId))?.body).toMatchObject({ storyboardImageTasks: [expect.objectContaining({ status: "failed" })] });
});

it("does not present an older pending job as acceptance of a new chat instruction", async () => {
  await submitPending();
  const execute = vi.fn();
  const result = await runStoryboardImageTask({ ...scope, requestId: randomUUID(), requireNewIntent: true }, execute);
  expect(result).toMatchObject({ status: "error", error: expect.stringContaining("新要求尚未提交") });
  expect(result).not.toHaveProperty("providerTaskId"); expect(execute).not.toHaveBeenCalled(); expect(m.resume).not.toHaveBeenCalled();
});
