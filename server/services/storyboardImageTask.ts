import { createGeneratedImage, getStoryGeneratedImages } from "../repositories/images";
import { randomUUID } from "node:crypto";
import { getStoryById, updateStoryBodyIfRevision } from "../repositories/stories";
import { jsonRecord, persistedStoryBodyRevision } from "../repositories/storyValues";
import { resumeLegnextImage } from "./legnextImage";
import type { ImageGenResult } from "./imageGen";
const KEY = "storyboardImageTasks";
type Result = { status: "ok"; imageId: number; imageUrl: string; candidates: { imageId: number; imageUrl: string }[]; providerTaskId?: string; submissionUncertain?: boolean } | { status: "error"; error: string; providerTaskId?: string; submissionUncertain?: boolean; recoveryPending?: boolean };
type Meta = { prompt: string; shotNo: string; promptCompilationId?: number | null; generationType: "initial" | "inpaint" };
type Task = { leaseOwner?: string; leaseUntil?: number; meta?: Meta; id: string; requestId: string; shotIdentity: string; status: "preparing" | "unknown" | "accepted" | "failed" | "succeeded"; providerTaskId?: string; result?: Result };
type Scope = { storyId: number; userId: number; shotIdentity: string; requestId: string };
async function change<T>(scope: Scope, mutate: (tasks: Task[]) => T): Promise<T> {
  for (let n = 0; n < 12; n++) {
    const story = await getStoryById(scope.storyId, scope.userId);
    if (!story) throw new Error("故事不存在或无权访问");
    const body = jsonRecord(story.body);
    const tasks: Task[] = structuredClone(Array.isArray(body[KEY]) ? body[KEY] : []);
    const before = JSON.stringify(tasks);
    const result = mutate(tasks);
    if (JSON.stringify(tasks) === before) return result;
    const revision = persistedStoryBodyRevision(body);
    if (await updateStoryBodyIfRevision({ id: scope.storyId, userId: scope.userId, expectedRevision: revision, body: { ...body, [KEY]: tasks, _revision: revision + 1 } })) return result;
  }
  throw new Error("故事正在更新，请稍后查看图片任务");
}
export type StoryboardImageRender = (submit: (accepted: (id: string) => Promise<void>) => Promise<ImageGenResult>, meta: Meta) => Promise<ImageGenResult>;
/** Persist before purchasing. Clicking again resumes an accepted job, never a second POST. */
export async function runStoryboardImageTask(scope: Scope, execute: (render: StoryboardImageRender) => Promise<Result>): Promise<Result> {
  const id = randomUUID();
  const task = await change(scope, tasks => {
    const replay = tasks.find(t => t.requestId === scope.requestId && t.shotIdentity === scope.shotIdentity);
    if (replay) return replay;
    const pending = tasks.find(t => t.shotIdentity === scope.shotIdentity && !["failed", "succeeded"].includes(t.status));
    if (pending) return pending;
    const next: Task = { id, requestId: scope.requestId, shotIdentity: scope.shotIdentity, status: "preparing", leaseOwner: id, leaseUntil: Date.now() + 300_000 };
    tasks.push(next); return next;
  });
  if (task.status === "succeeded" || task.status === "failed") return task.result!;
  if (task.id !== id && !task.providerTaskId) return { status: "error", submissionUncertain: true, error: "这个镜头已有未确认的图片任务，请勿重复生成；请联系支持核对。" };
  const update = (mutate: (task: Task) => void) => change(scope, tasks => {
    const saved = tasks.find(t => t.id === task.id);
    if (!saved) throw new Error("图片任务不存在");
    mutate(saved);
  });
  if (task.providerTaskId) {
    const claim = await change(scope, tasks => {
      const saved = tasks.find(t => t.id === task.id)!;
      if (saved.status === "succeeded") return { kind: "done" as const, result: saved.result! };
      if ((saved.leaseUntil ?? 0) > Date.now()) return { kind: "busy" as const };
      saved.leaseOwner = id; saved.leaseUntil = Date.now() + 300_000;
      return { kind: "claimed" as const };
    });
    if (claim.kind === "done") return claim.result;
    if (claim.kind === "busy") return { status: "error", recoveryPending: true, providerTaskId: task.providerTaskId, error: "同一图片任务正在取回，请稍后查看，不会重新购买。" };
    try {
    // Resume without running the prompt director/compiler again (those calls can charge money).
    const recovered = await resumeLegnextImage(task.providerTaskId);
    if (recovered.status !== "ok") return { status: "error", recoveryPending: recovered.errorCode === "timeout_pending", providerTaskId: task.providerTaskId, error: recovered.message ?? "图片尚未就绪，请稍后恢复" };
    const story = await getStoryById(scope.storyId, scope.userId);
    if (!story || !task.meta) return { status: "error", providerTaskId: task.providerTaskId, error: "任务已完成，恢复元数据缺失，请联系支持；不要重新购买。" };
    const existing = await getStoryGeneratedImages(scope.storyId, scope.userId);
    const candidates = [];
    for (const candidate of recovered.candidates ?? []) {
      const image = existing.find(image => image.imageKey === candidate.imageKey && image.shotIdentity === scope.shotIdentity) ?? await createGeneratedImage({
        ...task.meta, projectId: story.projectId, storyId: scope.storyId, userId: scope.userId,
        shotIdentity: scope.shotIdentity, imageUrl: candidate.imageUrl, imageKey: candidate.imageKey, isCurrent: false,
      });
      candidates.push({ imageId: image.id, imageUrl: image.imageUrl });
    }
    if (!candidates.length) return { status: "error", recoveryPending: true, providerTaskId: task.providerTaskId, error: "候选仍未就绪，请稍后恢复" };
    const result = { status: "ok" as const, ...candidates[0], candidates };
    await update(t => { t.status = "succeeded"; t.result = result; });
    return result;
    } finally {
      await update(t => { if (t.leaseOwner === id) { delete t.leaseOwner; delete t.leaseUntil; } });
    }
  }
  let submitted = Boolean(task.providerTaskId);
  let receipt = task.providerTaskId;
  try {
    const result = await execute(async (submit, meta) => {
      if (receipt) return resumeLegnextImage(receipt);
      await update(t => { t.status = "unknown"; t.meta = meta; });
      submitted = true;
      return submit(async accepted => {
        receipt = accepted;
        await update(t => { t.providerTaskId = accepted; t.status = "accepted"; t.leaseUntil = Date.now() + 300_000; });
      });
    });
    await update(t => {
      t.providerTaskId ||= result.providerTaskId || receipt;
      t.status = result.status === "ok" ? "succeeded" : t.providerTaskId ? "accepted" : result.submissionUncertain ? "unknown" : "failed";
      t.result = result;
    });
    return result;
  } catch {
    if (!submitted) await update(t => { t.status = "failed"; t.result = { status: "error", error: "生成准备失败，尚未提交图片任务" }; });
    return { status: "error", providerTaskId: receipt, submissionUncertain: submitted && !receipt, error: "图片任务状态暂未确认，请稍后恢复同一镜头，勿重复购买。" };
  } finally {
    await update(t => { if (t.leaseOwner === id) { delete t.leaseOwner; delete t.leaseUntil; } });
  }
}

/** Recovery can only read a persisted receipt; absence must never create a paid job. */
export async function recoverStoryboardImageTask(storyId: number, userId: number, requestId: string): Promise<Result> {
  const story = await getStoryById(storyId, userId);
  if (!story) throw new Error("故事不存在或无权访问");
  const tasks = jsonRecord(story.body)[KEY] as Task[] | undefined;
  const task = tasks?.find(t => t.requestId === requestId || t.providerTaskId === requestId);
  if (!task) return { status: "error", error: "未找到原任务，未提交新的生成请求" };
  return runStoryboardImageTask({ storyId, userId, requestId: task.requestId, shotIdentity: task.shotIdentity }, async () => { throw new Error("恢复不允许购买"); });
}

export async function pendingStoryboardImageTasks(storyId: number, userId: number) {
  const story = await getStoryById(storyId, userId);
  if (!story) throw new Error("故事不存在或无权访问");
  const tasks = jsonRecord(story.body)[KEY] as Task[] | undefined;
  return (tasks ?? []).filter(t => t.status !== "failed" && t.status !== "succeeded").map(t => ({ requestId: t.requestId, shotIdentity: t.shotIdentity, recoverable: Boolean(t.providerTaskId) }));
}
