import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import fs from "node:fs";
import { isIP } from "node:net";
import os from "node:os";
import path from "node:path";
import {
  claimEditingTransitionSubmission,
  createVideoTakeIdempotently,
  findVideoTakeByIdempotencyKey,
  getStoryById,
  insertTransitionShotAtomic,
  updateVideoTake,
} from "../db";
import type { VideoTake } from "../../drizzle/schema";
import {
  DEFAULT_TIMELINE_TRANSFORM,
  type StoryTimelineItem,
} from "../../shared/storyMaterial";
import { getStoryRevision, prepareStoryBody } from "./storySync";
import {
  getStoryImageAssets,
  localImagePathForUrl,
} from "./imageAssets";
import { getStoryMaterialState } from "./storyMaterials";
import { localVideoDir } from "./videoMedia";
import { probeVideoFileMetadata } from "./videoConform";
import { selectVideoTimelineSegment } from "./videoTimeline";
import {
  transitionEndpointForShot,
  type TimelineTransitionCandidate,
  type TimelineTransitionEndpoint,
} from "./timelineEditAgent";
import { renderTransitionVideoFrame } from "./videoEndpointFrames";
import {
  downloadVideoToFile,
  hardCutToLastFrame,
  submitViduTransition,
  uploadFileToVidu,
  ViduSubmissionError,
  waitForViduTransition,
} from "./videoTransition302";

type RecordValue = Record<string, unknown>;

export type ConfirmEditingTransitionResult =
  | {
      status: "applied";
      reply: string;
      takeId: number;
      insertedStableShotId: string;
      storyShots: RecordValue[];
      storyRevision: number;
      timelineVersion: number;
      videoUrl: string;
    }
  | {
      status: "processing";
      reply: string;
      takeId: number;
      taskId?: string;
    }
  | {
      status: "error";
      error: string;
      takeId?: number;
      retryable: boolean;
      submissionUnknown?: boolean;
    };

const activeConfirmations = new Map<
  string,
  Promise<ConfirmEditingTransitionResult>
>();

const MAX_TRANSITION_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_REDIRECTS = 3;

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}

function storyShots(body: unknown): RecordValue[] {
  const shots = record(body).shots;
  return Array.isArray(shots)
    ? shots.filter(
        (shot): shot is RecordValue =>
          Boolean(shot && typeof shot === "object" && !Array.isArray(shot))
      )
    : [];
}

function stableShotIdOf(shot: RecordValue): string {
  for (const value of [
    shot.stableShotId,
    shot.shotIdentity,
    shot.shotKey,
  ]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function currentSnapshot(take: VideoTake): RecordValue {
  return record(take.parameterSnapshot);
}

function normalizeCandidateEndpoint(
  value: TimelineTransitionEndpoint | RecordValue
): TimelineTransitionEndpoint {
  const endpoint = value as RecordValue;
  if (
    endpoint.mediaKind === "video" &&
    typeof endpoint.stableShotId === "string" &&
    typeof endpoint.shotNo === "number" &&
    typeof endpoint.videoTakeId === "number" &&
    (endpoint.rangeId === null || typeof endpoint.rangeId === "number") &&
    (endpoint.selectionType === "full_take" ||
      endpoint.selectionType === "range") &&
    typeof endpoint.atSec === "number" &&
    typeof endpoint.mediaRevision === "string"
  ) {
    return {
      mediaKind: "video",
      stableShotId: endpoint.stableShotId,
      shotNo: endpoint.shotNo,
      videoTakeId: endpoint.videoTakeId,
      rangeId: endpoint.rangeId,
      selectionType: endpoint.selectionType,
      atSec: endpoint.atSec,
      mediaRevision: endpoint.mediaRevision,
      imageUrl: typeof endpoint.imageUrl === "string" ? endpoint.imageUrl : "",
    };
  }
  // 已创建的旧图片任务没有 mediaKind；继续按 imageId 恢复，避免刷新后失联。
  if (
    typeof endpoint.stableShotId === "string" &&
    typeof endpoint.shotNo === "number" &&
    typeof endpoint.imageId === "number"
  ) {
    return {
      mediaKind: "image",
      stableShotId: endpoint.stableShotId,
      shotNo: endpoint.shotNo,
      imageId: endpoint.imageId,
      imageUrl: typeof endpoint.imageUrl === "string" ? endpoint.imageUrl : "",
    };
  }
  throw new Error("衔接首尾素材无效，请重新生成确认卡");
}

function normalizeCandidate(
  candidate: TimelineTransitionCandidate
): TimelineTransitionCandidate {
  return {
    ...candidate,
    source: normalizeCandidateEndpoint(candidate.source),
    target: normalizeCandidateEndpoint(candidate.target),
  };
}

async function patchTake(
  take: VideoTake,
  userId: number,
  patch: Parameters<typeof updateVideoTake>[2],
  snapshotPatch?: RecordValue
): Promise<VideoTake> {
  const updated = await updateVideoTake(take.id, userId, {
    ...patch,
    ...(snapshotPatch
      ? {
          parameterSnapshot: {
            ...currentSnapshot(take),
            ...snapshotPatch,
          },
        }
      : {}),
  });
  if (!updated) {
    throw new Error("衔接视频任务状态持久化失败，已停止后续付费操作");
  }
  return updated;
}

function verifyCandidateShape(candidate: TimelineTransitionCandidate) {
  if (
    candidate.durationSec !== 2 ||
    candidate.resolution !== "720p" ||
    candidate.cutAtSec !== 1.4 ||
    candidate.estimatedCredits !== 10
  ) {
    throw new Error("衔接参数已经变化，请让小酌重新生成确认卡");
  }
  if (
    !candidate.candidateId.startsWith("transition-") ||
    !candidate.provisionalStableShotId.startsWith("transition-shot-") ||
    candidate.source.stableShotId === candidate.target.stableShotId
  ) {
    throw new Error("衔接确认卡无效，请重新选择镜头");
  }
  const endpointIsValid = (endpoint: TimelineTransitionEndpoint) =>
    endpoint.mediaKind === "image"
      ? Number.isInteger(endpoint.imageId) && endpoint.imageId > 0
      : endpoint.mediaKind === "video" &&
        Number.isInteger(endpoint.videoTakeId) &&
        endpoint.videoTakeId > 0 &&
        Number.isFinite(endpoint.atSec) &&
        endpoint.atSec >= 0 &&
        (endpoint.selectionType === "full_take" ||
          endpoint.selectionType === "range") &&
        (endpoint.rangeId == null ||
          (Number.isInteger(endpoint.rangeId) && endpoint.rangeId > 0)) &&
        Boolean(endpoint.mediaRevision.trim());
  if (!endpointIsValid(candidate.source) || !endpointIsValid(candidate.target)) {
    throw new Error("衔接首尾素材无效，请重新生成确认卡");
  }
}

function storedCandidateForTake(
  take: VideoTake,
  requested: TimelineTransitionCandidate
): TimelineTransitionCandidate {
  const stored = currentSnapshot(take).candidate;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    throw new Error("已有衔接任务缺少锁定参数，为避免串用视频已停止处理");
  }
  const candidate = stored as TimelineTransitionCandidate;
  const normalized = normalizeCandidate(candidate);
  verifyCandidateShape(normalized);
  if (
    normalized.candidateId !== requested.candidateId ||
    normalized.storyId !== requested.storyId ||
    normalized.provisionalStableShotId !== take.stableShotId
  ) {
    throw new Error("衔接任务与确认卡不一致，为避免串用视频已停止处理");
  }
  return normalized;
}

function adjacentIncludedPair(
  items: StoryTimelineItem[],
  sourceStableShotId: string,
  targetStableShotId: string
) {
  const included = [...items]
    .sort((left, right) => left.position - right.position)
    .filter(item => item.included);
  const sourceIndex = included.findIndex(
    item => item.stableShotId === sourceStableShotId
  );
  return (
    sourceIndex >= 0 &&
    included[sourceIndex + 1]?.stableShotId === targetStableShotId
  );
}

async function validateBeforePaidSubmission(
  candidate: TimelineTransitionCandidate,
  userId: number
): Promise<TimelineTransitionCandidate> {
  const material = await getStoryMaterialState(candidate.storyId, userId);
  if (!material) throw new Error("故事不存在或无权操作");
  if (material.timeline.version !== candidate.expectedTimelineVersion) {
    throw new Error("时间轴已经更新，请让小酌重新确认衔接位置");
  }
  if (
    !adjacentIncludedPair(
      material.timeline.items,
      candidate.source.stableShotId,
      candidate.target.stableShotId
    )
  ) {
    throw new Error("这两镜已经不再相邻，请重新选择衔接位置");
  }
  const source = material.shots.find(
    shot => shot.stableShotId === candidate.source.stableShotId
  );
  const target = material.shots.find(
    shot => shot.stableShotId === candidate.target.stableShotId
  );
  const sourceItem = material.timeline.items.find(
    item => item.stableShotId === candidate.source.stableShotId
  );
  const targetItem = material.timeline.items.find(
    item => item.stableShotId === candidate.target.stableShotId
  );
  if (!source || !target || !sourceItem || !targetItem) {
    throw new Error("首帧或尾帧对应镜头已经不存在，请重新选择衔接位置");
  }
  const canonicalSource = transitionEndpointForShot(source, sourceItem, "end");
  const canonicalTarget = transitionEndpointForShot(target, targetItem, "start");
  const endpointStillCurrent = (
    requested: TimelineTransitionEndpoint,
    canonical: TimelineTransitionEndpoint | null
  ) => {
    if (!canonical || requested.mediaKind !== canonical.mediaKind) return false;
    if (
      requested.stableShotId !== canonical.stableShotId ||
      requested.shotNo !== canonical.shotNo
    ) {
      return false;
    }
    if (requested.mediaKind === "image" && canonical.mediaKind === "image") {
      return requested.imageId === canonical.imageId;
    }
    if (requested.mediaKind === "video" && canonical.mediaKind === "video") {
      return (
        requested.videoTakeId === canonical.videoTakeId &&
        requested.rangeId === canonical.rangeId &&
        requested.selectionType === canonical.selectionType &&
        Math.abs(requested.atSec - canonical.atSec) < 0.001 &&
        requested.mediaRevision === canonical.mediaRevision
      );
    }
    return false;
  };
  if (
    !endpointStillCurrent(candidate.source, canonicalSource) ||
    !endpointStillCurrent(candidate.target, canonicalTarget)
  ) {
    throw new Error("首帧或尾帧已经更换，请让小酌重新生成确认卡");
  }
  return {
    ...candidate,
    // 确认请求里的 URL 只用于界面预览。付费提交永远重新读取当前归属已校验的服务端资产，
    // 避免客户端把相同 imageId 换成任意远程地址。
    source: canonicalSource!,
    target: canonicalTarget!,
  };
}

function decodeDataUrl(value: string): {
  bytes: Uint8Array;
  contentType: string;
} | null {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(
    value
  );
  if (!match) return null;
  const bytes = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (bytes.byteLength === 0 || bytes.byteLength >= MAX_TRANSITION_IMAGE_BYTES) {
    throw new Error("衔接首尾帧为空或超过 10MB");
  }
  return { bytes, contentType: match[1] };
}

function isPrivateNetworkAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (isIP(normalized) === 6) {
    if (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized)
    ) {
      return true;
    }
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
    return mapped ? isPrivateNetworkAddress(mapped[1]) : false;
  }
  return true;
}

async function assertPublicImageUrl(url: URL): Promise<void> {
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw new Error("首尾帧远程地址不能指向本机或私有网络");
  }
  if (isIP(hostname)) {
    if (isPrivateNetworkAddress(hostname)) {
      throw new Error("首尾帧远程地址不能指向本机或私有网络");
    }
    return;
  }
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("首尾帧远程地址无法解析");
  }
  if (
    addresses.length === 0 ||
    addresses.some(entry => isPrivateNetworkAddress(entry.address))
  ) {
    throw new Error("首尾帧远程地址不能指向本机或私有网络");
  }
}

async function fetchPublicImage(
  url: URL,
  redirectCount = 0
): Promise<Response> {
  await assertPublicImageUrl(url);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    redirect: "manual",
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    if (!location || redirectCount >= MAX_IMAGE_REDIRECTS) {
      throw new Error("首尾帧远程地址重定向过多或无效");
    }
    return fetchPublicImage(new URL(location, url), redirectCount + 1);
  }
  return response;
}

async function readLimitedResponse(response: Response): Promise<Uint8Array> {
  if (!response.body) throw new Error("首尾帧响应为空");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size >= MAX_TRANSITION_IMAGE_BYTES) {
        await reader.cancel();
        throw new Error("衔接首尾帧超过 10MB");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size === 0) throw new Error("衔接首尾帧为空");
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), size);
}

async function imageBytesForAsset(imageUrl: string): Promise<{
  bytes: Uint8Array;
  contentType: string;
}> {
  const localPath = localImagePathForUrl(imageUrl);
  if (localPath) {
    const metadata = await fs.promises.stat(localPath);
    if (metadata.size === 0 || metadata.size >= MAX_TRANSITION_IMAGE_BYTES) {
      throw new Error("衔接首尾帧为空或超过 10MB");
    }
    const extension = path.extname(localPath).toLowerCase();
    const contentType =
      extension === ".jpg" || extension === ".jpeg"
        ? "image/jpeg"
        : extension === ".webp"
          ? "image/webp"
          : "image/png";
    return { bytes: await fs.promises.readFile(localPath), contentType };
  }

  const inline = decodeDataUrl(imageUrl);
  if (inline) return inline;

  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw new Error("首尾帧地址无效");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("首尾帧只支持本地图片或 HTTP(S) 地址");
  }
  const response = await fetchPublicImage(parsed);
  if (!response.ok) throw new Error(`首尾帧读取失败 HTTP ${response.status}`);
  const contentType = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim();
  if (!(["image/png", "image/jpeg", "image/webp"] as string[]).includes(contentType)) {
    throw new Error("首尾帧格式必须是 PNG、JPEG 或 WEBP");
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength >= MAX_TRANSITION_IMAGE_BYTES
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("衔接首尾帧超过 10MB");
  }
  const bytes = await readLimitedResponse(response);
  return { bytes, contentType };
}

function runProcess(
  command: string,
  args: string[],
  timeoutMs = 60_000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`${path.basename(command)} 图片预处理超时`));
    }, timeoutMs);
    child.stderr.on("data", chunk => {
      stderr = `${stderr}${String(chunk)}`.slice(-12_000);
    });
    child.on("error", error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `ffmpeg 退出码 ${code}`));
    });
  });
}

async function squareFrame(
  source: { bytes: Uint8Array; contentType: string },
  inputPath: string,
  outputPath: string
) {
  await fs.promises.writeFile(inputPath, source.bytes);
  const ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg";
  await runProcess(ffmpegPath, [
    "-y",
    "-i",
    inputPath,
    "-vf",
    "scale=720:720:force_original_aspect_ratio=increase,crop=720:720",
    "-frames:v",
    "1",
    outputPath,
  ]);
  const bytes = new Uint8Array(await fs.promises.readFile(outputPath));
  return { bytes, contentType: "image/png", path: outputPath };
}

async function prepareCandidateFrames(
  candidate: TimelineTransitionCandidate,
  userId: number
) {
  const assets = await getStoryImageAssets(candidate.storyId, userId);
  const temporaryDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "xiaozhuo-transition-")
  );
  try {
    const prepareEndpoint = async (
      endpoint: TimelineTransitionEndpoint,
      name: "first" | "last"
    ) => {
      const outputPath = path.join(temporaryDir, `${name}.png`);
      if (endpoint.mediaKind === "video") {
        await renderTransitionVideoFrame({
          takeId: endpoint.videoTakeId,
          userId,
          rangeId: endpoint.rangeId,
          atSec: endpoint.atSec,
          outputPath,
        });
        return {
          bytes: new Uint8Array(await fs.promises.readFile(outputPath)),
          contentType: "image/png" as const,
          path: outputPath,
        };
      }
      const asset = assets.find(item => item.id === endpoint.imageId);
      if (!asset || asset.availability === "missing") {
        throw new Error("锁定的首帧或尾帧文件已经不存在");
      }
      const bytes = await imageBytesForAsset(asset.imageUrl);
      return squareFrame(
        bytes,
        path.join(temporaryDir, `${name}-input`),
        outputPath
      );
    };
    const [firstFrame, lastFrame] = await Promise.all([
      prepareEndpoint(candidate.source, "first"),
      prepareEndpoint(candidate.target, "last"),
    ]);
    return {
      temporaryDir,
      firstFrame,
      lastFrame,
      cleanup: () => fs.promises.rm(temporaryDir, { recursive: true, force: true }),
    };
  } catch (error) {
    await fs.promises.rm(temporaryDir, { recursive: true, force: true });
    throw error;
  }
}

/** 可替换的本地媒体边界，便于在单测里证明付费幂等而不启动 ffmpeg。 */
function durableLastFramePath(takeId: number) {
  return path.join(localVideoDir(), `take-${takeId}.transition-last.png`);
}

async function persistDurableLastFrame(takeId: number, sourcePath: string) {
  const outputPath = durableLastFramePath(takeId);
  await fs.promises.mkdir(localVideoDir(), { recursive: true });
  await fs.promises.copyFile(sourcePath, outputPath);
  return outputPath;
}

async function findDurableLastFrame(takeId: number): Promise<string | null> {
  const outputPath = durableLastFramePath(takeId);
  try {
    await fs.promises.access(outputPath);
    return outputPath;
  } catch {
    return null;
  }
}

/** 可替换的本地媒体边界，便于在单测里证明付费幂等而不启动 ffmpeg。 */
export const editingTransitionRuntime = {
  prepareCandidateFrames,
  persistDurableLastFrame,
  findDurableLastFrame,
};

function insertedTransitionShot(params: {
  candidate: TimelineTransitionCandidate;
  source: RecordValue;
  target: RecordValue;
  shotNo: number;
  takeId: number;
}): RecordValue {
  const { candidate, source, target, shotNo, takeId } = params;
  const inherited = (key: string) => target[key] ?? source[key] ?? "";
  return {
    stableShotId: candidate.provisionalStableShotId,
    shotIdentity: candidate.provisionalStableShotId,
    shotKey: candidate.provisionalStableShotId,
    shotNo,
    sceneNo: inherited("sceneNo"),
    sceneTitle: inherited("sceneTitle"),
    sceneArtBrief: inherited("sceneArtBrief"),
    subject: `SH${String(candidate.source.shotNo).padStart(2, "0")} 到 SH${String(candidate.target.shotNo).padStart(2, "0")} 的衔接`,
    action: candidate.instruction,
    dialogue: "",
    shotType: "转场镜头",
    beat: inherited("beat") || "转折",
    cameraAngle: inherited("cameraAngle"),
    cameraMove: "首尾帧快速连续转场",
    location: inherited("location"),
    timeLight: inherited("timeLight"),
    mood: inherited("mood"),
    sound: inherited("sound"),
    styleRef: inherited("styleRef"),
    note: "由小酌创作对话确认后生成并插入",
    emotion: inherited("emotion"),
    sourceCardContent: inherited("sourceCardContent"),
    intent: "连接相邻镜头，同时保持人物、场景和画风连续",
    rationale: candidate.instruction,
    videoStart: `继承 SH${String(candidate.source.shotNo).padStart(2, "0")} 当前画面的末帧`,
    videoEnd: `准确落在 SH${String(candidate.target.shotNo).padStart(2, "0")} 当前画面的首帧`,
    transitionIn: candidate.instruction,
    transitionOut: "尾帧与下一镜当前主图一致，可直接硬切",
    videoPrompt: candidate.prompt,
    durationMs: candidate.durationSec * 1000,
    sourceTransition: {
      candidateId: candidate.candidateId,
      sourceStableShotId: candidate.source.stableShotId,
      targetStableShotId: candidate.target.stableShotId,
      firstImageId:
        candidate.source.mediaKind === "image"
          ? candidate.source.imageId
          : null,
      lastImageId:
        candidate.target.mediaKind === "image"
          ? candidate.target.imageId
          : null,
      firstVideoTakeId:
        candidate.source.mediaKind === "video"
          ? candidate.source.videoTakeId
          : null,
      lastVideoTakeId:
        candidate.target.mediaKind === "video"
          ? candidate.target.videoTakeId
          : null,
      takeId,
      provider: "302",
      model: "viduq2-turbo",
    },
  };
}

async function applyGeneratedTransition(
  candidate: TimelineTransitionCandidate,
  take: VideoTake,
  userId: number
) {
  const [story, material] = await Promise.all([
    getStoryById(candidate.storyId, userId),
    getStoryMaterialState(candidate.storyId, userId),
  ]);
  if (!story || !material) throw new Error("故事不存在或无权操作");
  const body = record(story.body);
  const shots = storyShots(story.body);
  const existing = shots.find(
    shot => stableShotIdOf(shot) === candidate.provisionalStableShotId
  );
  if (existing) {
    return {
      storyShots: shots,
      storyRevision: getStoryRevision(story.body),
      timelineVersion: material.timeline.version,
      applied: false,
    };
  }

  const sourceIndex = shots.findIndex(
    shot => stableShotIdOf(shot) === candidate.source.stableShotId
  );
  const targetIndex = shots.findIndex(
    shot => stableShotIdOf(shot) === candidate.target.stableShotId
  );
  if (sourceIndex < 0 || targetIndex < 0) {
    throw new Error("视频已生成，但故事版中的来源或目标镜头已经不存在");
  }
  if (
    !adjacentIncludedPair(
      material.timeline.items,
      candidate.source.stableShotId,
      candidate.target.stableShotId
    )
  ) {
    throw new Error("视频已生成，但时间轴中的两镜位置已变化；没有自动插错位置");
  }

  const inserted = insertedTransitionShot({
    candidate,
    source: shots[sourceIndex],
    target: shots[targetIndex],
    shotNo: targetIndex + 1,
    takeId: take.id,
  });
  const nextShots = [
    ...shots.slice(0, targetIndex),
    inserted,
    ...shots.slice(targetIndex),
  ].map((shot, index) => ({ ...shot, shotNo: index + 1 }));
  const nextBody = prepareStoryBody(
    { ...body, shots: nextShots },
    getStoryRevision(story.body) + 1,
    story.body
  );

  const timelineItems = [...material.timeline.items].sort(
    (left, right) => left.position - right.position
  );
  const targetTimelineIndex = timelineItems.findIndex(
    item => item.stableShotId === candidate.target.stableShotId
  );
  if (targetTimelineIndex < 0) {
    throw new Error("视频已生成，但目标镜头已经不在时间轴中");
  }
  timelineItems.splice(targetTimelineIndex, 0, {
    stableShotId: candidate.provisionalStableShotId,
    included: true,
    position: targetTimelineIndex,
    plannedDurationMs: candidate.durationSec * 1000,
    transform: { ...DEFAULT_TIMELINE_TRANSFORM },
  });
  const nextTimelineItems = timelineItems.map((item, position) => ({
    ...item,
    position,
  }));
  const saved = await insertTransitionShotAtomic({
    storyId: candidate.storyId,
    userId,
    stableShotId: candidate.provisionalStableShotId,
    expectedStoryRevision: getStoryRevision(story.body),
    expectedTimelineVersion: material.timeline.version,
    nextStoryBody: nextBody,
    nextTimelineItems,
  });
  return {
    storyShots: storyShots(saved.story.body),
    storyRevision: getStoryRevision(saved.story.body),
    timelineVersion: saved.timeline.version,
    applied: saved.applied,
  };
}

async function finishAndApply(params: {
  candidate: TimelineTransitionCandidate;
  take: VideoTake;
  userId: number;
  providerVideoUrl?: string;
}): Promise<ConfirmEditingTransitionResult> {
  let take = params.take;
  const outputName = `take-${take.id}.mp4`;
  const outputPath = path.join(localVideoDir(), outputName);
  if (take.status !== "available" || !take.videoUrl || !take.videoKey) {
    if (!params.providerVideoUrl) {
      return {
        status: "error",
        error: "生成任务没有返回可下载的视频",
        takeId: take.id,
        retryable: Boolean(take.taskId),
      };
    }
    let frames: Awaited<ReturnType<typeof prepareCandidateFrames>> | null = null;
    const savedLastFrame = durableLastFramePath(take.id);
    let lastFramePath = await editingTransitionRuntime.findDurableLastFrame(
      take.id
    );
    if (!lastFramePath) {
      frames = await editingTransitionRuntime.prepareCandidateFrames(
        params.candidate,
        params.userId
      );
      lastFramePath = await editingTransitionRuntime.persistDurableLastFrame(
        take.id,
        frames.lastFrame.path
      );
    }
    const rawPath = path.join(localVideoDir(), `take-${take.id}.vidu-source.mp4`);
    try {
      await downloadVideoToFile(params.providerVideoUrl, rawPath);
      await hardCutToLastFrame({
        generatedVideoPath: rawPath,
        lastFramePath,
        outputPath,
        totalDurationSec: params.candidate.durationSec,
        cutAtSec: params.candidate.cutAtSec,
        size: 720,
        fps: 30,
      });
      const metadata = await probeVideoFileMetadata(outputPath);
      if (
        Math.abs(metadata.width - metadata.height) > 2 ||
        (metadata.durationSec != null &&
          Math.abs(metadata.durationSec - params.candidate.durationSec) > 0.15)
      ) {
        throw new Error("生成结果没有通过 1:1 / 2 秒成片校验");
      }
      take = await patchTake(
        take,
        params.userId,
        {
          status: "available",
          videoKey: outputName,
          videoUrl: `/api/videos/${outputName}`,
          durationSec: metadata.durationSec ?? params.candidate.durationSec,
          aspectRatio: "1:1",
          extractionCapability: "available",
          errorMessage: null,
        },
        {
          providerVideoUrl: params.providerVideoUrl,
          providerSubmissionAccepted: true,
          generationState: "available",
        }
      );
      await Promise.all([
        fs.promises.rm(rawPath, { force: true }),
        fs.promises.rm(savedLastFrame, { force: true }),
      ]).catch(() => undefined);
    } catch (error) {
      take = await patchTake(
        take,
        params.userId,
        { status: "failed", errorMessage: error instanceof Error ? error.message : "视频落盘失败" },
        { generationState: "postprocess_failed" }
      );
      return {
        status: "error",
        error: take.errorMessage ?? "视频落盘失败",
        takeId: take.id,
        retryable: true,
      };
    } finally {
      await frames?.cleanup().catch(() => undefined);
    }
  }

  try {
    const applied = await applyGeneratedTransition(
      params.candidate,
      take,
      params.userId
    );
    await selectVideoTimelineSegment(
      {
        storyId: params.candidate.storyId,
        stableShotId: params.candidate.provisionalStableShotId,
        takeId: take.id,
        selectionType: "full_take",
      },
      params.userId
    );
    take = await patchTake(
      take,
      params.userId,
      { errorMessage: null },
      { appliedToTimeline: true }
    );
    return {
      status: "applied",
      reply: applied.applied
        ? "衔接视频已经生成，并放进两镜之间了。我也替你定位到了新镜头。"
        : "这条衔接已经在两镜之间，我没有重复插入。",
      takeId: take.id,
      insertedStableShotId: params.candidate.provisionalStableShotId,
      storyShots: applied.storyShots,
      storyRevision: applied.storyRevision,
      timelineVersion: applied.timelineVersion,
      videoUrl: take.videoUrl!,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "衔接镜头插入失败";
    await patchTake(take, params.userId, { errorMessage: message }, {
      appliedToTimeline: false,
    });
    return {
      status: "error",
      error: message,
      takeId: take.id,
      retryable: true,
    };
  }
}

async function runConfirmation(
  candidate: TimelineTransitionCandidate,
  userId: number
): Promise<ConfirmEditingTransitionResult> {
  candidate = normalizeCandidate(candidate);
  verifyCandidateShape(candidate);
  const idempotencyKey = `editing-transition:${candidate.candidateId}`;
  let take = await findVideoTakeByIdempotencyKey(
    candidate.storyId,
    userId,
    idempotencyKey
  );

  if (take) {
    // 任务一旦创建，首尾帧与提示词以服务端持久化快照为准，客户端只携带 candidateId。
    candidate = storedCandidateForTake(take, candidate);
  }

  if (!take) {
    candidate = await validateBeforePaidSubmission(candidate, userId);
    const reserved = await createVideoTakeIdempotently({
      storyId: candidate.storyId,
      userId,
      stableShotId: candidate.provisionalStableShotId,
      sourceImageId:
        candidate.source.mediaKind === "image"
          ? candidate.source.imageId
          : null,
      promptCompilationId: null,
      status: "submitted",
      provider: "302",
      model: "viduq2-turbo",
      prompt: candidate.prompt,
      subtitle: candidate.instruction,
      durationSec: candidate.durationSec,
      aspectRatio: "1:1",
      parameterSnapshot: {
        kind: "editing-transition",
        candidate,
        submissionState: "not_started",
        appliedToTimeline: false,
      },
      idempotencyKey,
      extractionCapability: "unavailable",
    });
    take = reserved.take;
    if (!reserved.created) {
      candidate = storedCandidateForTake(take, candidate);
    }
  }

  if (take.status === "available" && take.videoUrl && take.videoKey) {
    return finishAndApply({ candidate, take, userId });
  }
  const snapshot = currentSnapshot(take);
  if (
    !take.taskId &&
    (take.status === "unfollowable" ||
      snapshot.submissionState === "unknown")
  ) {
    return {
      status: "error",
      error:
        take.errorMessage ??
        "302 是否已收单无法确认，为避免重复扣费已禁止自动重提。",
      takeId: take.id,
      retryable: false,
      submissionUnknown: true,
    };
  }

  let taskId = take.taskId;
  if (!taskId) {
    const claim = await claimEditingTransitionSubmission({
      takeId: take.id,
      storyId: candidate.storyId,
      userId,
    });
    take = claim.take;
    if (!claim.claimed) {
      return {
        status: "processing",
        reply:
          claim.reason === "slot_occupied"
            ? "这个镜头位置已有另一条衔接任务在处理。为避免重复扣费，我没有再次提交 302。"
            : "这条衔接已由另一个请求取得提交权。为避免重复扣费，我会继续等待同一任务状态。",
        takeId: take.id,
        taskId: take.taskId ?? undefined,
      };
    }
    let frames: Awaited<ReturnType<typeof prepareCandidateFrames>> | null = null;
    try {
      candidate = await validateBeforePaidSubmission(candidate, userId);
      frames = await editingTransitionRuntime.prepareCandidateFrames(
        candidate,
        userId
      );
      await editingTransitionRuntime.persistDurableLastFrame(
        take.id,
        frames.lastFrame.path
      );
      const [firstImageUrl, lastImageUrl] = await Promise.all([
        uploadFileToVidu(frames.firstFrame),
        uploadFileToVidu(frames.lastFrame),
      ]);
      take = await patchTake(
        take,
        userId,
        { status: "submitted", errorMessage: null },
        {
          submissionState: "submitting",
          uploadedFirstImage: firstImageUrl,
          uploadedLastImage: lastImageUrl,
          durableLastFrameKey: path.basename(durableLastFramePath(take.id)),
        }
      );
      const submitted = await submitViduTransition({
        prompt: candidate.prompt,
        firstImageUrl,
        lastImageUrl,
        durationSec: candidate.durationSec,
        resolution: candidate.resolution,
        movementAmplitude: "auto",
      });
      taskId = submitted.taskId;
      take = await patchTake(
        take,
        userId,
        { status: "processing", taskId, errorMessage: null },
        {
          submissionState: "accepted",
          submitUrl: submitted.submitUrl,
          submittedParameters: submitted.submittedParameters,
          taskId,
        }
      );
    } catch (error) {
      const acceptedWithTaskId = Boolean(taskId);
      const unknown =
        !acceptedWithTaskId &&
        error instanceof ViduSubmissionError &&
        error.submissionState === "unknown";
      take = await patchTake(
        take,
        userId,
        {
          status: acceptedWithTaskId
            ? "processing"
            : unknown
              ? "unfollowable"
              : "failed",
          taskId: taskId ?? null,
          errorMessage:
            error instanceof Error ? error.message : "302 衔接视频提交失败",
        },
        {
          submissionState: acceptedWithTaskId
            ? "accepted"
            : unknown
              ? "unknown"
              : "not_submitted",
          taskId: taskId ?? undefined,
        }
      );
      if (acceptedWithTaskId) {
        return {
          status: "processing",
          reply:
            "302 已返回 taskId，但本次响应链路中断。我已保存同一任务，继续查询不会重复提交。",
          takeId: take.id,
          taskId: taskId!,
        };
      }
      return {
        status: "error",
        error: unknown
          ? `${take.errorMessage}；为避免重复扣费已禁止自动重提。`
          : take.errorMessage ?? "302 衔接视频提交失败",
        takeId: take.id,
        retryable: !unknown,
        submissionUnknown: unknown,
      };
    } finally {
      await frames?.cleanup().catch(() => undefined);
    }
  }

  const refreshed = await waitForViduTransition(taskId);
  if (refreshed.status === "available") {
    return finishAndApply({
      candidate,
      take,
      userId,
      providerVideoUrl: refreshed.videoUrl,
    });
  }
  if (refreshed.status === "timed_out" || refreshed.status === "query_error") {
    take = await patchTake(
      take,
      userId,
      { status: "timeout", errorMessage: refreshed.message },
      { generationState: "processing" }
    );
    return {
      status: "processing",
      reply:
        refreshed.status === "query_error"
          ? "Vidu 任务暂时查询不到结果。我保留了同一个 taskId，继续查询不会重复提交扣费。"
          : "Vidu 还在生成。我保留了同一个任务，下次继续查询，不会重复提交扣费。",
      takeId: take.id,
      taskId,
    };
  }
  take = await patchTake(
    take,
    userId,
    { status: "failed", errorMessage: refreshed.message },
    { generationState: refreshed.status }
  );
  return {
    status: "error",
    error: take.errorMessage ?? "Vidu 视频生成失败",
    takeId: take.id,
    retryable: false,
  };
}

/**
 * 用户点下确认后的唯一付费入口。同一 candidate 在同一进程内共享同一个 Promise，
 * 持久层再用 videoTake.idempotencyKey 续查同一 task，双层避免重复扣费。
 */
export function confirmEditingTransition(
  candidate: TimelineTransitionCandidate,
  userId: number
): Promise<ConfirmEditingTransitionResult> {
  const lockKey = `${userId}:${candidate.storyId}:${candidate.candidateId}`;
  const active = activeConfirmations.get(lockKey);
  if (active) return active;
  const promise = runConfirmation(candidate, userId).finally(() => {
    if (activeConfirmations.get(lockKey) === promise) {
      activeConfirmations.delete(lockKey);
    }
  });
  activeConfirmations.set(lockKey, promise);
  return promise;
}
