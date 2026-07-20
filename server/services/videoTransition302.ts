import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ENV } from "../_core/env";

type Fetcher = typeof fetch;

const UPLOAD_PATH = "/302/upload-file";
const VIDU_UPLOAD_CREATE_PATH = "/vidu/tools/v2/files/uploads";
const VIDU_UPLOAD_FINISH_PATH =
  "/vidu/tools/v2/files/uploads/{resourceId}/finish";
const VIDU_SUBMIT_PATH = "/vidu/ent/v2/start-end2video";
const VIDU_FETCH_PATH = "/vidu/ent/v2/tasks/{taskId}/creations";

export type ViduQ2Resolution = "540p" | "720p" | "1080p";

export type ViduTransitionSpec = {
  prompt: string;
  firstImageUrl: string;
  lastImageUrl: string;
  durationSec: number;
  resolution: ViduQ2Resolution;
  model?: "viduq2-turbo";
  movementAmplitude?: "auto" | "small" | "medium" | "large";
};

export type ViduTransitionRefreshResult =
  | { status: "available"; taskId: string; videoUrl: string }
  | { status: "processing"; taskId: string }
  | {
      status: "retryable";
      taskId: string;
      message: string;
      providerCode?: string;
    }
  | {
      status: "task_failed";
      taskId: string;
      message: string;
      providerCode?: string;
    }
  | {
      status: "query_error";
      taskId: string;
      message: string;
      providerCode?: string;
    }
  | { status: "timed_out"; taskId: string; message: string };

export type ViduTransitionCostEstimate = {
  credits: number;
  videoPtc: number;
  uploadPtc: number;
  totalPtc: number;
};

export type ViduTransitionCnyEstimate = {
  currency: "CNY";
  estimatedCny: number;
};

export type ViduSubmissionState = "not_submitted" | "unknown";

export class ViduSubmissionError extends Error {
  readonly submissionState: ViduSubmissionState;

  constructor(message: string, submissionState: ViduSubmissionState) {
    super(message);
    this.name = "ViduSubmissionError";
    this.submissionState = submissionState;
  }
}

function normalizedBaseUrl() {
  return (ENV.api302BaseUrl || "https://api.302.ai").replace(/\/+$/, "");
}

function endpoint(pathname: string) {
  return new URL(pathname.replace(/^\/+/, ""), `${normalizedBaseUrl()}/`);
}

function bearerHeaders(contentType?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${ENV.api302Key}`,
  };
  if (contentType) headers["Content-Type"] = contentType;
  return headers;
}

function requireApiKey() {
  if (!ENV.api302Key) {
    throw new Error("API302_KEY 未配置，无法调用 302 视频接口");
  }
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function failureMessage(value: unknown, fallback: string) {
  const record = jsonRecord(value);
  for (const key of ["message", "description", "err_msg", "error"]) {
    const message = record[key];
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return fallback;
}

function providerCode(value: unknown) {
  const code = jsonRecord(value).err_code;
  if (typeof code === "string" || typeof code === "number") {
    const normalized = String(code).trim();
    return normalized || undefined;
  }
  return undefined;
}

function requestDeadline(timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

function temporarySiblingPath(outputPath: string) {
  const extension = path.extname(outputPath) || ".tmp";
  const stem = path.basename(outputPath, path.extname(outputPath));
  return path.join(
    path.dirname(outputPath),
    `.${stem}.${process.pid}.${randomUUID()}.part${extension}`
  );
}

function rounded(value: number) {
  return Number(value.toFixed(3));
}

function q2TurboCredits(durationSec: number, resolution: ViduQ2Resolution) {
  if (!Number.isInteger(durationSec) || durationSec < 1 || durationSec > 8) {
    throw new Error("viduq2-turbo 时长必须是 1 到 8 秒的整数");
  }
  if (resolution === "540p") return 4 + durationSec * 2;
  if (resolution === "720p") {
    return durationSec === 1 ? 8 : (durationSec - 1) * 10;
  }
  return 25 + durationSec * 10;
}

export function estimateViduQ2TransitionCost(input: {
  durationSec: number;
  resolution: ViduQ2Resolution;
  uploadCount?: number;
}): ViduTransitionCostEstimate {
  const credits = q2TurboCredits(input.durationSec, input.resolution);
  const videoPtc = credits * 0.005;
  const uploadPtc = (input.uploadCount ?? 2) * 0.001;
  return {
    credits,
    videoPtc: rounded(videoPtc),
    uploadPtc: rounded(uploadPtc),
    totalPtc: rounded(videoPtc + uploadPtc),
  };
}

/**
 * 与现有已确认的 2 秒 720p 双图报价 ¥0.35 保持同一人民币换算基线。
 * 向上取分，避免界面确认金额低于提交时的服务端估算。
 */
export function estimateViduQ2TransitionCny(input: {
  durationSec: number;
  resolution: ViduQ2Resolution;
  uploadCount?: number;
}): ViduTransitionCnyEstimate {
  const estimate = estimateViduQ2TransitionCost(input);
  const referencePtc = 0.052;
  const referenceCny = 0.35;
  return {
    currency: "CNY",
    estimatedCny:
      Math.ceil((estimate.totalPtc * referenceCny * 100) / referencePtc) / 100,
  };
}

export function buildViduTransitionBody(input: ViduTransitionSpec) {
  q2TurboCredits(input.durationSec, input.resolution);
  if (!input.firstImageUrl.trim() || !input.lastImageUrl.trim()) {
    throw new Error("首帧和尾帧 URL 都不能为空");
  }
  const prompt = input.prompt.trim();
  if (prompt.length > 5_000) {
    throw new Error("Vidu 提示词不能超过 5000 个字符");
  }
  return {
    model: input.model ?? "viduq2-turbo",
    images: [input.firstImageUrl, input.lastImageUrl],
    prompt,
    duration: input.durationSec,
    resolution: input.resolution,
    movement_amplitude: input.movementAmplitude ?? "auto",
  };
}

export function viduSubmissionStateForHttpStatus(
  status: number
): ViduSubmissionState {
  return status === 408 || status === 429 || status >= 500
    ? "unknown"
    : "not_submitted";
}

export async function uploadFileTo302(
  input: { fileName: string; bytes: Uint8Array; contentType: string },
  options: { fetcher?: Fetcher; timeoutMs?: number } = {}
) {
  requireApiKey();
  const fetcher = (options.fetcher ?? globalThis.fetch) as Fetcher;
  const copy = new Uint8Array(input.bytes.byteLength);
  copy.set(input.bytes);
  const form = new FormData();
  form.append(
    "file",
    new Blob([copy.buffer as ArrayBuffer], { type: input.contentType }),
    input.fileName
  );
  const deadline = requestDeadline(options.timeoutMs ?? 30_000);
  try {
    const response = await fetcher(endpoint(UPLOAD_PATH).toString(), {
      method: "POST",
      headers: bearerHeaders(),
      body: form,
      signal: deadline.signal,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        failureMessage(json, `302 图片上传失败 HTTP ${response.status}`)
      );
    }
    const url = jsonRecord(json).data;
    if (typeof url !== "string" || !url.trim()) {
      throw new Error("302 图片上传成功，但没有返回可用 URL");
    }
    return url.trim();
  } finally {
    deadline.clear();
  }
}

function uploadRecord(value: unknown) {
  const record = jsonRecord(value);
  return record.data && typeof record.data === "object"
    ? jsonRecord(record.data)
    : record;
}

export async function uploadFileToVidu(
  input: { bytes: Uint8Array; contentType: string },
  options: { fetcher?: Fetcher; timeoutMs?: number } = {}
) {
  requireApiKey();
  if (
    input.bytes.byteLength <= 0 ||
    input.bytes.byteLength >= 10 * 1024 * 1024
  ) {
    throw new Error("Vidu 上传图片必须大于 0 且小于 10MB");
  }
  if (!["image/png", "image/jpeg", "image/webp"].includes(input.contentType)) {
    throw new Error("Vidu 上传只支持 PNG、JPEG 或 WEBP");
  }

  const fetcher = (options.fetcher ?? globalThis.fetch) as Fetcher;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const createDeadline = requestDeadline(timeoutMs);
  let createResponse: Response;
  let createJson: unknown;
  try {
    createResponse = await fetcher(
      endpoint(VIDU_UPLOAD_CREATE_PATH).toString(),
      {
        method: "POST",
        headers: bearerHeaders("application/json"),
        body: JSON.stringify({ scene: "vidu" }),
        signal: createDeadline.signal,
      }
    );
    createJson = await createResponse.json().catch(() => ({}));
  } finally {
    createDeadline.clear();
  }
  if (!createResponse.ok) {
    throw new Error(
      failureMessage(
        createJson,
        `Vidu 创建图片上传会话失败 HTTP ${createResponse.status}`
      )
    );
  }

  const session = uploadRecord(createJson);
  const resourceId =
    typeof session.id === "string" || typeof session.id === "number"
      ? String(session.id).trim()
      : "";
  const putUrl =
    typeof session.put_url === "string" ? session.put_url.trim() : "";
  if (!resourceId || !putUrl) {
    throw new Error("Vidu 创建图片上传会话成功，但缺少 id 或 put_url");
  }
  let parsedPutUrl: URL;
  try {
    parsedPutUrl = new URL(putUrl);
  } catch {
    throw new Error("Vidu 返回了无效的图片上传地址");
  }
  if (parsedPutUrl.protocol !== "https:") {
    throw new Error("Vidu 图片上传地址必须使用 HTTPS");
  }

  const uploadDeadline = requestDeadline(timeoutMs);
  let uploadResponse: Response;
  try {
    const copy = new Uint8Array(input.bytes.byteLength);
    copy.set(input.bytes);
    uploadResponse = await fetcher(putUrl, {
      method: "PUT",
      headers: { "Content-Type": input.contentType },
      body: copy,
      signal: uploadDeadline.signal,
    });
  } finally {
    uploadDeadline.clear();
  }
  if (!uploadResponse.ok) {
    throw new Error(`Vidu 图片二进制上传失败 HTTP ${uploadResponse.status}`);
  }
  const etag = uploadResponse.headers.get("etag")?.trim() ?? "";
  if (!etag) throw new Error("Vidu 图片上传成功，但响应缺少 ETag");

  const finishDeadline = requestDeadline(timeoutMs);
  let finishResponse: Response;
  let finishJson: unknown;
  try {
    finishResponse = await fetcher(
      endpoint(
        VIDU_UPLOAD_FINISH_PATH.replace(
          "{resourceId}",
          encodeURIComponent(resourceId)
        )
      ).toString(),
      {
        method: "PUT",
        headers: bearerHeaders("application/json"),
        body: JSON.stringify({ etag }),
        signal: finishDeadline.signal,
      }
    );
    finishJson = await finishResponse.json().catch(() => ({}));
  } finally {
    finishDeadline.clear();
  }
  if (!finishResponse.ok) {
    throw new Error(
      failureMessage(
        finishJson,
        `Vidu 完成图片上传失败 HTTP ${finishResponse.status}`
      )
    );
  }
  const uri = uploadRecord(finishJson).uri;
  let parsedUri: URL | undefined;
  try {
    parsedUri = typeof uri === "string" ? new URL(uri.trim()) : undefined;
  } catch {
    parsedUri = undefined;
  }
  if (
    !parsedUri ||
    parsedUri.protocol !== "ssupload:" ||
    !parsedUri.searchParams.get("id")?.trim()
  ) {
    throw new Error("Vidu 完成图片上传成功，但没有返回 ssupload URI");
  }
  return String(uri).trim();
}

export async function submitViduTransition(
  input: ViduTransitionSpec,
  options: { fetcher?: Fetcher; timeoutMs?: number } = {}
) {
  requireApiKey();
  const fetcher = (options.fetcher ?? globalThis.fetch) as Fetcher;
  const body = buildViduTransitionBody(input);
  let response: Response;
  let json: unknown;
  const deadline = requestDeadline(options.timeoutMs ?? 45_000);
  try {
    response = await fetcher(endpoint(VIDU_SUBMIT_PATH).toString(), {
      method: "POST",
      headers: bearerHeaders("application/json"),
      body: JSON.stringify(body),
      signal: deadline.signal,
    });
    json = await response.json();
  } catch (error) {
    throw new ViduSubmissionError(
      error instanceof Error ? error.message : "Vidu 提交请求失败",
      "unknown"
    );
  } finally {
    deadline.clear();
  }
  if (!response.ok) {
    throw new ViduSubmissionError(
      failureMessage(json, `Vidu 提交失败 HTTP ${response.status}`),
      viduSubmissionStateForHttpStatus(response.status)
    );
  }
  const taskId = jsonRecord(json).task_id;
  const normalizedTaskId =
    typeof taskId === "string" || typeof taskId === "number"
      ? String(taskId).trim()
      : "";
  if (!normalizedTaskId) {
    throw new ViduSubmissionError(
      "Vidu 已响应但没有返回 task_id，为避免重复扣费已禁止自动重提",
      "unknown"
    );
  }
  return {
    taskId: normalizedTaskId,
    submitUrl: endpoint(VIDU_SUBMIT_PATH).toString(),
    submittedParameters: body,
  };
}

export async function refreshViduTransition(
  taskId: string,
  options: { fetcher?: Fetcher; timeoutMs?: number } = {}
): Promise<ViduTransitionRefreshResult> {
  requireApiKey();
  const fetcher = (options.fetcher ?? globalThis.fetch) as Fetcher;
  const url = endpoint(
    VIDU_FETCH_PATH.replace("{taskId}", encodeURIComponent(taskId))
  );
  const deadline = requestDeadline(options.timeoutMs ?? 20_000);
  let response: Response;
  let json: unknown;
  try {
    response = await fetcher(url.toString(), {
      method: "GET",
      headers: bearerHeaders(),
      signal: deadline.signal,
    });
    json = await response.json();
  } catch (error) {
    return {
      status: "retryable",
      taskId,
      message: error instanceof Error ? error.message : "Vidu 任务查询请求失败",
    };
  } finally {
    deadline.clear();
  }
  if (!response.ok) {
    const retryable =
      response.status === 408 ||
      response.status === 429 ||
      response.status >= 500;
    return {
      status: retryable ? "retryable" : "query_error",
      taskId,
      message: failureMessage(
        json,
        `Vidu 任务查询失败 HTTP ${response.status}`
      ),
      providerCode: providerCode(json),
    };
  }
  const record = jsonRecord(json);
  const creations = Array.isArray(record.creations) ? record.creations : [];
  for (const creation of creations) {
    const videoUrl = jsonRecord(creation).url;
    if (typeof videoUrl === "string" && videoUrl.trim()) {
      return { status: "available", taskId, videoUrl: videoUrl.trim() };
    }
  }
  const state =
    typeof record.state === "string" ? record.state.toLowerCase() : "";
  if (["failed", "failure", "error", "cancelled", "canceled"].includes(state)) {
    return {
      status: "task_failed",
      taskId,
      message: failureMessage(json, "Vidu 视频生成失败"),
      providerCode: providerCode(json),
    };
  }
  if (state === "success") {
    return {
      status: "query_error",
      taskId,
      message: "Vidu 任务显示成功，但没有返回视频 URL",
      providerCode: providerCode(json),
    };
  }
  return { status: "processing", taskId };
}

export async function waitForViduTransition(
  taskId: string,
  options: {
    fetcher?: Fetcher;
    pollMs?: number;
    timeoutMs?: number;
    requestTimeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {}
) {
  const startedAt = Date.now();
  const pollMs = options.pollMs ?? 3_000;
  const timeoutMs = options.timeoutMs ?? 300_000;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise(resolve => setTimeout(resolve, ms)));
  while (Date.now() - startedAt < timeoutMs) {
    const result = await refreshViduTransition(taskId, {
      fetcher: options.fetcher,
      timeoutMs: options.requestTimeoutMs,
    });
    if (result.status !== "processing" && result.status !== "retryable") {
      return result;
    }
    await sleep(pollMs);
  }
  return {
    status: "timed_out" as const,
    taskId,
    message: "Vidu 视频生成等待超时；任务可能仍在运行，禁止自动重提",
  };
}

export async function downloadVideoToFile(
  videoUrl: string,
  outputPath: string,
  options: {
    fetcher?: Fetcher;
    timeoutMs?: number;
    maxBytes?: number;
  } = {}
) {
  const fetcher = (options.fetcher ?? globalThis.fetch) as Fetcher;
  const maxBytes = options.maxBytes ?? 200 * 1024 * 1024;
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = temporarySiblingPath(outputPath);
  const deadline = requestDeadline(options.timeoutMs ?? 120_000);
  let handle: fs.promises.FileHandle | undefined;
  try {
    const response = await fetcher(videoUrl, { signal: deadline.signal });
    if (!response.ok) {
      throw new Error(`生成视频下载失败 HTTP ${response.status}`);
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error("生成视频超过 200MB");
    }
    if (!response.body) throw new Error("生成视频响应为空");

    handle = await fs.promises.open(temporaryPath, "wx");
    const reader = response.body.getReader();
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("生成视频超过大小限制");
        throw new Error("生成视频超过 200MB");
      }
      let writtenBytes = 0;
      while (writtenBytes < value.byteLength) {
        const { bytesWritten } = await handle.write(
          value.subarray(writtenBytes)
        );
        if (bytesWritten <= 0) {
          throw new Error("生成视频写入临时文件失败");
        }
        writtenBytes += bytesWritten;
      }
    }
    if (totalBytes === 0) throw new Error("生成视频响应为空");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.promises.rename(temporaryPath, outputPath);
    return outputPath;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await fs.promises.rm(temporaryPath, { force: true });
    throw error;
  } finally {
    deadline.clear();
  }
}

function numberArg(value: number) {
  return String(Number(value.toFixed(3)));
}

export function buildHardCutArgs(input: {
  generatedVideoPath: string;
  lastFramePath: string;
  outputPath: string;
  totalDurationSec: number;
  cutAtSec: number;
  size?: number;
  fps?: number;
}) {
  if (
    !Number.isFinite(input.cutAtSec) ||
    input.cutAtSec <= 0 ||
    input.cutAtSec >= input.totalDurationSec
  ) {
    throw new Error("硬切时间必须大于 0 且小于总时长");
  }
  const size = input.size ?? 720;
  const fps = input.fps ?? 30;
  const holdSec = input.totalDurationSec - input.cutAtSec;
  const filter = [
    `[0:v]trim=duration=${numberArg(input.cutAtSec)},setpts=PTS-STARTPTS,scale=${size}:${size}:force_original_aspect_ratio=increase,crop=${size}:${size},fps=${fps},format=yuv420p[v0]`,
    `[1:v]trim=duration=${numberArg(holdSec)},setpts=PTS-STARTPTS,scale=${size}:${size}:force_original_aspect_ratio=decrease,pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${fps},format=yuv420p[v1]`,
    "[v0][v1]concat=n=2:v=1:a=0[outv]",
  ].join(";");
  return [
    "-y",
    "-i",
    input.generatedVideoPath,
    "-loop",
    "1",
    "-framerate",
    String(fps),
    "-i",
    input.lastFramePath,
    "-filter_complex",
    filter,
    "-map",
    "[outv]",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "18",
    "-movflags",
    "+faststart",
    "-frames:v",
    String(Math.round(input.totalDurationSec * fps)),
    input.outputPath,
  ];
}

export async function hardCutToLastFrame(
  input: Parameters<typeof buildHardCutArgs>[0],
  options: { ffmpegPath?: string; timeoutMs?: number } = {}
) {
  await fs.promises.mkdir(path.dirname(input.outputPath), { recursive: true });
  const temporaryPath = temporarySiblingPath(input.outputPath);
  const ffmpegPath = options.ffmpegPath ?? process.env.FFMPEG_PATH ?? "ffmpeg";
  const args = buildHardCutArgs({ ...input, outputPath: temporaryPath });
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpegPath, args, {
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        reject(new Error("ffmpeg 硬切处理超时"));
      }, options.timeoutMs ?? 120_000);
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
    await fs.promises.rename(temporaryPath, input.outputPath);
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true });
    throw error;
  }
  return input.outputPath;
}
