import { beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
const m = vi.hoisted(() => ({ resume: vi.fn(), resume302: vi.fn() }));
vi.mock("./legnextImage", () => ({ resumeLegnextImage: m.resume }));
vi.mock("./mj302Edit", () => ({ resume302MjEdit: m.resume302 }));
process.env.DATABASE_URL = "";
const { createStory, getStoryById } = await import("../repositories/stories");
const { resetMemoryStateForTesting } = await import("../repositories/runtime");
const { getStoryGeneratedImages, createGeneratedImage } = await import("../repositories/images");
const { runStoryboardImageTask } = await import("./storyboardImageTask");
let scope: Parameters<typeof runStoryboardImageTask>[0];
const meta = { prompt: "paper boat", shotNo: "SH01", generationType: "initial" as const };
async function fixture(width = 40, height = 40) {
  const bytes = await sharp({ create: { width, height, channels: 3, background: "#bbaacc" } }).png().toBuffer();
  return `data:image/png;base64,${bytes.toString("base64")}`;
}
async function original() {
  return createGeneratedImage({ ...scope, ...meta, imageUrl: await fixture(), isCurrent: true });
}

async function submitUnknown() {
  return runStoryboardImageTask(scope, async render => {
    await render(async () => ({ status:"error", submissionUncertain:true }), meta);
    return { status:"error", error:"unknown", submissionUncertain:true };
  });
}
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

it("only a new quote acknowledgement for this exact unknown request releases the shot, preserving its record", async () => {
  await submitUnknown();
  const next = { ...scope, requestId:randomUUID(), requireNewIntent:true, continueAfterUnknownRequestId:scope.requestId };
  const execute = vi.fn(async () => ({ status:"error" as const, error:"preparation failed" }));
  await runStoryboardImageTask(next, execute);
  expect(execute).toHaveBeenCalledTimes(1);
  const tasks = (await getStoryById(scope.storyId, scope.userId))?.body as any;
  expect(tasks.storyboardImageTasks[0]).toMatchObject({status:"unknown", continuedBy:{requestId:next.requestId,userId:scope.userId},result:{submissionUncertain:true}});
  await runStoryboardImageTask(next, execute); expect(execute).toHaveBeenCalledTimes(1);
});

it("cannot release an accepted task or an unknown task using a different receipt", async () => {
  await submitUnknown(); const execute=vi.fn();
  await runStoryboardImageTask({...scope,requestId:randomUUID(),requireNewIntent:true,continueAfterUnknownRequestId:randomUUID()},execute);
  expect(execute).not.toHaveBeenCalled();
});

it("preserves completed output URLs for recovery without inventing a task ID", async () => {
  await runStoryboardImageTask(scope, async render => {
    const result = await render(async (_accepted, ready) => {
      await ready("https://file.302.ai/completed.png");
      return {status:"error",providerResultUrl:"https://file.302.ai/completed.png",errorCode:"timeout_pending"};
    }, {...meta,provider:"flux-kontext-dev"});
    return {status:"error",error:result.message ?? "pending",providerResultUrl:result.providerResultUrl};
  });
  const {pendingStoryboardImageTasks}=await import("./storyboardImageTask");
  expect(await pendingStoryboardImageTasks(scope.storyId,scope.userId)).toEqual([expect.objectContaining({requestId:scope.requestId,recoverable:true})]);
  const body=(await getStoryById(scope.storyId,scope.userId))?.body as any;
  expect(body.storyboardImageTasks[0]).toMatchObject({status:"accepted",providerResultUrl:"https://file.302.ai/completed.png"});
  expect(body.storyboardImageTasks[0].providerTaskId).toBeUndefined();
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

it("persists Retexture mode and original lineage across refresh without another purchase", async () => {
  const source = await original();
  await runStoryboardImageTask(scope, async render => {
    await render(async accepted => { await accepted("legnext:edit"); return { status:"error", providerTaskId:"legnext:edit" }; },
      {...meta,editMode:"retexture",conversationRevision:true,parentImageId:source.id,instruction:"only refine color"});
    return {status:"error",error:"pending",providerTaskId:"legnext:edit"};
  });
  m.resume.mockResolvedValue({status:"ok",imageUrl:source.imageUrl,imageKey:"edited",candidates:[{imageUrl:source.imageUrl,imageKey:"edited"}]});
  const execute = vi.fn();
  const result = await runStoryboardImageTask(scope,execute);
  expect(result.status).toBe("ok");expect(m.resume).toHaveBeenCalledWith("legnext:edit","retexture");expect(execute).not.toHaveBeenCalled();
  expect(await getStoryGeneratedImages(scope.storyId,scope.userId)).toEqual(expect.arrayContaining([expect.objectContaining({parentImageId:source.id,isCurrent:false,shotIdentity:"shot-a"})]));
  expect(result).toMatchObject({candidates:[{dimensionCheck:{status:"matched",expected:{width:40,height:40}}}]});
  await runStoryboardImageTask(scope,execute);expect(m.resume).toHaveBeenCalledTimes(1);
});
it("recovers a 302 edit on its persisted supplier, preserves the original and never repurchases", async () => {
  const source = await original();
  await runStoryboardImageTask(scope, async render => {
    const r = await render(async accepted => { await accepted("123456"); return {status:"error",providerTaskId:"123456",errorCode:"timeout_pending"}; },
      {...meta,provider:"302-mj-edit",editMode:"retexture",conversationRevision:true,parentImageId:source.id});
    return {status:"error",error:"pending",providerTaskId:r.providerTaskId};
  });
  m.resume302.mockResolvedValue({status:"ok",candidates:[{imageUrl:source.imageUrl,imageKey:"302-edit"}]});
  const execute=vi.fn();
  expect(await runStoryboardImageTask(scope,execute)).toMatchObject({status:"ok"});
  expect(m.resume).not.toHaveBeenCalled(); expect(m.resume302).toHaveBeenCalledWith("123456");
  expect(execute).not.toHaveBeenCalled();
  expect(await getStoryGeneratedImages(scope.storyId,scope.userId)).toEqual(expect.arrayContaining([expect.objectContaining({parentImageId:source.id,isCurrent:false,shotIdentity:"shot-a"})]));
  await runStoryboardImageTask(scope,execute); expect(m.resume302).toHaveBeenCalledTimes(1);
});

it("locks source pixels before purchase and preserves a wrong-aspect recovered candidate without repurchasing", async () => {
  const source = await original();
  await runStoryboardImageTask(scope, async render => {
    await render(async accepted => {
      expect((await getStoryById(scope.storyId, scope.userId))?.body).toMatchObject({
        storyboardImageTasks: [expect.objectContaining({meta:expect.objectContaining({sourceDimensions:{width:40,height:40}})})],
      });
      await accepted("legnext:dimensions");
      return {status:"error",providerTaskId:"legnext:dimensions"};
    }, {...meta,conversationRevision:true,parentImageId:source.id});
    return {status:"error",error:"pending",providerTaskId:"legnext:dimensions"};
  });
  const output = await fixture(40, 60);
  m.resume.mockResolvedValue({status:"ok",imageUrl:output,imageKey:"wrong-aspect"});
  const execute = vi.fn();
  expect(await runStoryboardImageTask(scope,execute)).toMatchObject({status:"ok",candidates:[{
    imageUrl:output,dimensionCheck:{status:"mismatch",expected:{width:40,height:40},output:{width:40,height:60}},
  }]});
  expect(execute).not.toHaveBeenCalled();
  expect(await getStoryGeneratedImages(scope.storyId,scope.userId)).toHaveLength(2);
  await runStoryboardImageTask(scope,execute);
  expect(m.resume).toHaveBeenCalledTimes(1);
});

it("does not purchase if the source cannot be read for a dimension lock", async () => {
  const submit = vi.fn();
  await runStoryboardImageTask(scope, async render => {
    await render(submit, {...meta,conversationRevision:true,parentImageId:999});
    return {status:"error",error:"unreachable"};
  });
  expect(submit).not.toHaveBeenCalled();
});
it("records dimension checks on immediate results as well as recovered tasks", async () => {
  const source = await original();
  const output = await fixture(40, 60);
  const result = await runStoryboardImageTask(scope, async render => {
    const rendered = await render(async () => ({status:"ok",imageUrl:output}), {...meta,conversationRevision:true,parentImageId:source.id});
    const saved = await createGeneratedImage({...scope,...meta,parentImageId:source.id,imageUrl:rendered.imageUrl!,isCurrent:false});
    return {status:"ok",imageId:saved.id,imageUrl:saved.imageUrl,candidates:[{imageId:saved.id,imageUrl:saved.imageUrl}]};
  });
  expect(result).toMatchObject({candidates:[{dimensionCheck:{status:"mismatch"}}]});
  expect(await runStoryboardImageTask(scope,vi.fn())).toEqual(result);
});

it("recovers a durable local palette result after interruption without calling any image provider",async()=>{
  const base=await original(),imageUrl=await fixture();
  await runStoryboardImageTask(scope,async render=>{
    await render(async(_accepted,ready)=>{await ready(imageUrl);throw new Error("interrupted after storage");},
      {...meta,provider:"local-palette",parentImageId:base.id,conversationRevision:true,localPalette:{outsideChangedPixels:0}});
    throw new Error("unreachable");
  });
  const result=await runStoryboardImageTask(scope,vi.fn());
  expect(result).toMatchObject({status:"ok",candidates:[{dimensionCheck:{status:"matched"}}]});
  expect(m.resume).not.toHaveBeenCalled();
  expect(await getStoryGeneratedImages(scope.storyId,scope.userId)).toHaveLength(2);
  expect(await runStoryboardImageTask(scope,vi.fn())).toEqual(result);
});

async function injectTask(task: Record<string, unknown>) {
  const { updateStoryBodyIfRevision } = await import("../repositories/stories");
  const story = await getStoryById(scope.storyId, scope.userId);
  const body = (story?.body ?? {}) as Record<string, unknown>;
  const revision = Number(body._revision ?? 0);
  const ok = await updateStoryBodyIfRevision({ id: scope.storyId, userId: scope.userId, expectedRevision: revision, body: { ...body, storyboardImageTasks: [task], _revision: revision + 1 } });
  expect(ok).toBeTruthy();
}

it("releases a preparing lock whose holder died (lease expired) and lets a new request render", async () => {
  await injectTask({ id: "dead", requestId: "old-request", shotIdentity: scope.shotIdentity, status: "preparing", createdAt: Date.now() - 10 * 60_000, leaseOwner: "dead", leaseUntil: Date.now() - 60_000 });
  const execute = vi.fn(async () => ({ status: "error" as const, error: "no purchase" }));
  await runStoryboardImageTask(scope, execute);
  expect(execute).toHaveBeenCalledTimes(1);
  const tasks = ((await getStoryById(scope.storyId, scope.userId))?.body as { storyboardImageTasks: Array<{ id: string; status: string; result?: { staleReleased?: boolean } }> }).storyboardImageTasks;
  expect(tasks.find(t => t.id === "dead")).toMatchObject({ status: "failed", result: { staleReleased: true } });
});

it("keeps a live preparing lock and tells the user when it frees up", async () => {
  await injectTask({ id: "live", requestId: "old-request", shotIdentity: scope.shotIdentity, status: "preparing", createdAt: Date.now(), leaseOwner: "live", leaseUntil: Date.now() + 120_000 });
  const execute = vi.fn();
  const result = await runStoryboardImageTask(scope, execute);
  expect(execute).not.toHaveBeenCalled();
  expect(result).toMatchObject({ status: "error", error: expect.stringContaining("自动释放") });
});

it("keeps an unknown paid submission protected after 30 minutes", async () => {
  await injectTask({ id: "maybe-paid", requestId: "old-request", shotIdentity: scope.shotIdentity, status: "unknown", createdAt: Date.now() - 10 * 60_000 });
  const execute = vi.fn(async () => ({ status: "error" as const, error: "no purchase" }));
  expect(await runStoryboardImageTask(scope, execute)).toMatchObject({ submissionUncertain: true });
  expect(execute).not.toHaveBeenCalled();
  await injectTask({ id: "maybe-paid", requestId: "old-request", shotIdentity: scope.shotIdentity, status: "unknown", createdAt: Date.now() - 31 * 60_000 });
  expect(await runStoryboardImageTask({ ...scope, requestId: randomUUID() }, execute)).toMatchObject({ submissionUncertain: true });
  expect(execute).not.toHaveBeenCalled();
});

it("never submits from a lock that expired and was handed to a newer request", async () => {
  let openGate!: () => void;
  const gate = new Promise<void>(resolve => { openGate = resolve; });
  const lateSubmit = vi.fn(async () => ({ status: "ok" as const }));
  const first = runStoryboardImageTask(scope, async render => {
    await gate; // prompt preparation takes longer than the lease
    await render(lateSubmit as never, meta);
    return { status: "error" as const, error: "unreachable" };
  });
  // Let the first request persist its preparing task, then expire its lease.
  await vi.waitFor(async () => {
    const tasks = ((await getStoryById(scope.storyId, scope.userId))?.body as { storyboardImageTasks?: unknown[] }).storyboardImageTasks;
    expect(tasks?.length).toBe(1);
  });
  const story = await getStoryById(scope.storyId, scope.userId);
  const task = ((story?.body as { storyboardImageTasks: Record<string, unknown>[] }).storyboardImageTasks)[0]!;
  await injectTask({ ...task, leaseUntil: Date.now() - 1 });
  const second = vi.fn(async () => ({ status: "error" as const, error: "second ran" }));
  await runStoryboardImageTask({ ...scope, requestId: randomUUID() }, second);
  expect(second).toHaveBeenCalledTimes(1);
  openGate();
  expect(await first).toMatchObject({ status: "error", error: expect.stringContaining("没有提交图片任务") });
  expect(lateSubmit).not.toHaveBeenCalled();
});

it("stores the provider's original error with the task record", async () => {
  const providerError = { provider: "legnext", httpStatus: 400, code: "Invalid_Prompt_Parameter" };
  await submitPending();
  m.resume.mockResolvedValue({ status: "error", providerTaskId: "legnext:existing", message: "供应商确认本次图片生成失败（HTTP 400 · Invalid_Prompt_Parameter）", providerError });
  expect(await runStoryboardImageTask(scope, vi.fn())).toMatchObject({ status: "error", providerError });
  expect((await getStoryById(scope.storyId, scope.userId))?.body).toMatchObject({ storyboardImageTasks: [expect.objectContaining({ status: "failed", result: expect.objectContaining({ providerError }) })] });
});


it.each([
  { analysisStartedAt: Date.now() - 3_600_000 },
  { meta: { paletteAnalysis: { status: "pending" } } },
])("keeps paid-analysis preparation protected after the lease expires: %j", async marker => {
  await injectTask({ id: "analysis-pending", requestId: "old-analysis", shotIdentity: scope.shotIdentity,
    status: "preparing", createdAt: Date.now() - 3_600_000, leaseUntil: Date.now() - 60_000, ...marker });
  const execute = vi.fn();
  const result = await runStoryboardImageTask(scope, execute);
  expect(result.status).toBe("error");
  expect(execute).not.toHaveBeenCalled();
});
