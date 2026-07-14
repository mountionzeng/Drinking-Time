import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { StoryTimelineItem } from "../../shared/storyMaterial";
import type { VideoTakeAsset } from "../../shared/videoAsset";
import {
  getVideoTakeById,
  getVideoTakeRangeById,
  updateVideoTake,
} from "../db";
import { videoFileName } from "./videoConform";
import { localVideoDir, materializeVideoUrl } from "./videoMedia";

const MAX_SEGMENT_SEC = 30;
const FRAME_EPSILON_SEC = 1 / 30;

export type TransitionVideoWindow = {
  startSec: number;
  endSec: number;
  rangeId: number | null;
  selectionType: "full_take" | "range";
};

export function transitionVideoWindow(
  video: Pick<
    VideoTakeAsset,
    | "durationSec"
    | "ranges"
    | "selectedRangeId"
    | "selectedSelectionType"
  >,
  timelineItem: Pick<StoryTimelineItem, "plannedDurationMs">
): TransitionVideoWindow {
  const selectedRange =
    video.selectedSelectionType === "range" && video.selectedRangeId != null
      ? video.ranges.find(range => range.id === video.selectedRangeId) ?? null
      : null;
  const startSec = Math.max(0, selectedRange?.startSec ?? 0);
  const sourceEnd = Math.max(
    startSec + 0.1,
    selectedRange?.endSec ?? video.durationSec ?? MAX_SEGMENT_SEC
  );
  const plannedSec = Math.max(0.1, timelineItem.plannedDurationMs / 1000);
  const durationSec = Math.min(
    MAX_SEGMENT_SEC,
    Math.max(0.1, Math.min(sourceEnd - startSec, plannedSec))
  );
  return {
    startSec,
    endSec: startSec + durationSec,
    rangeId: selectedRange?.id ?? null,
    selectionType: selectedRange ? "range" : "full_take",
  };
}

export function transitionVideoFrameTime(
  window: Pick<TransitionVideoWindow, "startSec" | "endSec">,
  role: "start" | "end"
): number {
  if (role === "start") return window.startSec;
  return Math.max(window.startSec, window.endSec - FRAME_EPSILON_SEC);
}

function runFfmpeg(args: string[], timeoutMs = 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const command = process.env.FFMPEG_PATH ?? "ffmpeg";
    const child = spawn(command, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error("视频端点抽帧超时"));
    }, timeoutMs);
    child.stderr.on("data", chunk => {
      stderr = `${stderr}${String(chunk)}`.slice(-8_000);
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

async function ensureLocalTakePath(
  takeId: number,
  userId: number
): Promise<{ sourcePath: string; durationSec: number | null }> {
  const take = await getVideoTakeById(takeId, userId);
  if (!take || take.status !== "available") {
    throw new Error("当前视频不存在、不可用或无权访问");
  }
  const existingFile = videoFileName(take);
  if (existingFile) {
    const existingPath = path.join(localVideoDir(), existingFile);
    if (fs.existsSync(existingPath)) {
      return { sourcePath: existingPath, durationSec: take.durationSec };
    }
  }
  if (!take.videoUrl || take.videoUrl.startsWith("/api/videos/")) {
    throw new Error("当前视频本地文件缺失，请重新导入素材");
  }
  const managed = await materializeVideoUrl(take.videoUrl, take.id);
  if (managed.status !== "ok") throw new Error(managed.message);
  const updated = await updateVideoTake(take.id, userId, {
    videoKey: managed.videoKey,
    videoUrl: managed.videoUrl,
    extractionCapability: "available",
  });
  if (!updated) throw new Error("视频本地化状态保存失败");
  return {
    sourcePath: path.join(localVideoDir(), managed.videoKey),
    durationSec: take.durationSec,
  };
}

export async function renderTransitionVideoFrame(input: {
  takeId: number;
  userId: number;
  rangeId: number | null;
  atSec: number;
  outputPath?: string;
}): Promise<{ path: string; atSec: number }> {
  if (!Number.isFinite(input.atSec) || input.atSec < 0) {
    throw new Error("视频端点时间无效");
  }
  const { sourcePath, durationSec } = await ensureLocalTakePath(
    input.takeId,
    input.userId
  );
  let lowerBound = 0;
  let upperBound = durationSec ?? MAX_SEGMENT_SEC;
  if (input.rangeId != null) {
    const range = await getVideoTakeRangeById(input.rangeId, input.userId);
    if (!range || range.takeId !== input.takeId) {
      throw new Error("视频片段范围不存在或不属于当前 Take");
    }
    lowerBound = Math.max(0, range.startSec);
    upperBound = Math.max(lowerBound, range.endSec);
  }
  if (
    input.atSec < lowerBound - 0.001 ||
    input.atSec > upperBound + 0.001
  ) {
    throw new Error("视频端点超出当前选中范围");
  }
  const atSec = Math.min(upperBound, Math.max(lowerBound, input.atSec));
  const digest = createHash("sha256")
    .update(
      `${input.takeId}:${path.basename(sourcePath)}:${input.rangeId ?? "full"}:${atSec.toFixed(3)}`
    )
    .digest("hex")
    .slice(0, 16);
  const outputPath =
    input.outputPath ??
    path.join(localVideoDir(), "transition-frames", `${digest}.png`);
  if (fs.existsSync(outputPath)) return { path: outputPath, atSec };
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp.png`;
  try {
    await runFfmpeg([
      "-y",
      "-i",
      sourcePath,
      "-ss",
      atSec.toFixed(3),
      "-frames:v",
      "1",
      "-vf",
      "scale=720:720:force_original_aspect_ratio=increase,crop=720:720",
      temporaryPath,
    ]);
    await fs.promises.rename(temporaryPath, outputPath);
    return { path: outputPath, atSec };
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true });
    throw error;
  }
}
