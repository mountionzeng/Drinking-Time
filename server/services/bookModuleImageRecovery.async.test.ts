import { beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const m = vi.hoisted(() => ({ resume: vi.fn(), gpt: vi.fn(), chapter: null as any }));
vi.mock("./imageGen", async original => ({ ...await original<typeof import("./imageGen")>(), resume302MidjourneyTask: m.resume, resume302GptImageTask: m.gpt }));
vi.mock("../repositories/chapters", async original => ({ ...await original<typeof import("../repositories/chapters")>(), getChapter: async (id: number, userId: number) => id === 11 && userId === 122 ? m.chapter : null }));
process.env.DATABASE_URL = "";
process.env.IMAGE_TASK_WORKER_ENABLED = "1";
process.env.IMAGE_TASK_ASYNC_SUBMIT = "1";
const { createStory, getStoryById } = await import("../repositories/stories");
const runtime = await import("../repositories/runtime");
const { getStoryGeneratedImages } = await import("../repositories/images");
const { runModuleImageTask, readModuleImageTask, recoverModuleImageTask } = await import("./bookModuleImageRecovery");
const { getImageTaskStore, resetImageTaskMemoryStoreForTesting } = await import("../repositories/imageGenerationTasks");
let scope: Parameters<typeof runModuleImageTask>[0];
beforeEach(async () => {
  vi.restoreAllMocks(); m.resume.mockReset(); m.gpt.mockReset();
  runtime.resetMemoryStateForTesting(); resetImageTaskMemoryStoreForTesting();
  const story = await createStory({ userId: 122, title: "异步任务", body: { shots: [], text: "原内容" } });
  scope = { storyId: story.id, userId: 122, chapterId: 11, moduleId: "text-1", expectedText: "纸船", provider: "midjourney", requestId: randomUUID() };
  m.chapter = { storyId: story.id, blocks: { body: "纸船", writingStyle: [{ id: "text-1", format: "text", lineCount: 1 }] } };
});
const meta = { prompt: "纸船", promptCompilationId: null, promptBillings: [{ operationId: "inf-1", chargeMinor: 3 }] };
it("switch on: submit returns pending + task id at once, registers in the table, not in the story body", async () => {
  const result: any = await runModuleImageTask(scope, async hooks => {
    expect(hooks.asyncSubmit).toBe(true);
    await hooks.onPrepared!(meta);
    await hooks.onMidjourneyTaskAccepted("mj-turbo:t1");
    return { status: "error", error: "x", providerTaskId: "mj-turbo:t1" };
  });
  expect(result).toMatchObject({ pending: true, providerTaskId: "mj-turbo:t1" });
  const row = await (await getImageTaskStore()).get(result.imageTaskId);
  expect(row).toMatchObject({ status: "accepted", prompt: "纸船" });
  expect((await getStoryById(scope.storyId, 122))?.body).toEqual({ shots: [], text: "原内容" });
  const again = vi.fn();
  await runModuleImageTask({ ...scope, requestId: randomUUID() }, again);
  expect(again).not.toHaveBeenCalled(); // receipt exists → never resubmit
});
it("switch on: recovery fetches once, stores into the warehouse, second recovery does not duplicate", async () => {
  await runModuleImageTask(scope, async hooks => { await hooks.onPrepared!(meta); await hooks.onMidjourneyTaskAccepted("mj-turbo:t2"); return { status: "error", providerTaskId: "mj-turbo:t2" }; });
  m.resume.mockResolvedValue({ status: "ok", imageUrl: "/api/images/a.png", candidates: [{ imageUrl: "/api/images/a.png" }, { imageUrl: "/api/images/b.png" }] });
  expect(await recoverModuleImageTask(scope)).toMatchObject({ status: "ok" });
  await recoverModuleImageTask(scope);
  expect(await getStoryGeneratedImages(scope.storyId, 122)).toHaveLength(2);
  expect(m.resume).toHaveBeenCalledTimes(1);
});
it("switch on: definite failure before any receipt marks failed and allows a fresh request", async () => {
  await runModuleImageTask(scope, async hooks => { await hooks.onPrepared!(meta); hooks.onDefiniteFailure!(); return { status: "error", error: "拒绝" }; });
  expect(await readModuleImageTask(scope)).toMatchObject({ status: "failed" });
  const next = vi.fn(async () => ({ status: "error", error: "x", submissionUncertain: true }));
  await runModuleImageTask({ ...scope, requestId: randomUUID() }, next);
  expect(next).toHaveBeenCalledTimes(1);
});
it("legacy body record is read through and migrated into the table", async () => {
  const { updateStory } = await import("../repositories/stories");
  const legacy = { id: "legacy-1", requestId: "r", chapterId: 11, moduleId: "text-1", sourceHash: "h", provider: "midjourney", status: "accepted", providerTaskId: "mj-turbo:old", candidates: [] };
  await updateStory(scope.storyId, 122, { body: { shots: [], text: "原内容", bookModuleImageTasks: [legacy] } } as any);
  expect(await readModuleImageTask(scope)).toMatchObject({ status: "accepted", providerTaskId: "mj-turbo:old" });
  expect(await (await getImageTaskStore()).get("legacy-1")).toMatchObject({ status: "accepted" });
});
