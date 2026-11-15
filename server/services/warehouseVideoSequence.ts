import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { VideoTake } from "../../drizzle/schema";
import {
  warehouseVideoSequenceInput,
  warehouseSequencePairs,
  type WarehouseVideoSequenceInput,
} from "../../shared/warehouseVideoSequence";
import { estimateViduQ2TransitionCny } from "../../shared/videoRenderCost";
import { withVideoVisualFidelity } from "../../shared/videoMotionPolicy";
import { fromYuan } from "../../shared/computeMoney";
import {
  getVideoTakeById,
  findVideoTakeByIdempotencyKey,
  createVideoTakeIdempotently,
  updateVideoTake,
} from "../repositories/videos";
import { getStoryById } from "../repositories/stories";
import { getStoryImageAssets, materializeImageInput } from "./imageAssets";
import {
  mediaBillingEnabled,
  mediaOperationId,
  reserveMedia,
  recordMediaResult,
  recoverVideoReceipt,
} from "./mediaComputeBilling";
import { settleOperation } from "./computeLedger";
import { buildRenderSnapshot } from "./render/snapshot";
import { submitRender, renderRefusalReason } from "./render/submitRender";
import { uploadFileToVidu } from "./videoTransition302";
import { refreshStartEndShotVideoTake } from "./startEndShotVideoWorkflow";
import { localVideoDir } from "./videoMedia";
import { probeVideoFileMetadata } from "./videoConform";
import { ENV } from "../_core/env";

const runFile = promisify(execFile);
const record = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const isWarehouseVideoSequence = (take: VideoTake) =>
  record(take.parameterSnapshot).kind === "warehouse-image-sequence";

async function readFrame(url: string, userId: number) {
  const input = await materializeImageInput(url, userId);
  const match = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)$/i.exec(
    input,
  );
  if (!match) throw new Error("请先把所选图片导入本地仓库，再生成连续视频。");
  const bytes = Buffer.from(match[1], "base64");
  if (!bytes.length || bytes.length > 15 * 1024 * 1024)
    throw new Error("图片为空或超过15MB");
  const meta = await sharp(bytes).metadata();
  if (
    !meta.width ||
    !meta.height ||
    meta.width !== meta.height ||
    meta.width > 4096
  )
    throw new Error(
      "当前连续视频支持方形图片；请先确认画幅，系统不会自动裁掉画面。",
    );
  const png = await sharp(bytes).rotate().png().toBuffer();
  if (png.length >= 10 * 1024 * 1024)
    throw new Error("图片转为PNG后超过10MB，请先缩小图片。");
  return { bytes, meta, png };
}

async function prepareSequence(
  raw: WarehouseVideoSequenceInput,
  userId: number,
) {
  const input = warehouseVideoSequenceInput.parse(raw);
  const story = await getStoryById(input.storyId, userId);
  if (!story) throw new Error("故事不存在或无权操作");
  const shots = record(story.body).shots;
  const shot =
    Array.isArray(shots) &&
    shots.find(
      (s) => (s.stableShotId ?? s.shotIdentity) === input.stableShotId,
    );
  if (!shot) throw new Error("目标镜头已不存在，请重新选择");
  const assets = await getStoryImageAssets(input.storyId, userId);
  const frames: Buffer[] = [];
  const images = await Promise.all(
    input.imageIds.map(async (id, index) => {
      const image = assets.find((a) => a.id === id);
      if (
        !image ||
        image.availability === "missing" ||
        image.status === "rejected"
      )
        throw new Error(`图片 #${id} 不可用，请重新选择`);
      const { bytes, meta, png } = await readFrame(image.imageUrl, userId);
      frames[index] = png;
      return {
        id,
        imageUrl: image.imageUrl,
        width: meta.width!,
        height: meta.height!,
        checksum: createHash("sha256").update(bytes).digest("hex"),
      };
    }),
  );
  const segmentCny = estimateViduQ2TransitionCny({
    durationSec: input.segmentSeconds,
    resolution: "720p",
    uploadCount: 2,
  }).estimatedCny;
  const prompts = warehouseSequencePairs(input.imageIds).map((_, index) =>
    withVideoVisualFidelity(
      `${input.prompt}\n连续镜头第${index + 1}段，共${input.imageIds.length - 1}段。以两张输入图为准确起止画面，衔接平稳。`,
    ),
  );
  for (const prompt of prompts) {
    const refusal = renderRefusalReason("video.vidu-q2-turbo-start-end", {
      spec: { prompt },
    });
    if (refusal) throw new Error(refusal);
  }
  const quote = {
    input,
    images,
    shotNo: Number(shot.shotNo),
    segmentCny,
    totalCny: Number((segmentCny * (images.length - 1)).toFixed(2)),
    totalSeconds: input.segmentSeconds * (images.length - 1),
    fingerprint: hash({
      input,
      images: images.map((i) => [i.id, i.checksum]),
      segmentCny,
      model: "viduq2-turbo",
      version: 1,
    }),
  };
  return { quote, frames, prompts };
}

export async function quoteWarehouseVideoSequence(
  input: WarehouseVideoSequenceInput,
  userId: number,
) {
  return (await prepareSequence(input, userId)).quote;
}
const sequenceKey = (userId: number, storyId: number, requestId: string) =>
  `warehouse-sequence:${hash([userId, storyId, requestId])}`;
export async function findWarehouseVideoSequence(
  storyId: number,
  requestId: string,
  userId: number,
) {
  return findVideoTakeByIdempotencyKey(
    storyId,
    userId,
    sequenceKey(userId, storyId, requestId),
  );
}

async function patch(
  take: VideoTake,
  fields: Parameters<typeof updateVideoTake>[2],
  metadata: Record<string, unknown> = {},
) {
  const result = await updateVideoTake(take.id, take.userId, {
    ...fields,
    parameterSnapshot: { ...record(take.parameterSnapshot), ...metadata },
  });
  if (!result) throw new Error("视频任务记录保存失败");
  return result;
}

/** One confirmed sequence, one durable parent. A repeated request only returns its receipt. */
export async function submitWarehouseVideoSequence(
  input: WarehouseVideoSequenceInput & {
    requestId: string;
    fingerprint: string;
    confirmedCny: number;
  },
  userId: number,
) {
  const existing = await findWarehouseVideoSequence(
    input.storyId,
    input.requestId,
    userId,
  );
  if (existing) {
    if (record(existing.parameterSnapshot).fingerprint !== input.fingerprint)
      throw new Error("请求内容已改变，请查看原任务");
    return existing;
  }
  const { quote, frames, prompts } = await prepareSequence(input, userId);
  await runFile(process.env.FFMPEG_PATH ?? "ffmpeg", ["-version"], {
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  });
  if (
    quote.fingerprint !== input.fingerprint ||
    Math.abs(quote.totalCny - input.confirmedCny) > 0.001
  )
    throw new Error("图片、顺序或报价已变化，请重新确认");
  const key = sequenceKey(userId, input.storyId, input.requestId);
  const common = {
    storyId: input.storyId,
    userId,
    stableShotId: input.stableShotId,
    promptCompilationId: null,
    status: "submitted" as const,
    taskId: null,
    provider: "302",
    model: "viduq2-turbo",
    subtitle: null,
    aspectRatio: "1:1",
    videoKey: null,
    videoUrl: null,
    errorMessage: null,
    extractionCapability: "unavailable" as const,
  };
  const parent = await createVideoTakeIdempotently({
    ...common,
    sourceImageId: input.imageIds[0],
    prompt: input.prompt,
    durationSec: quote.totalSeconds,
    idempotencyKey: key,
    parameterSnapshot: {
      kind: "warehouse-image-sequence",
      requestId: input.requestId,
      fingerprint: quote.fingerprint,
      stableShotId: input.stableShotId,
      frameSnapshots: quote.images.map(({ id, width, height, checksum }) => ({
        id,
        width,
        height,
        checksum,
      })),
      imageIds: input.imageIds,
      segmentSeconds: input.segmentSeconds,
      estimatedCny: quote.totalCny,
      childTakeIds: [],
      submissionState: "submitting",
      appliedToTimeline: false,
    },
  });
  if (!parent.created) {
    if (record(parent.take.parameterSnapshot).fingerprint !== quote.fingerprint)
      throw new Error("同一次请求的内容已改变，请重新查看原任务");
    return parent.take;
  }
  let take = parent.take;
  const children: VideoTake[] = [];
  try {
    // Reserve all segments before uploads. Insufficient credit cannot start a partial purchase.
    for (const [index, pair] of warehouseSequencePairs(
      input.imageIds,
    ).entries()) {
      const childKey = `${key}:${index}`;
      const operationId = mediaBillingEnabled()
        ? mediaOperationId("video", userId, childKey)
        : null;
      const child = await createVideoTakeIdempotently({
        ...common,
        sourceImageId: pair[0],
        durationSec: input.segmentSeconds,
        prompt: prompts[index],
        idempotencyKey: childKey,
        parameterSnapshot: {
          kind: "shot-start-end",
          stableShotId: input.stableShotId,
          sequenceParentTakeId: take.id,
          firstFrameImageId: pair[0],
          lastFrameImageId: pair[1],
          durationSec: input.segmentSeconds,
          resolution: "720p",
          movementAmplitude: "auto",
          submissionState: "not_started",
          estimatedCny: quote.segmentCny,
          computeOperationId: operationId,
          renderProfile: buildRenderSnapshot("video.vidu-q2-turbo-start-end", {
            baseUrl: ENV.api302BaseUrl || "https://api.302.ai",
            quoteInput: {
              durationSec: input.segmentSeconds,
              resolution: "720p",
            },
          }),
        },
      });
      if (!child.created) throw new Error("分段任务已经存在，停止重复提交");
      children.push(child.take);
      take = await patch(take, {}, { childTakeIds: children.map((c) => c.id) });
      if (operationId) {
        const reservation = await reserveMedia({
          operationId,
          userId,
          storyId: input.storyId,
          maxCostMinor: fromYuan(quote.segmentCny),
          requestHash: childKey,
        });
        if (reservation.outcome !== "reserved")
          throw new Error("分段费用已预占，请核对原任务");
      }
    }
    for (let index = 0; index < children.length; index++) {
      let child = children[index];
      // Persist the uncertainty boundary before any upload/provider call.
      child = await patch(child, {}, { submissionState: "submitting" });
      children[index] = child;
      const urls: string[] = [];
      for (const bytes of frames.slice(index, index + 2)) {
        urls.push(await uploadFileToVidu({ bytes, contentType: "image/png" }));
      }
      const submitted = await submitRender("video.vidu-q2-turbo-start-end", {
        spec: {
          prompt: child.prompt,
          firstImageUrl: urls[0],
          lastImageUrl: urls[1],
          durationSec: input.segmentSeconds,
          resolution: "720p",
          movementAmplitude: "auto",
        },
      });
      // Keep the provider receipt in memory before any persistence can fail.
      children[index] = { ...child, taskId: submitted.taskId };
      child = await patch(
        children[index],
        { status: "processing", taskId: submitted.taskId },
        {
          submissionState: "accepted",
          submitUrl: submitted.submitUrl,
          submittedParameters: submitted.submittedParameters,
        },
      );
      children[index] = child;
      const operationId = record(child.parameterSnapshot).computeOperationId;
      if (operationId)
        await recordMediaResult(operationId, "302", {
          taskId: submitted.taskId,
          takeId: child.id,
        });
    }
    return await patch(
      take,
      { status: "processing" },
      { submissionState: "accepted" },
    );
  } catch (error) {
    for (const child of children) {
      const state = record(child.parameterSnapshot).submissionState;
      if (child.taskId) {
        // Best effort recovery if saving the receipt or ledger was interrupted.
        const operationId = record(child.parameterSnapshot).computeOperationId;
        if (operationId)
          await recordMediaResult(operationId, "302", {
            taskId: child.taskId,
            takeId: child.id,
          }).catch(() => undefined);
        await patch(
          child,
          { status: "processing", taskId: child.taskId },
          { submissionState: "accepted" },
        ).catch(() => undefined);
        continue;
      }
      const unknown = state === "submitting";
      const operationId = record(child.parameterSnapshot).computeOperationId;
      if (operationId)
        await settleOperation({
          operationId,
          outcome: {
            kind: unknown ? "submission_unknown" : "not_charged_failure",
          },
        }).catch(() => undefined);
      await patch(
        child,
        {
          status: unknown ? "unfollowable" : "failed",
          errorMessage: unknown ? "提交结果待核对，不自动重试" : "尚未提交",
        },
        { submissionState: unknown ? "unknown" : "not_submitted" },
      ).catch(() => undefined);
    }
    return await patch(
      take,
      {
        status: "unfollowable",
        errorMessage: `${error instanceof Error ? error.message : "生成未完成"}；已提交的分段保留，没有自动重试。`,
      },
      { submissionState: "incomplete" },
    );
  }
}

const assembling = new Map<
  number,
  Promise<{ status: "ok"; take: VideoTake }>
>();
export async function refreshWarehouseVideoSequence(
  take: VideoTake,
  userId: number,
): Promise<{ status: "ok"; take: VideoTake }> {
  if (take.userId !== userId) throw new Error("无权读取视频");
  if (take.status === "available" || take.status === "failed")
    return { status: "ok", take };
  const state = record(take.parameterSnapshot).submissionState;
  if (state === "submitting") {
    if (Date.now() - new Date(take.createdAt).getTime() < 10 * 60_000)
      return { status: "ok", take };
    take = await patch(
      take,
      {
        status: "unfollowable",
        errorMessage: "提交中断，已保存的分段可继续核对；不会自动重新购买。",
      },
      { submissionState: "incomplete" },
    );
  }
  if (assembling.has(take.id)) return assembling.get(take.id)!;
  const work = assemble(take, userId);
  assembling.set(take.id, work);
  try {
    return await work;
  } finally {
    assembling.delete(take.id);
  }
}
async function assemble(
  take: VideoTake,
  userId: number,
): Promise<{ status: "ok"; take: VideoTake }> {
  const snapshot = record(take.parameterSnapshot);
  const ids = Array.isArray(snapshot.childTakeIds)
    ? (snapshot.childTakeIds as number[])
    : [];
  let complete =
    snapshot.submissionState === "accepted" &&
    Array.isArray(snapshot.imageIds) &&
    ids.length === snapshot.imageIds.length - 1;
  const children: VideoTake[] = [];
  for (const id of ids) {
    let child = await getVideoTakeById(id, userId);
    if (
      !child ||
      child.storyId !== take.storyId ||
      record(child.parameterSnapshot).sequenceParentTakeId !== take.id
    )
      throw new Error("分段记录不属于当前视频");
    child = await recoverVideoReceipt(child);
    const refreshed =
      child.status === "available" ||
      child.status === "failed" ||
      (!child.taskId && child.status === "unfollowable")
        ? { status: "ok" as const, take: child }
        : await refreshStartEndShotVideoTake(child, userId);
    if (refreshed.status !== "ok") return { status: "ok", take };

    children.push(refreshed.take);
  }
  if (
    !complete &&
    Array.isArray(snapshot.imageIds) &&
    children.length === snapshot.imageIds.length - 1 &&
    children.every((child) => Boolean(child.taskId))
  ) {
    take = await patch(
      take,
      { status: "processing", errorMessage: null },
      { submissionState: "accepted" },
    );
    complete = true;
  }
  if (!complete) return { status: "ok", take };
  if (
    children.some((child) => ["failed", "unfollowable"].includes(child.status))
  )
    return {
      status: "ok",
      take: await patch(take, {
        status: "failed",
        errorMessage: "部分分段未完成；已生成素材保留，请核对原任务。",
      }),
    };
  if (children.some((child) => child.status !== "available"))
    return { status: "ok", take };
  const output = path.join(localVideoDir(), `take-${take.id}.mp4`);
  const temporary = path.join(
    localVideoDir(),
    `take-${take.id}-${randomUUID()}.mp4`,
  );
  try {
    const paths = children.map((child) => {
      const key = child.videoKey;
      if (!key || path.basename(key) !== key) throw new Error("分段文件不可用");
      return path.join(localVideoDir(), key);
    });
    await fs.mkdir(localVideoDir(), { recursive: true });
    const filter =
      paths
        .map((_, i) => `[${i}:v]fps=30,setsar=1,setpts=PTS-STARTPTS[v${i}]`)
        .join(";") +
      ";" +
      paths.map((_, i) => `[v${i}]`).join("") +
      `concat=n=${paths.length}:v=1:a=0[out]`;
    await runFile(
      process.env.FFMPEG_PATH ?? "ffmpeg",
      [
        "-y",
        ...paths.flatMap((file) => ["-i", file]),
        "-filter_complex",
        filter,
        "-map",
        "[out]",
        "-an",
        "-c:v",
        "libx264",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        temporary,
      ],
      { timeout: 180000, maxBuffer: 1024 * 1024 },
    );
    const meta = await probeVideoFileMetadata(temporary);
    const expected = children.reduce((n, c) => n + (c.durationSec ?? 0), 0);
    if (!meta.durationSec || Math.abs(meta.durationSec - expected) > 0.15)
      throw new Error("合成时长与分段不符");
    await fs.rename(temporary, output);
    return {
      status: "ok",
      take: await patch(
        take,
        {
          status: "available",
          videoKey: path.basename(output),
          videoUrl: `/api/videos/${path.basename(output)}`,
          durationSec: meta.durationSec,
          extractionCapability: "available",
          errorMessage: null,
        },
        {
          appliedToTimeline: false,
          sourceWidth: meta.width,
          sourceHeight: meta.height,
        },
      ),
    };
  } catch (error) {
    return {
      status: "ok",
      take: await patch(
        take,
        {
          status: "failed",
          errorMessage: `分段已保留，合成失败：${error instanceof Error ? error.message : "未知错误"}`,
        },
        { assemblyFailed: true },
      ),
    };
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
