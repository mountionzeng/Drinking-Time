import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { ENV } from "../server/_core/env";
import {
  ViduSubmissionError,
  buildViduTransitionBody,
  downloadVideoToFile,
  estimateViduQ2TransitionCost,
  hardCutToLastFrame,
  refreshViduTransition,
  submitViduTransition,
  uploadFileTo302,
  uploadFileToVidu,
  waitForViduTransition,
  type ViduQ2Resolution,
} from "../server/services/videoTransition302";

const DEFAULT_PROMPT = [
  "同一位短黑色齐下巴波波头女性，穿同一件白色无袖长裙，在首帧原有室内场景中快速转身回望镜头。",
  "镜头固定，动作干净且单一；转身过程中只让首帧的笔触、色温和油画质感迅速靠近尾帧。",
  "人物五官、发型、身材比例、白裙和两边场景中的既有物体保持稳定。",
  "不要增加、删除或移动任何元素，不要变脸、变装、变形，不要出现多余肢体、文字或新物体。",
].join("");

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_VIDU_UPLOAD_BYTES = 10 * 1024 * 1024;

const { values } = parseArgs({
  options: {
    first: { type: "string" },
    last: { type: "string" },
    output: { type: "string" },
    prompt: { type: "string" },
    duration: { type: "string", default: "2" },
    resolution: { type: "string", default: "720p" },
    "cut-at": { type: "string", default: "1.4" },
    "task-id": { type: "string" },
    "state-file": { type: "string" },
    "inline-images": { type: "boolean", default: false },
    "vidu-upload": { type: "boolean", default: false },
    "legacy-302-upload": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
  strict: true,
});

function required(value: string | undefined, flag: string) {
  if (!value?.trim()) throw new Error(`缺少 --${flag}`);
  return path.resolve(value);
}

function imageContentType(bytes: Uint8Array, filePath: string) {
  const isPng =
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (value, index) => bytes[index] === value
    );
  if (isPng) return "image/png";
  const isJpeg =
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;
  if (isJpeg) return "image/jpeg";
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.slice(start, end));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return "image/webp";
  }
  throw new Error(`${filePath} 不是可识别的 PNG、JPEG 或 WEBP，已在上传前停止`);
}

function parseResolution(value: string | undefined): ViduQ2Resolution {
  if (value === "540p" || value === "720p" || value === "1080p") {
    return value;
  }
  throw new Error("--resolution 只支持 540p、720p 或 1080p");
}

async function readState(statePath: string) {
  try {
    return JSON.parse(await fs.readFile(statePath, "utf8")) as Record<
      string,
      unknown
    >;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeState(statePath: string, state: Record<string, unknown>) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(
      temporaryPath,
      `${JSON.stringify(state, null, 2)}\n`,
      "utf8"
    );
    await fs.rename(temporaryPath, statePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

async function acquireExecutionLock(statePath: string) {
  const lockPath = `${statePath}.lock`;
  const ownerToken = randomUUID();
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(lockPath, "wx");
    await handle.writeFile(
      `${JSON.stringify({
        pid: process.pid,
        ownerToken,
        createdAt: new Date().toISOString(),
      })}\n`,
      "utf8"
    );
    await handle.sync();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      const lockOwner = await readState(lockPath).catch(() => null);
      const ownerPid = lockOwner?.pid;
      if (
        typeof ownerPid !== "number" ||
        !Number.isInteger(ownerPid) ||
        ownerPid <= 0
      ) {
        throw new Error(
          `检测到无法识别的执行锁；为避免重复扣费已停止：${lockPath}`
        );
      }
      let ownerIsAlive = true;
      try {
        process.kill(ownerPid, 0);
      } catch (ownerError) {
        ownerIsAlive = (ownerError as NodeJS.ErrnoException).code !== "ESRCH";
      }
      if (ownerIsAlive) {
        throw new Error(
          `检测到另一个执行进程 PID ${ownerPid}；为避免重复扣费已停止：${lockPath}`
        );
      }
      throw new Error(
        `检测到已退出 PID ${ownerPid} 留下的执行锁。请先核对 302 任务记录和状态文件，再手动删除此锁：${lockPath}`
      );
    }
    await handle?.close().catch(() => undefined);
    await fs.rm(lockPath, { force: true });
    throw error;
  }
  const acquiredHandle = handle;
  return {
    async release() {
      await acquiredHandle.close().catch(() => undefined);
      const currentLock = await readState(lockPath).catch(() => null);
      if (currentLock?.ownerToken === ownerToken) {
        await fs.rm(lockPath, { force: true });
      }
    },
  };
}

function submissionFingerprint(input: {
  firstBytes: Uint8Array;
  lastBytes: Uint8Array;
  prompt: string;
  durationSec: number;
  resolution: ViduQ2Resolution;
  cutAtSec: number;
  imageTransport: "inline" | "upload" | "vidu-upload";
}) {
  const hash = createHash("sha256");
  hash.update(
    JSON.stringify({
      model: "viduq2-turbo",
      prompt: input.prompt,
      durationSec: input.durationSec,
      resolution: input.resolution,
      cutAtSec: input.cutAtSec,
      imageTransport: input.imageTransport,
    })
  );
  hash.update("\0first\0");
  hash.update(input.firstBytes);
  hash.update("\0last\0");
  hash.update(input.lastBytes);
  return hash.digest("hex");
}

const firstPath = required(values.first, "first");
const lastPath = required(values.last, "last");
const outputPath = required(values.output, "output");
const durationSec = Number(values.duration);
const cutAtSec = Number(values["cut-at"]);
const resolution = parseResolution(values.resolution);
const selectedImageTransports = [
  values["inline-images"],
  values["vidu-upload"],
  values["legacy-302-upload"],
].filter(Boolean).length;
if (selectedImageTransports > 1) {
  throw new Error(
    "--inline-images、--vidu-upload 和 --legacy-302-upload 不能同时使用"
  );
}
const imageTransport = values["inline-images"]
  ? "inline"
  : values["legacy-302-upload"]
    ? "upload"
    : "vidu-upload";
const prompt = values.prompt?.trim() || DEFAULT_PROMPT;
if (!Number.isFinite(cutAtSec) || cutAtSec <= 0 || cutAtSec >= durationSec) {
  throw new Error("--cut-at 必须大于 0 且小于总时长");
}
if (outputPath === firstPath || outputPath === lastPath) {
  throw new Error("--output 不能覆盖首帧或尾帧原图");
}
if (prompt.length > 5_000) {
  throw new Error("Vidu 提示词不能超过 5000 个字符");
}
const statePath = path.resolve(
  values["state-file"] || `${outputPath}.302-state.json`
);
if (
  statePath === firstPath ||
  statePath === lastPath ||
  statePath === outputPath
) {
  throw new Error("--state-file 不能覆盖首帧、尾帧或输出视频");
}
const estimate = estimateViduQ2TransitionCost({
  durationSec,
  resolution,
  uploadCount: imageTransport === "upload" ? 2 : 0,
});

const [firstStat, lastStat] = await Promise.all([
  fs.stat(firstPath),
  fs.stat(lastPath),
]);
for (const [filePath, stat] of [
  [firstPath, firstStat],
  [lastPath, lastStat],
] as const) {
  if (!stat.isFile()) throw new Error(`${filePath} 不是普通文件`);
  if (stat.size <= 0 || stat.size > MAX_UPLOAD_BYTES) {
    throw new Error(`${filePath} 为空或超过 302 上传上限 50MB`);
  }
  if (imageTransport === "vidu-upload" && stat.size >= MAX_VIDU_UPLOAD_BYTES) {
    throw new Error(`${filePath} 必须小于 Vidu 原生上传上限 10MB`);
  }
}
const [firstBytes, lastBytes] = await Promise.all([
  fs.readFile(firstPath),
  fs.readFile(lastPath),
]);
const firstContentType = imageContentType(firstBytes, firstPath);
const lastContentType = imageContentType(lastBytes, lastPath);
const inlineImageUrls =
  imageTransport === "inline"
    ? ([
        `data:${firstContentType};base64,${Buffer.from(firstBytes).toString("base64")}`,
        `data:${lastContentType};base64,${Buffer.from(lastBytes).toString("base64")}`,
      ] as const)
    : undefined;
const inlineRequestBytes = inlineImageUrls
  ? Buffer.byteLength(
      JSON.stringify(
        buildViduTransitionBody({
          prompt,
          firstImageUrl: inlineImageUrls[0],
          lastImageUrl: inlineImageUrls[1],
          durationSec,
          resolution,
        })
      ),
      "utf8"
    )
  : undefined;
if (inlineRequestBytes && inlineRequestBytes > 20 * 1024 * 1024) {
  throw new Error("内嵌首尾帧请求超过 Vidu 20MB 上限，已在付费提交前停止");
}
const fingerprint = submissionFingerprint({
  firstBytes,
  lastBytes,
  prompt,
  durationSec,
  resolution,
  cutAtSec,
  imageTransport,
});

if (values["dry-run"]) {
  process.stdout.write(
    `${JSON.stringify(
      {
        mode: "dry-run",
        charged: false,
        firstPath,
        lastPath,
        outputPath,
        statePath,
        model: "viduq2-turbo",
        durationSec,
        resolution,
        cutAtSec,
        holdLastFrameSec: Number((durationSec - cutAtSec).toFixed(3)),
        estimate,
        imageTransport,
        inlineRequestBytes,
        submissionFingerprint: fingerprint,
        inputChecks: {
          first: { bytes: firstStat.size, contentType: firstContentType },
          last: { bytes: lastStat.size, contentType: lastContentType },
        },
        prompt,
      },
      null,
      2
    )}\n`
  );
  process.exit(0);
}

if (!ENV.api302Key) {
  throw new Error("API302_KEY 未配置，已在创建提交状态前停止");
}
const executionLock = await acquireExecutionLock(statePath);
try {
  const existingState = await readState(statePath);
  if (existingState && existingState.submissionFingerprint !== fingerprint) {
    throw new Error(
      `状态文件与当前首尾帧或参数不匹配，已在联网前停止：${statePath}`
    );
  }
  const explicitTaskId = values["task-id"]?.trim() || undefined;
  const knownStateStatuses = new Set([
    "submission-in-progress",
    "submission-unknown",
    "submission-not-submitted",
    "submitted",
    "waiting-or-failed",
    "completed",
  ]);
  if (
    existingState &&
    (typeof existingState.status !== "string" ||
      !knownStateStatuses.has(existingState.status)) &&
    !explicitTaskId
  ) {
    throw new Error(
      `状态文件不完整或状态未知，为避免重复扣费已停止：${statePath}`
    );
  }
  if (
    (existingState?.status === "submission-unknown" ||
      existingState?.status === "submission-in-progress") &&
    !explicitTaskId
  ) {
    throw new Error(
      `上次提交状态不明，为避免重复扣费已停止。请先在 302 API 记录中核对：${statePath}`
    );
  }
  if (existingState?.status === "completed") {
    throw new Error(
      `任务已经完成，不会重复提交：${String(existingState.outputPath)}`
    );
  }

  let taskId = explicitTaskId;
  let videoUrl = "";
  if (!taskId && typeof existingState?.taskId === "string") {
    taskId = existingState.taskId.trim() || undefined;
  }
  if (
    existingState &&
    (existingState.status === "submitted" ||
      existingState.status === "waiting-or-failed") &&
    !taskId
  ) {
    throw new Error(
      `状态文件表示任务已经提交，但缺少 taskId；为避免重复扣费已停止：${statePath}`
    );
  }
  if (explicitTaskId) {
    await writeState(statePath, {
      ...(existingState ?? {}),
      status: "submitted",
      recovery: "explicit-task-id",
      taskId: explicitTaskId,
      submissionFingerprint: fingerprint,
      outputPath,
      durationSec,
      resolution,
      cutAtSec,
      estimate,
    });
  }

  if (!taskId) {
    const [firstImageUrl, lastImageUrl] = inlineImageUrls
      ? inlineImageUrls
      : imageTransport === "vidu-upload"
        ? await Promise.all([
            uploadFileToVidu({
              bytes: firstBytes,
              contentType: firstContentType,
            }),
            uploadFileToVidu({
              bytes: lastBytes,
              contentType: lastContentType,
            }),
          ])
        : await Promise.all([
            uploadFileTo302({
              fileName: path.basename(firstPath),
              bytes: firstBytes,
              contentType: firstContentType,
            }),
            uploadFileTo302({
              fileName: path.basename(lastPath),
              bytes: lastBytes,
              contentType: lastContentType,
            }),
          ]);
    const submissionState = {
      ...(imageTransport === "upload" || imageTransport === "vidu-upload"
        ? { firstImageUrl, lastImageUrl }
        : { imageTransport: "inline" }),
      outputPath,
      durationSec,
      resolution,
      cutAtSec,
      estimate,
      submissionFingerprint: fingerprint,
    };
    await writeState(statePath, {
      status: "submission-in-progress",
      ...submissionState,
    });
    try {
      const submitted = await submitViduTransition({
        prompt,
        firstImageUrl,
        lastImageUrl,
        durationSec,
        resolution,
      });
      taskId = submitted.taskId;
      await writeState(statePath, {
        status: "submitted",
        taskId,
        ...submissionState,
      });
    } catch (error) {
      if (error instanceof ViduSubmissionError) {
        await writeState(statePath, {
          status:
            error.submissionState === "unknown"
              ? "submission-unknown"
              : "submission-not-submitted",
          message: error.message,
          ...submissionState,
        });
      }
      throw error;
    }
  }

  if (!taskId) throw new Error("没有可查询的 Vidu taskId");
  const initial = await refreshViduTransition(taskId);
  const completed =
    initial.status === "processing" || initial.status === "retryable"
      ? await waitForViduTransition(taskId)
      : initial;
  if (completed.status !== "available") {
    await writeState(statePath, {
      ...(existingState ?? {}),
      status: "waiting-or-failed",
      taskId,
      message: completed.message,
      providerCode:
        "providerCode" in completed ? completed.providerCode : undefined,
      submissionFingerprint: fingerprint,
      outputPath,
    });
    throw new Error(completed.message);
  }
  videoUrl = completed.videoUrl;

  const generatedPath = path.join(
    path.dirname(outputPath),
    `${path.basename(outputPath, path.extname(outputPath))}.generated.mp4`
  );
  await downloadVideoToFile(videoUrl, generatedPath);
  await hardCutToLastFrame({
    generatedVideoPath: generatedPath,
    lastFramePath: lastPath,
    outputPath,
    totalDurationSec: durationSec,
    cutAtSec,
    size: 720,
    fps: 30,
  });
  await writeState(statePath, {
    ...(existingState ?? {}),
    status: "completed",
    taskId,
    videoUrl,
    generatedPath,
    outputPath,
    durationSec,
    resolution,
    cutAtSec,
    estimate,
    submissionFingerprint: fingerprint,
  });
  process.stdout.write(
    `${JSON.stringify({ status: "completed", taskId, videoUrl, outputPath }, null, 2)}\n`
  );
} finally {
  await executionLock.release();
}
