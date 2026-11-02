import { beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const m = vi.hoisted(() => ({ resume: vi.fn(), gpt: vi.fn(), chapter: null as any }));
vi.mock("./imageGen", async original => ({ ...await original<typeof import("./imageGen")>(), resume302MidjourneyTask: m.resume, resume302GptImageTask: m.gpt }));
vi.mock("../repositories/chapters", async original => ({ ...await original<typeof import("../repositories/chapters")>(), getChapter: async (id: number, userId: number) => id === 11 && userId === 122 ? m.chapter : null }));
process.env.DATABASE_URL = "";
const { createStory, getStoryById } = await import("../repositories/stories");
const runtime = await import("../repositories/runtime");
const { getStoryGeneratedImages } = await import("../repositories/images");
const { runModuleImageTask, readModuleImageTask, recoverModuleImageTask } = await import("./bookModuleImageRecovery");
const { prepareStoryBody, mergeStaleStoryBody } = await import("./storySync");
let scope: Parameters<typeof runModuleImageTask>[0];
beforeEach(async () => {
  vi.restoreAllMocks(); m.resume.mockReset(); m.gpt.mockReset();
  runtime.resetMemoryStateForTesting();
  const story = await createStory({ userId: 122, title: "任务恢复测试", body: { shots: [], text: "原内容" } });
  scope = { storyId: story.id, userId: 122, chapterId: 11, moduleId: "text-1", expectedText: "纸船", provider: "midjourney", requestId: randomUUID() };
  m.chapter = { storyId: story.id, blocks: { body: "纸船", writingStyle: [{ id: "text-1", format: "text", lineCount: 1 }] } };
});
async function pending() {
  return runModuleImageTask(scope, async hooks => {
    await hooks.onMidjourneyTaskAccepted("mj-turbo:paid-task");
    return { status: "error", error: "仍在生成", providerTaskId: "mj-turbo:paid-task" };
  });
}
it("persists the receipt before polling and refuses a new request after reopening", async () => {
  await pending();
  expect(await readModuleImageTask(scope)).toMatchObject({ status: "accepted", providerTaskId: "mj-turbo:paid-task" });
  const generate = vi.fn();
  await runModuleImageTask({ ...scope, requestId: randomUUID() }, generate);
  expect(generate).not.toHaveBeenCalled();
  expect((await getStoryById(scope.storyId, 122))?.body).toMatchObject({ text: "原内容" });
});
it("serializes simultaneous claims so only one request can buy an image", async () => {
  const generate = vi.fn(async () => ({ status: "error", error: "未确认", submissionUncertain: true }));
  await Promise.all([runModuleImageTask(scope, generate), runModuleImageTask({ ...scope, requestId: randomUUID() }, generate)]);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(await readModuleImageTask(scope)).toMatchObject({ status: "unknown" });
});
it("does not hold the persistence lock during generation or block a different module", async () => {
  m.chapter.blocks.body = "纸船\n灯塔";
  m.chapter.blocks.writingStyle.push({ id: "text-2", format: "text", lineCount: 1 });
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const first = runModuleImageTask(scope, async hooks => {
    await hooks.onMidjourneyTaskAccepted("mj-turbo:waiting-task");
    started();
    await waiting;
    return { status: "error", providerTaskId: "mj-turbo:waiting-task" };
  });
  try {
    await entered;
    const second = vi.fn(async () => ({ status: "error", error: "明确未提交" }));
    await runModuleImageTask({ ...scope, moduleId: "text-2", expectedText: "灯塔", requestId: randomUUID() }, second);
    expect(second).toHaveBeenCalledTimes(1);
    expect(await readModuleImageTask(scope)).toMatchObject({ status: "accepted", providerTaskId: "mj-turbo:waiting-task" });
  } finally { release(); await first; }
});
it("recovers only the saved provider task and stores concurrent results exactly once", async () => {
  await pending();
  m.resume.mockResolvedValue({ status: "ok", candidates: [{ imageUrl: "/api/images/recovered.png", imageKey: "recovered.png" }] });
  const results = await Promise.all([recoverModuleImageTask(scope), recoverModuleImageTask(scope)]);
  expect(results.every(r => r.status === "ok")).toBe(true);
  expect(m.resume).toHaveBeenCalledWith("mj-turbo:paid-task", expect.any(Object));
  expect(m.gpt).not.toHaveBeenCalled();
  expect(await getStoryGeneratedImages(scope.storyId, 122)).toHaveLength(1);
  await recoverModuleImageTask(scope);
  expect(m.resume).toHaveBeenCalledTimes(2);
  expect(await getStoryGeneratedImages(scope.storyId, 122)).toHaveLength(1);
});
it("retains accepted receipts after a failed recovery, even if the provider omits the receipt", async () => {
  await pending(); m.resume.mockResolvedValue({ status: "error", message: "HTTP 503" });
  expect(await recoverModuleImageTask(scope)).toMatchObject({ status: "error", providerTaskId: "mj-turbo:paid-task" });
  expect(await readModuleImageTask(scope)).toMatchObject({ status: "accepted", providerTaskId: "mj-turbo:paid-task" });
});
it("rejects foreign owners and other modules without querying the provider", async () => {
  await pending();
  await expect(recoverModuleImageTask({ ...scope, userId: 999 })).rejects.toThrow();
  await expect(recoverModuleImageTask({ ...scope, moduleId: "another" })).rejects.toThrow();
  await expect(runModuleImageTask({ ...scope, chapterId: 99 }, vi.fn())).rejects.toThrow();
  expect(m.resume).not.toHaveBeenCalled();
});
it("rejects stale source text before any model work", async () => {
  const generate = vi.fn();
  await expect(runModuleImageTask({ ...scope, expectedText: "旧稿" }, generate)).rejects.toThrow("已变化");
  expect(generate).not.toHaveBeenCalled();
});
it("keeps late results in the warehouse after the source changed", async () => {
  await pending(); m.chapter.blocks.body = "修改后的正文";
  m.resume.mockResolvedValue({ status: "ok", imageUrl: "/api/images/late.png" });
  await recoverModuleImageTask(scope);
  expect(await readModuleImageTask(scope)).toMatchObject({ status: "succeeded", sourceChanged: true, inserted: false });
  expect(await getStoryGeneratedImages(scope.storyId, 122)).toHaveLength(1);
});
it("replays the same request after insertion; only a new confirmed request may buy again", async () => {
  await pending(); m.resume.mockResolvedValue({ status: "ok", imageUrl: "/api/images/done.png" });
  await recoverModuleImageTask(scope); m.chapter.blocks.body += "\n![图片](/api/images/done.png)";
  const generate = vi.fn(async () => ({ status: "error", error: "明确未提交" }));
  await runModuleImageTask(scope, generate); expect(generate).not.toHaveBeenCalled();
  await runModuleImageTask({ ...scope, requestId: randomUUID() }, generate); expect(generate).toHaveBeenCalledTimes(1);
});
it("never starts provider work when the initial durable claim cannot be written", async () => {
  vi.spyOn(runtime, "persistMemoryState").mockRejectedValueOnce(new Error("disk full"));
  const generate = vi.fn();
  await expect(runModuleImageTask(scope, generate)).rejects.toThrow("disk full");
  expect(generate).not.toHaveBeenCalled(); expect(await readModuleImageTask(scope)).toBeNull();
});
it("rolls back candidate insertion on a failed flush and retains the recoverable receipt", async () => {
  await pending(); m.resume.mockResolvedValue({ status: "ok", imageUrl: "/api/images/retry-store.png" });
  vi.spyOn(runtime, "persistMemoryState").mockRejectedValueOnce(new Error("disk full"));
  await expect(recoverModuleImageTask(scope)).rejects.toThrow("disk full");
  expect(await getStoryGeneratedImages(scope.storyId, 122)).toHaveLength(0);
  expect(await readModuleImageTask(scope)).toMatchObject({ status: "accepted", providerTaskId: "mj-turbo:paid-task" });
  await recoverModuleImageTask(scope); expect(await getStoryGeneratedImages(scope.storyId, 122)).toHaveLength(1);
});
it("generic story saves cannot fabricate, erase, or replace task receipts", async () => {
  await pending(); const body = (await getStoryById(scope.storyId, 122))!.body as Record<string, unknown>;
  const saved = prepareStoryBody({ ...body, bookModuleImageTasks: [] }, 10, body);
  expect(saved.bookModuleImageTasks).toEqual(body.bookModuleImageTasks);
  expect(prepareStoryBody({ bookModuleImageTasks: [{ id: "forged" }] }, 1).bookModuleImageTasks).toBeUndefined();
  expect(mergeStaleStoryBody(body, { bookModuleImageTasks: [] }, 11).bookModuleImageTasks).toEqual(body.bookModuleImageTasks);
});
