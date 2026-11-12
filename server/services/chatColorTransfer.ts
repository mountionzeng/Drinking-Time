/**
 * 对话里的免费调色：「按图一的颜色改图二图三」（套色，锁亮度）和「按图片 #2045 的亮度调图片 #2047」（只调亮度，锁色相和饱和度）。
 *
 * - 每张目标图直接在本机计算（colorTransfer.ts / luminanceGrade.ts），0 算力；通过本地 render 档位；
 *   不预占、不扣费、不写消费账本，不读图（没有 runInference），不编译提示词，不走 generateForMobile。
 * - 结果存成新图（parentImageId = 原图），原图不覆盖。分镜里的图同时登记一条对话改图记录，
 *   之后「替换原图 / 保留原图」沿用现有的 decideChatImageRevision，本文件不改它。
 * - 一张失败不影响其他张；失败不改走付费档位。
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { canonicalizeShotNo } from "../../shared/imageAsset";
import { shotIdentityFromShot } from "../../shared/shotIdentity";
import {
  COLOR_TRANSFER_MAX_TARGETS,
  type ColorTransferItemResult,
  type ResolvedColorTransferRef,
} from "../../shared/colorTransferIntent";
import type { GeneratedImage } from "../../drizzle/schema";
import { createGeneratedImage, getStoryGeneratedImages } from "../repositories/images";
import { getStoryById, updateStoryBodyIfRevision } from "../repositories/stories";
import { jsonRecord, persistedStoryBodyRevision } from "../repositories/storyValues";
import { localImagePathForUrl } from "./imageAssets";
import { storeImageBytes } from "./imageGen";
import type { Task } from "./storyboardImageTask";
import { COLOR_TRANSFER_ALGORITHM } from "./colorTransfer";
import { submitRender } from "./render/submitRender";
import { LUMINANCE_GRADE_ALGORITHM, gradeImageLuminance, type LuminanceGradeMetrics, type LuminanceStrength } from "./luminanceGrade";

const PROFILE = "image.local-color-transfer" as const;
const LUMA_PROFILE = "image.local-luminance-grade" as const;
const TASKS_KEY = "storyboardImageTasks";
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;

export type ColorTransferRequest = {
  storyId: number;
  userId: number;
  /** 客户端生成；同一个 requestId 重放只返回已有结果，不会重复出图。 */
  requestId: string;
  instruction: string;
  source: ResolvedColorTransferRef;
  targets: ResolvedColorTransferRef[];
  /** 只在测试里替换；默认用全局 fetch 读取 http(s) 原图。 */
  fetcher?: typeof fetch;
};

export type ColorTransferResponse = { sourceImageId: number; results: ColorTransferItemResult[] };

// 一次只跑一个调色（单张 1280² 约 2–3 秒 CPU），避免并发请求把服务端事件循环占满。
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

function describe(ref: ResolvedColorTransferRef): string {
  return "imageId" in ref ? `图片 #${ref.imageId}` : `第 ${ref.shotNo} 镜`;
}

function resolveImage(ref: ResolvedColorTransferRef, images: GeneratedImage[], body: Record<string, unknown>): GeneratedImage | string {
  if ("imageId" in ref) {
    return images.find(image => image.id === ref.imageId) ?? `${describe(ref)}不在当前故事里，或你没有权限修改它`;
  }
  const canonical = canonicalizeShotNo(ref.shotNo);
  const shots = Array.isArray(body.shots) ? (body.shots as Record<string, unknown>[]) : [];
  const index = shots.findIndex(shot => shot && canonicalizeShotNo(shot.shotNo as string | number | null | undefined) === canonical);
  if (!canonical || index < 0) return `当前故事没有${describe(ref)}`;
  const identity = shotIdentityFromShot(shots[index], index);
  return images.find(image => image.isCurrent && image.shotIdentity === identity) ?? `${describe(ref)}还没有当前主图`;
}

/** 读用户已存好的图（本机文件优先）；不调用任何供应商接口。 */
export function readStoryImageBytes(image: GeneratedImage, fetcher: typeof fetch = fetch): Promise<Uint8Array> {
  return readImageBytes(image, fetcher);
}

async function readImageBytes(image: GeneratedImage, fetcher: typeof fetch): Promise<Uint8Array> {
  const url = image.imageUrl;
  const inline = /^data:image\/[a-z+.-]+;base64,(.+)$/i.exec(url);
  if (inline) return new Uint8Array(Buffer.from(inline[1], "base64"));
  const localPath = localImagePathForUrl(url);
  if (localPath) {
    try {
      return new Uint8Array(await readFile(localPath));
    } catch {
      throw new Error(`图片 #${image.id} 的文件不在本机图片库里，无法本地调色`);
    }
  }
  if (!/^https?:\/\//i.test(url)) throw new Error(`图片 #${image.id} 的地址无法读取`);
  // 读取的是用户自己已存好的图片（不是供应商接口、不收费）。
  const response = await fetcher(url, { method: "GET", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`图片 #${image.id} 读取失败（HTTP ${response.status}）`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(`图片 #${image.id} 为空或超过 40MB`);
  return bytes;
}

function isShotImage(image: GeneratedImage): image is GeneratedImage & { shotIdentity: string; shotNo: string } {
  return Boolean(image.shotIdentity) && /^SH\d+$/i.test(image.shotNo ?? "");
}

/** 把成功的本地调色登记成一条「对话改图」记录，供「替换原图 / 保留原图」使用。幂等。 */
async function recordConversationRevision(input: {
  storyId: number;
  userId: number;
  requestId: string;
  sourceImageId: number;
  target: GeneratedImage & { shotIdentity: string; shotNo: string };
  images: Array<{ id: number; imageUrl: string }>;
  instruction: string;
  prompt: string;
  localGrade: Record<string, unknown>;
}): Promise<boolean> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const story = await getStoryById(input.storyId, input.userId);
    if (!story) return false;
    const body = jsonRecord(story.body);
    const tasks: Task[] = Array.isArray(body[TASKS_KEY]) ? structuredClone(body[TASKS_KEY] as Task[]) : [];
    if (tasks.some(task => task.requestId === input.requestId)) return true;
    // 本地调色不是供应商任务：localGrade 记录算法、参考图和 0 元，供复查；不进消费账本。
    const meta = {
      parentImageId: input.target.id,
      conversationRevision: true,
      instruction: input.instruction,
      prompt: input.prompt,
      shotNo: input.target.shotNo,
      generationType: "inpaint",
      localGrade: { ...input.localGrade, sourceImageId: input.sourceImageId, targetImageId: input.target.id, computeUnits: 0, costCny: 0 },
    } as Task["meta"];
    tasks.push({
      id: randomUUID(),
      createdAt: Date.now(),
      requestId: input.requestId,
      shotIdentity: input.target.shotIdentity,
      status: "succeeded",
      meta,
      result: {
        status: "ok",
        imageId: input.images[0].id,
        imageUrl: input.images[0].imageUrl,
        candidates: input.images.map(image => ({ imageId: image.id, imageUrl: image.imageUrl })),
      },
    });
    const revision = persistedStoryBodyRevision(body);
    if (await updateStoryBodyIfRevision({ id: input.storyId, userId: input.userId, expectedRevision: revision, body: { ...body, [TASKS_KEY]: tasks, _revision: revision + 1 } }))
      return true;
  }
  return false;
}

export function transferStoryImageColor(request: ColorTransferRequest): Promise<ColorTransferResponse> {
  return serialized(() => runTransfer(request));
}

async function runTransfer(request: ColorTransferRequest): Promise<ColorTransferResponse> {
  const fetcher = request.fetcher ?? fetch;
  if (!request.targets.length || request.targets.length > COLOR_TRANSFER_MAX_TARGETS)
    throw new Error(`一次可以改 1–${COLOR_TRANSFER_MAX_TARGETS} 张图`);
  const story = await getStoryById(request.storyId, request.userId);
  if (!story) throw new Error("故事不存在或无权访问");
  const body = jsonRecord(story.body);
  const images = await getStoryGeneratedImages(request.storyId, request.userId);
  const source = resolveImage(request.source, images, body);
  if (typeof source === "string") throw new Error(`${source}，没有调色`);
  const referenceBytes = await readImageBytes(source, fetcher);

  const results: ColorTransferItemResult[] = [];
  const done = new Set<number>();
  for (const ref of request.targets) {
    const target = resolveImage(ref, images, body);
    if (typeof target === "string") { results.push({ status: "error", targetImageId: null, target: describe(ref), error: target }); continue; }
    if (target.id === source.id) { results.push({ status: "error", targetImageId: target.id, target: `图片 #${target.id}`, error: "和参考图是同一张" }); continue; }
    if (done.has(target.id)) continue;
    done.add(target.id);
    const taskRequestId = `color:${request.requestId}:${target.id}`;
    const prompt = `本地调色：按图片 #${source.id} 的颜色，锁定亮度（${COLOR_TRANSFER_ALGORITHM}，0 算力）· ${taskRequestId}`;
    try {
      // 重放：同一个请求已经生成过就直接用，不再计算、不再存图。
      let image: Pick<GeneratedImage, "id" | "imageUrl"> | undefined = images.find(item => item.parentImageId === target.id && item.prompt === prompt);
      if (!image) {
        const out = await submitRender(PROFILE, { referenceBytes, targetBytes: await readImageBytes(target, fetcher) });
        if (out.status !== "ok") throw new Error(out.message);
        const stored = await storeImageBytes(out.png, "image/png");
        if (stored.status !== "ok" || !stored.imageUrl) throw new Error(stored.message ?? "新图保存失败");
        image = await createGeneratedImage({
          projectId: story.projectId ?? null,
          storyId: request.storyId,
          userId: request.userId,
          shotNo: target.shotNo ?? null,
          shotIdentity: target.shotIdentity ?? null,
          imageKey: stored.imageKey ?? null,
          imageUrl: stored.imageUrl,
          prompt,
          parentImageId: target.id,
          generationType: "inpaint",
          isCurrent: false,
        });
      }
      const awaitingDecision = isShotImage(target)
        ? await recordConversationRevision({ storyId: request.storyId, userId: request.userId, requestId: taskRequestId, sourceImageId: source.id, target, images: [image], instruction: request.instruction, prompt,
          localGrade: { profile: PROFILE, algorithm: COLOR_TRANSFER_ALGORITHM, mode: "palette" } })
        : false;
      results.push({
        status: "ok", targetImageId: target.id, imageId: image.id, imageUrl: image.imageUrl,
        shotNo: isShotImage(target) ? Number(target.shotNo.slice(2)) : null, awaitingDecision,
      });
    } catch (error) {
      results.push({ status: "error", targetImageId: target.id, target: `图片 #${target.id}`, error: error instanceof Error ? error.message : "调色失败" });
    }
    // 让出事件循环，再算下一张。
    await new Promise(resolve => setImmediate(resolve));
  }
  return { sourceImageId: source.id, results };
}

// ── 只调亮度 ──

export type LuminanceGradeRequest = {
  storyId: number;
  userId: number;
  requestId: string;
  instruction: string;
  /** 亮度参考图；不给时用目标图所在镜头设定的首帧图。 */
  reference?: ResolvedColorTransferRef;
  targets: ResolvedColorTransferRef[];
  strengths: LuminanceStrength[];
  fetcher?: typeof fetch;
};

export type LuminanceGradeItemResult =
  | { status: "ok"; targetImageId: number; referenceImageId: number; shotNo: number | null; awaitingDecision: boolean;
      candidates: Array<{ imageId: number; imageUrl: string; strength: LuminanceStrength; metrics?: LuminanceGradeMetrics }> }
  | { status: "error"; targetImageId: number | null; target: string; error: string };

function shotFirstFrameImageId(body: Record<string, unknown>, shotIdentity: string | null): number | null {
  if (!shotIdentity) return null;
  const shots = Array.isArray(body.shots) ? (body.shots as Record<string, unknown>[]) : [];
  const index = shots.findIndex((shot, i) => shot && shotIdentityFromShot(shot, i) === shotIdentity);
  if (index < 0) return null;
  let params: Record<string, unknown> = {};
  try {
    const raw = shots[index].generationParams;
    const parsed = typeof raw === "string" ? (raw.trim() ? JSON.parse(raw) : {}) : raw;
    if (parsed && typeof parsed === "object") params = parsed as Record<string, unknown>;
  } catch { /* 坏 JSON 当作没设首帧 */ }
  const roles = (params.storyboardFrameRoles && typeof params.storyboardFrameRoles === "object" ? params.storyboardFrameRoles : {}) as Record<string, unknown>;
  return Number(roles.firstImageId ?? params.firstFrameImageId ?? params.firstImageId) || null;
}

export function gradeStoryImageLuminance(request: LuminanceGradeRequest): Promise<{ results: LuminanceGradeItemResult[] }> {
  return serialized(() => runLuminance(request));
}

async function runLuminance(request: LuminanceGradeRequest): Promise<{ results: LuminanceGradeItemResult[] }> {
  const fetcher = request.fetcher ?? fetch;
  if (!request.targets.length || request.targets.length > COLOR_TRANSFER_MAX_TARGETS)
    throw new Error(`一次可以调 1–${COLOR_TRANSFER_MAX_TARGETS} 张图`);
  const strengths = Array.from(new Set(request.strengths.length ? request.strengths : (["mid", "full"] as LuminanceStrength[])));
  const story = await getStoryById(request.storyId, request.userId);
  if (!story) throw new Error("故事不存在或无权访问");
  const body = jsonRecord(story.body);
  const images = await getStoryGeneratedImages(request.storyId, request.userId);
  let explicitReference: GeneratedImage | null = null;
  if (request.reference) {
    const found = resolveImage(request.reference, images, body);
    if (typeof found === "string") throw new Error(`${found}，没有调整`);
    explicitReference = found;
  }
  const results: LuminanceGradeItemResult[] = [];
  const done = new Set<number>();
  const referenceBytesCache = new Map<number, Uint8Array>();
  for (const ref of request.targets) {
    const target = resolveImage(ref, images, body);
    if (typeof target === "string") { results.push({ status: "error", targetImageId: null, target: describe(ref), error: target }); continue; }
    if (done.has(target.id)) continue;
    done.add(target.id);
    const fallbackId = shotFirstFrameImageId(body, target.shotIdentity ?? null);
    const reference = explicitReference ?? images.find(image => image.id === fallbackId) ?? null;
    if (!reference) { results.push({ status: "error", targetImageId: target.id, target: `图片 #${target.id}`, error: "没有指定亮度参考图，这一镜也没有设首帧；请说「按图片 #编号 的亮度」" }); continue; }
    if (reference.id === target.id) { results.push({ status: "error", targetImageId: target.id, target: `图片 #${target.id}`, error: "和亮度参考图是同一张" }); continue; }
    const taskRequestId = `luma:${request.requestId}:${target.id}`;
    try {
      const prompts = Object.fromEntries(strengths.map(strength => [strength,
        `本地只调亮度（${strength === "mid" ? "中档" : "全档"}）：按图片 #${reference.id} 的亮度，色相和饱和度不变（${LUMINANCE_GRADE_ALGORITHM}，0 算力）· ${taskRequestId}`]));
      const existing = strengths.map(strength => images.find(item => item.parentImageId === target.id && item.prompt === prompts[strength]));
      let candidates: Extract<LuminanceGradeItemResult, { status: "ok" }>["candidates"];
      if (existing.every(Boolean)) {
        // 重放：同一个请求已经生成过就直接用，不再计算、不再存图。
        candidates = existing.map((image, i) => ({ imageId: image!.id, imageUrl: image!.imageUrl, strength: strengths[i] }));
      } else {
        let referenceBytes = referenceBytesCache.get(reference.id);
        if (!referenceBytes) { referenceBytes = await readImageBytes(reference, fetcher); referenceBytesCache.set(reference.id, referenceBytes); }
        const graded = await gradeImageLuminance(referenceBytes, await readImageBytes(target, fetcher), strengths);
        candidates = [];
        for (const out of graded) {
          const stored = await storeImageBytes(out.png, "image/png");
          if (stored.status !== "ok" || !stored.imageUrl) throw new Error(stored.message ?? "新图保存失败");
          const image = await createGeneratedImage({
            projectId: story.projectId ?? null, storyId: request.storyId, userId: request.userId,
            shotNo: target.shotNo ?? null, shotIdentity: target.shotIdentity ?? null,
            imageKey: stored.imageKey ?? null, imageUrl: stored.imageUrl, prompt: prompts[out.strength],
            parentImageId: target.id, generationType: "inpaint", isCurrent: false,
          });
          candidates.push({ imageId: image.id, imageUrl: image.imageUrl, strength: out.strength, metrics: out.metrics });
        }
      }
      const awaitingDecision = isShotImage(target)
        ? await recordConversationRevision({ storyId: request.storyId, userId: request.userId, requestId: taskRequestId, sourceImageId: reference.id, target,
            images: candidates.map(c => ({ id: c.imageId, imageUrl: c.imageUrl })), instruction: request.instruction, prompt: prompts[strengths[0]],
            localGrade: { profile: LUMA_PROFILE, algorithm: LUMINANCE_GRADE_ALGORITHM, mode: "luminance", strengths, metrics: candidates.map(c => c.metrics ?? null) } })
        : false;
      results.push({ status: "ok", targetImageId: target.id, referenceImageId: reference.id, shotNo: isShotImage(target) ? Number(target.shotNo.slice(2)) : null, awaitingDecision, candidates });
    } catch (error) {
      results.push({ status: "error", targetImageId: target.id, target: `图片 #${target.id}`, error: error instanceof Error ? error.message : "调整失败" });
    }
    await new Promise(resolve => setImmediate(resolve));
  }
  return { results };
}

// ── AI 改图结果旁边的免费「只调亮度」候选 ──

export type LuminanceCandidateMeta = {
  imageId: number; strength: LuminanceStrength; fromImageId: number; referenceImageId: number; computeUnits: 0; costCny: 0;
};
type AttachResult =
  | { status: "ok" | "exists"; candidates: Array<{ imageId: number; imageUrl: string; strength: LuminanceStrength }> }
  | { status: "skipped"; reason: string };

/**
 * 付费改图（gpt-image / MJ）出图后，用原图的亮度给 AI 新图做「只调亮度」（中档、全档），
 * 追加到同一条对话改图记录里并排显示。0 算力；不替换任何图，仍等用户说「第 N 张替换原图」。幂等。
 */
export function attachLuminanceCandidates(input: {
  storyId: number; userId: number; revisionRequestId: string; strengths?: LuminanceStrength[]; fetcher?: typeof fetch;
}): Promise<AttachResult> {
  return serialized(() => runAttach(input));
}

function readTasks(body: Record<string, unknown>): Task[] {
  return Array.isArray(body[TASKS_KEY]) ? structuredClone(body[TASKS_KEY] as Task[]) : [];
}

async function runAttach(input: {
  storyId: number; userId: number; revisionRequestId: string; strengths?: LuminanceStrength[]; fetcher?: typeof fetch;
}): Promise<AttachResult> {
  const strengths = Array.from(new Set(input.strengths?.length ? input.strengths : (["mid", "full"] as LuminanceStrength[])));
  const story = await getStoryById(input.storyId, input.userId);
  if (!story) throw new Error("故事不存在或无权访问");
  const task = readTasks(jsonRecord(story.body)).find(item => item.requestId === input.revisionRequestId);
  const meta = task?.meta as (Task["meta"] & { localGrade?: unknown; luminanceCandidates?: LuminanceCandidateMeta[] }) | undefined;
  if (!task || !meta?.conversationRevision || !meta.parentImageId) return { status: "skipped", reason: "不是对话改图记录" };
  if (meta.paletteReferenceImageId) return { status: "skipped", reason: "配色参考改图只保留用户要求的一张候选" };
  if (meta.localGrade) return { status: "skipped", reason: "本地调色结果不再叠加" };
  if (task.status !== "succeeded" || task.result?.status !== "ok" || !task.result.candidates.length) return { status: "skipped", reason: "改图还没有成功" };
  if (task.result.candidates.some(image => image.dimensionCheck && !["matched", "resized"].includes(image.dimensionCheck.status)))
    return { status: "skipped", reason: "候选尺寸尚未通过核对，不生成衍生版本" };
  if (task.decision) return { status: "skipped", reason: "已经做过替换/保留决定" };
  const images = await getStoryGeneratedImages(input.storyId, input.userId);
  if (meta.luminanceCandidates?.length) {
    return { status: "exists", candidates: meta.luminanceCandidates.flatMap(item => {
      const image = images.find(candidate => candidate.id === item.imageId);
      return image ? [{ imageId: image.id, imageUrl: image.imageUrl, strength: item.strength }] : [];
    }) };
  }
  const original = images.find(image => image.id === meta.parentImageId);
  const aiImageId = task.result.candidates[0]!.imageId;
  const aiImage = images.find(image => image.id === aiImageId);
  if (!original || !aiImage) return { status: "skipped", reason: "原图或新图已不在仓库" };
  const fetcher = input.fetcher ?? fetch;
  const tag = `luma-ai:${input.revisionRequestId}`;
  const prompts = Object.fromEntries(strengths.map(strength => [strength,
    `本地只调亮度（${strength === "mid" ? "中档" : "全档"}）：AI 新图 #${aiImage.id} 按原图 #${original.id} 的亮度，色相和饱和度不变（${LUMINANCE_GRADE_ALGORITHM}，0 算力）· ${tag}`]));
  // 父图记成原图：「第 N 张替换原图」要求候选的 parentImageId 就是原图（decideChatImageRevision 的校验）。
  const existing = strengths.map(strength => images.find(item => item.parentImageId === original.id && item.prompt === prompts[strength]));
  let created: Array<{ imageId: number; imageUrl: string; strength: LuminanceStrength }>;
  if (existing.every(Boolean)) {
    created = existing.map((image, i) => ({ imageId: image!.id, imageUrl: image!.imageUrl, strength: strengths[i] }));
  } else {
    const graded = await gradeImageLuminance(await readImageBytes(original, fetcher), await readImageBytes(aiImage, fetcher), strengths);
    created = [];
    for (const out of graded) {
      const saved = existing[strengths.indexOf(out.strength)];
      if (saved) {
        created.push({ imageId: saved.id, imageUrl: saved.imageUrl, strength: out.strength });
        continue;
      }
      const stored = await storeImageBytes(out.png, "image/png");
      if (stored.status !== "ok" || !stored.imageUrl) throw new Error(stored.message ?? "新图保存失败");
      const image = await createGeneratedImage({
        projectId: story.projectId ?? null, storyId: input.storyId, userId: input.userId,
        shotNo: aiImage.shotNo ?? original.shotNo ?? null, shotIdentity: aiImage.shotIdentity ?? original.shotIdentity ?? null,
        imageKey: stored.imageKey ?? null, imageUrl: stored.imageUrl, prompt: prompts[out.strength],
        parentImageId: original.id, generationType: "inpaint", isCurrent: false,
      });
      created.push({ imageId: image.id, imageUrl: image.imageUrl, strength: out.strength });
    }
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    const latest = await getStoryById(input.storyId, input.userId);
    if (!latest) throw new Error("故事不存在或无权访问");
    const body = jsonRecord(latest.body);
    const tasks = readTasks(body);
    const current = tasks.find(item => item.requestId === input.revisionRequestId);
    if (!current || current.result?.status !== "ok") return { status: "skipped", reason: "改图记录已变化" };
    // 用户这期间已经做了决定：新图留在仓库，不再改这条记录。
    if (current.decision) return { status: "skipped", reason: "已经做过替换/保留决定" };
    const known = new Set(current.result.candidates.map(item => item.imageId));
    current.result.candidates.push(...created.filter(item => !known.has(item.imageId)).map(item => ({ imageId: item.imageId, imageUrl: item.imageUrl })));
    current.meta = { ...current.meta!, luminanceCandidates: created.map(item => ({
      imageId: item.imageId, strength: item.strength, fromImageId: aiImage.id, referenceImageId: original.id, computeUnits: 0, costCny: 0,
    })) } as Task["meta"];
    const revision = persistedStoryBodyRevision(body);
    if (await updateStoryBodyIfRevision({ id: input.storyId, userId: input.userId, expectedRevision: revision, body: { ...body, [TASKS_KEY]: tasks, _revision: revision + 1 } }))
      return { status: "ok", candidates: created };
  }
  throw new Error("改图记录正在被其他操作更新，请稍后再试；新图已保存在仓库");
}
