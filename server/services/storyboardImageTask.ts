import { resume302FluxEdit, resume302FluxResult } from "./fluxKontextEdit";
import { resume302MjEdit } from "./mj302Edit";
import { createGeneratedImage, getStoryGeneratedImages } from "../repositories/images";
import { randomUUID } from "node:crypto";
import { getStoryById, updateStoryBodyIfRevision } from "../repositories/stories";
import { jsonRecord, persistedStoryBodyRevision } from "../repositories/storyValues";
import { resumeLegnextImage } from "./legnextImage";
import { resume302GptImageTask, type ImageGenResult, type ProviderErrorDetail } from "./imageGen";
import type { ChatImageRevision, ImageDimensions, ImageEditDimensionCheck } from "../../shared/chatImageRevision";
import { normalizeImageEditResult, readImageDimensions } from "./imageEditDimensions";
const resumeTask = (id: string, meta?: Meta) => meta?.provider === "local-palette" ? Promise.resolve<ImageGenResult>({status:"error",message:"Local results do not have provider tasks"})
  : meta?.provider === "flux-kontext-pro" ? resume302FluxEdit(id)
  : meta?.provider === "302-mj-edit" ? resume302MjEdit(id)
  : meta?.provider === "gpt-image" ? resume302GptImageTask(id, { gptImageModel: "gpt-image-2", gptTimeoutMs: 8000, gptPollIntervalMs: 1000 })
  : meta?.editMode ? resumeLegnextImage(id, meta.editMode) : resumeLegnextImage(id);
const resumeOutput = (url: string, id: string, meta?: Meta): Promise<ImageGenResult> => meta?.provider === "local-palette"
  ? Promise.resolve({status:"ok",imageUrl:url}) : resume302FluxResult(url,id);
import type { RenderProfileSnapshot } from "./render/snapshot";
import { SHOT_LOCK_LEASE_MS, UNKNOWN_TASK_STALE_MS, staleShotLockReason } from "./shotLock";
export { SHOT_LOCK_LEASE_MS, UNKNOWN_TASK_STALE_MS, staleShotLockReason } from "./shotLock";
const KEY = "storyboardImageTasks";
type Result = { status: "ok"; imageId: number; imageUrl: string; candidates: ChatImageRevision["candidates"]; providerResultUrl?: string; providerTaskId?: string; submissionUncertain?: boolean } | { status: "error"; error: string; providerResultUrl?: string; providerTaskId?: string; submissionUncertain?: boolean; recoveryPending?: boolean; providerError?: ProviderErrorDetail; staleReleased?: boolean };
type Meta = { renderProfile?: RenderProfileSnapshot; paletteAnalysis?: unknown; localPalette?: unknown; paletteReferenceImageId?: number; paletteReading?: unknown; sourceDimensions?: ImageDimensions; editMode?: "retexture"; referenceOnly?: boolean; provider?: "gpt-image" | "302-mj-edit" | "flux-kontext-pro" | "flux-kontext-dev" | "local-palette"; parentImageId?: number; conversationRevision?: boolean; instruction?: string; prompt: string; shotNo: string; promptCompilationId?: number | null; generationType: "initial" | "inpaint"; detached?: boolean };
export type Task = { analysisStartedAt?: number; continuedBy?: { requestId: string; userId: number; at: number }; createdAt?: number; decision?: { kind: "kept" | "replaced"; referenceOnly?: boolean; imageId?: number; at: number; userId: number }; leaseOwner?: string; leaseUntil?: number; meta?: Meta; id: string; requestId: string; shotIdentity: string; status: "preparing" | "unknown" | "accepted" | "failed" | "succeeded"; providerResultUrl?: string; providerTaskId?: string; result?: Result };
type Scope = { continueAfterUnknownRequestId?: string; requireNewIntent?: boolean; storyId: number; userId: number; shotIdentity: string; requestId: string };
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
class ShotLockLostError extends Error { constructor() { super("shot lock lost"); this.name = "ShotLockLostError"; } }
export type StoryboardImageRender = (submit: (accepted: (id: string) => Promise<void>, ready: (url: string) => Promise<void>) => Promise<ImageGenResult>, meta: Meta) => Promise<ImageGenResult>;
/** Persist before purchasing. Clicking again resumes an accepted job, never a second POST. */
export async function runStoryboardImageTask(scope: Scope, execute: (render: StoryboardImageRender, prepare: (meta: Meta) => Promise<void>, beginPaidAnalysis: () => Promise<void>) => Promise<Result>): Promise<Result> {
  const id = randomUUID();
  const task = await change(scope, tasks => {
    const now = Date.now();
    // Release stale locks on this shot first, recording why on the old task.
    for (const stale of tasks) {
      if (stale.shotIdentity !== scope.shotIdentity) continue;
      const reason = staleShotLockReason(stale, now);
      if (!reason) continue;
      const uncertain = stale.status === "unknown";
      console.warn("[storyboard-image-task] released stale shot lock", { shotIdentity: stale.shotIdentity, taskId: stale.id, status: stale.status });
      stale.status = "failed";
      delete stale.leaseOwner; delete stale.leaseUntil;
      stale.result = { status: "error", error: reason, staleReleased: true, ...(uncertain ? { submissionUncertain: true } : {}) };
    }
    const replay = tasks.find(t => t.requestId === scope.requestId && t.shotIdentity === scope.shotIdentity);
    if (replay) return replay;
    const pending = tasks.find(t => t.shotIdentity === scope.shotIdentity && !t.continuedBy && !["failed", "succeeded"].includes(t.status));
    if (pending) {
      if (scope.requireNewIntent && scope.continueAfterUnknownRequestId === pending.requestId && pending.status === "unknown" &&
          !pending.providerTaskId && !pending.providerResultUrl && (pending.leaseUntil ?? 0) <= Date.now()) {
        pending.continuedBy = { requestId:scope.requestId,userId:scope.userId,at:Date.now() };
      } else return pending;
    }
    const next: Task = { id, createdAt: now, requestId: scope.requestId, shotIdentity: scope.shotIdentity, status: "preparing", leaseOwner: id, leaseUntil: now + SHOT_LOCK_LEASE_MS };
    tasks.push(next); return next;
  });
  if (scope.requireNewIntent && task.requestId !== scope.requestId)
    return { status: "error", error: "这个镜头已有任务正在生成。新要求尚未提交，请等原图出现后继续修改；没有重复购买。" };
  if (task.status === "succeeded" || task.status === "failed") return task.result!;
  if (task.id !== id && !task.providerTaskId && !task.providerResultUrl) {
    const releaseAt = task.status === "preparing" ? (task.leaseUntil ?? Date.now()) : Math.max(task.leaseUntil ?? 0, (task.createdAt ?? 0) + UNKNOWN_TASK_STALE_MS);
    const minutes = Math.max(1, Math.ceil((releaseAt - Date.now()) / 60_000));
    return task.status === "preparing"
      ? { status: "error", error: `这个镜头正在准备另一次生成，尚未提交图片任务；约 ${minutes} 分钟内如未继续会自动释放，请稍后再试。` }
      : { status: "error", submissionUncertain: true, error: "这个镜头已有未确认的图片任务，请勿重复生成；请联系支持核对。" };
  }
  const update = (mutate: (task: Task) => void) => change(scope, tasks => {
    const saved = tasks.find(t => t.id === task.id);
    if (!saved) throw new Error("图片任务不存在");
    mutate(saved);
  });
  const lockDimensions = async (meta: Meta): Promise<Meta> => {
    if (!meta.conversationRevision) return meta;
    if (meta.sourceDimensions) return meta;
    const images = await getStoryGeneratedImages(scope.storyId, scope.userId);
    const source = images.find(image => image.id === meta.parentImageId);
    if (!source) throw new Error("原图不存在，未提交新任务 / Original unavailable; no new task submitted");
    return { ...meta, sourceDimensions: await readImageDimensions(source.imageUrl) };
  };
  let dimensionChecks: Record<string, ImageEditDimensionCheck> = {};
  const validateOutput = async (result: ImageGenResult, meta?: Meta) => {
    if (!meta?.sourceDimensions) return result;
    const checked = await normalizeImageEditResult(result, meta.sourceDimensions);
    dimensionChecks = checked.checks;
    return checked.result;
  };
  if (task.providerTaskId || task.providerResultUrl) {
    const claim = await change(scope, tasks => {
      const saved = tasks.find(t => t.id === task.id)!;
      if (saved.status === "succeeded") return { kind: "done" as const, result: saved.result! };
      if ((saved.leaseUntil ?? 0) > Date.now()) return { kind: "busy" as const };
      saved.leaseOwner = id; saved.leaseUntil = Date.now() + SHOT_LOCK_LEASE_MS;
      return { kind: "claimed" as const };
    });
    if (claim.kind === "done") return claim.result;
    if (claim.kind === "busy") return { status: "error", recoveryPending: true, providerTaskId: task.providerTaskId, error: "同一图片任务正在取回，请稍后查看，不会重新购买。" };
    try {
    // Resume without running the prompt director/compiler again (those calls can charge money).
    // Older accepted tasks acquire the same source lock on recovery, without a new purchase.
    if (task.meta) {
      task.meta = await lockDimensions(task.meta);
      await update(t => { t.meta = task.meta; });
    }
    const recovered = await validateOutput(task.providerResultUrl ? await resumeOutput(task.providerResultUrl, task.id, task.meta) : await resumeTask(task.providerTaskId!, task.meta), task.meta);
    if (recovered.status !== "ok") {
      const result = { status: "error" as const, recoveryPending: recovered.errorCode === "timeout_pending", providerTaskId: task.providerTaskId, error: recovered.message ?? "图片尚未就绪，请稍后恢复", ...(recovered.providerError ? { providerError: recovered.providerError } : {}) };
      // Legnext marks uncertain reads as timeout_pending; a terminal provider
      // failure must stop gallery recovery rather than spin forever.
      if (task.meta?.provider ? recovered.providerConfirmedFailure : !recovered.errorCode && recovered.providerTaskId) await update(t => { t.status = "failed"; t.result = result; });
      return result;
    }
    const story = await getStoryById(scope.storyId, scope.userId);
    if (!story || !task.meta) return { status: "error", providerTaskId: task.providerTaskId, error: "任务已完成，恢复元数据缺失，请联系支持；不要重新购买。" };
    const existing = await getStoryGeneratedImages(scope.storyId, scope.userId);
    const candidates = [];
    const { paletteAnalysis, localPalette, paletteReferenceImageId, paletteReading, sourceDimensions, detached, provider, conversationRevision, instruction, editMode, referenceOnly, renderProfile: _renderProfile, ...imageMeta } = task.meta;
    for (const candidate of recovered.candidates?.length ? recovered.candidates : recovered.imageUrl ? [{ imageUrl: recovered.imageUrl, imageKey: recovered.imageKey }] : []) {
      const image = existing.find(image => (provider === "local-palette" ? image.imageUrl === candidate.imageUrl : Boolean(candidate.imageKey) && image.imageKey === candidate.imageKey) && image.parentImageId === (imageMeta.parentImageId ?? null) && image.shotIdentity === (detached ? null : scope.shotIdentity)) ?? await createGeneratedImage({
        ...imageMeta, projectId: story.projectId, storyId: scope.storyId, userId: scope.userId,
        shotNo: detached ? null : imageMeta.shotNo,
        shotIdentity: detached ? null : scope.shotIdentity, imageUrl: candidate.imageUrl, imageKey: candidate.imageKey, isCurrent: false,
      });
      candidates.push({ imageId: image.id, imageUrl: image.imageUrl, ...(dimensionChecks[image.imageUrl] ? { dimensionCheck: dimensionChecks[image.imageUrl] } : {}) });
    }
    if (!candidates.length) return { status: "error", recoveryPending: true, providerTaskId: task.providerTaskId, error: "候选仍未就绪，请稍后恢复" };
    const result = { status: "ok" as const, ...candidates[0], candidates };
    await update(t => { t.status = "succeeded"; t.result = result; });
    return result;
    } finally {
      await update(t => { if (t.leaseOwner === id) { delete t.leaseOwner; delete t.leaseUntil; } });
    }
  }
  let submitted = Boolean(task.providerTaskId || task.providerResultUrl);
  let output = task.providerResultUrl;
  let receipt = task.providerTaskId;
  try {
    const result = await execute(async (submit, meta) => {
      meta = await lockDimensions(meta);
      if (output) return validateOutput(await resumeOutput(output, task.id, meta), meta);
      if (receipt) return validateOutput(await resumeTask(receipt, meta), meta);
      // Renew the holder's lease when the paid POST starts; "unknown" then stays
      // protected until reconciliation even if this process dies mid-request.
      let stillHolder = false;
      await update(t => {
        // A lease that lapsed may already have been released to a newer request;
        // never submit a paid job from a lock this request no longer holds.
        if (t.status !== "preparing" || t.leaseOwner !== id) return;
        stillHolder = true;
        t.status = "unknown"; t.meta = meta; t.leaseUntil = Date.now() + SHOT_LOCK_LEASE_MS;
      });
      if (!stillHolder) throw new ShotLockLostError();
      submitted = true;
      return validateOutput(await submit(async accepted => {
        receipt = accepted;
        await update(t => { t.providerTaskId = accepted; t.status = "accepted"; t.leaseUntil = Date.now() + SHOT_LOCK_LEASE_MS; });
      }, async url => {
        output = url;
        await update(t => { t.providerResultUrl = url; t.status = "accepted"; });
      }), meta);
    }, async meta => { await update(t => { t.meta = meta; }); }, async () => {
      // Persist before paid visual analysis too: a later status-write conflict
      // must not make its preparing lock look safe to buy again.
      let stillHolder = false;
      await update(t => {
        if (t.status !== "preparing" || t.leaseOwner !== id) return;
        t.analysisStartedAt = Date.now();
        stillHolder = true;
      });
      if (!stillHolder) throw new ShotLockLostError();
      submitted = true;
    });
    // Paid analysis can be uncertain before image rendering starts. Preserve that
    // fact even if the final task-state write conflicts and enters the catch below.
    submitted ||= Boolean(result.submissionUncertain);
    if (result.status === "ok") result.candidates = result.candidates.map(candidate => ({
      ...candidate,
      ...(dimensionChecks[candidate.imageUrl] ? { dimensionCheck: dimensionChecks[candidate.imageUrl] } : {}),
    }));
    await update(t => {
      t.providerTaskId ||= result.providerTaskId || receipt;
      t.providerResultUrl ||= result.providerResultUrl || output;
      t.status = result.status === "ok" ? "succeeded" : (t.providerTaskId || t.providerResultUrl) ? "accepted" : result.submissionUncertain ? "unknown" : "failed";
      t.result = result;
    });
    return output && result.status !== "ok" ? { ...result, recoveryPending:true, providerResultUrl:output } : result;
  } catch (error) {
    if (error instanceof ShotLockLostError) return { status: "error", error: "这个镜头的生成准备超时，锁已释放，本次没有提交图片任务，请重新生成。" };
    if (!submitted) await update(t => { t.status = "failed"; t.result = { status: "error", error: "生成准备失败，尚未提交图片任务" }; });
    return { status: "error", providerTaskId: receipt, providerResultUrl: output, recoveryPending: Boolean(output), submissionUncertain: submitted && !receipt && !output, error: "图片任务状态暂未确认，请稍后恢复同一镜头，勿重复购买。" };
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
  return (tasks ?? []).filter(t => !t.continuedBy && t.status !== "failed" && t.status !== "succeeded").map(t => ({ requestId: t.requestId, shotIdentity: t.shotIdentity, status:t.status, canContinue: t.status === "unknown" && !t.providerTaskId && !t.providerResultUrl && (t.leaseUntil ?? 0) <= Date.now(), recoverable: Boolean(t.providerTaskId || t.providerResultUrl) }));
}
