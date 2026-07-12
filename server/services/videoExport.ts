/**
 * 成片导出：把故事时间轴合成为一条 mp4——「从聊天到成片」闭环的最后一环。
 *
 * 原则：所见即所得。导出以 materialState 的「当前视频」为准（界面上每镜头
 * 显示什么就导什么）；修剪来自时间轴选择的片段范围（range），计划时长
 * （plannedDurationMs）封顶。两步管线：每镜头先归一化转码成中间段
 * （统一分辨率/帧率/音轨，缺音补静音），再 concat 无损拼接——单段失败
 * 可定位，不会产出半坏的成片。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  VIDEO_TARGET_DIMENSIONS,
  type VideoTargetAspectRatio,
} from "../../shared/videoConform";
import type { StoryMaterialState } from "../../shared/storyMaterial";
import { getStoryMaterialState } from "./storyMaterials";
import { videoFileName } from "./videoConform";
import { localVideoDir } from "./videoMedia";

export type ExportSegment = {
  shotNo: number;
  stableShotId: string;
  file: string;
  startSec: number;
  durationSec: number;
};

export type ExportPlan = {
  segments: ExportSegment[];
  skipped: Array<{ shotNo: number; reason: string }>;
};

export type ExportResult =
  | {
      status: "ok";
      videoUrl: string;
      videoKey: string;
      durationSec: number;
      segmentCount: number;
      skipped: Array<{ shotNo: number; reason: string }>;
    }
  | { status: "error"; error: string };

const MAX_SEGMENT_SEC = 30;

/** 纯函数：从素材状态推导导出计划（每镜头一段：文件 + 入点 + 时长）。 */
export function buildExportPlan(material: StoryMaterialState): ExportPlan {
  const byIdentity = new Map(
    material.shots.map(shot => [shot.stableShotId, shot] as const)
  );
  const items = [...material.timeline.items].sort(
    (left, right) => left.position - right.position
  );
  const segments: ExportSegment[] = [];
  const skipped: ExportPlan["skipped"] = [];

  for (const item of items) {
    const shot = byIdentity.get(item.stableShotId);
    const shotNo = shot?.shotNo ?? segments.length + skipped.length + 1;
    if (!item.included) {
      skipped.push({ shotNo, reason: "已从成片移除" });
      continue;
    }
    const video = shot?.currentVideo;
    if (!video || video.status !== "available") {
      skipped.push({ shotNo, reason: "没有可用的当前视频" });
      continue;
    }
    const file = videoFileName({ id: video.id, videoKey: video.videoKey });
    if (!file) {
      skipped.push({ shotNo, reason: "视频缺少本地文件" });
      continue;
    }
    // 修剪：选中了片段范围就用范围，否则从头播；计划时长封顶。
    const range =
      video.selectedSelectionType === "range" && video.selectedRangeId != null
        ? video.ranges.find(r => r.id === video.selectedRangeId)
        : null;
    const startSec = Math.max(0, range?.startSec ?? 0);
    const sourceEnd = range?.endSec ?? video.durationSec ?? MAX_SEGMENT_SEC;
    const planned = item.plannedDurationMs / 1000;
    const durationSec = Math.min(
      MAX_SEGMENT_SEC,
      Math.max(0.1, Math.min(sourceEnd - startSec, planned))
    );
    segments.push({
      shotNo,
      stableShotId: item.stableShotId,
      file,
      startSec,
      durationSec,
    });
  }
  return { segments, skipped };
}

function runFfmpeg(args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("ffmpeg 超时"));
    }, timeoutMs);
    child.stderr.on("data", chunk => {
      stderr = (stderr + String(chunk)).slice(-2000);
    });
    child.on("error", err => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg 退出码 ${code}: ${stderr.slice(-300)}`));
    });
  });
}

export async function exportStoryTimeline(params: {
  storyId: number;
  userId: number;
  targetAspectRatio?: VideoTargetAspectRatio;
}): Promise<ExportResult> {
  const material = await getStoryMaterialState(params.storyId, params.userId);
  if (!material) return { status: "error", error: "故事不存在或无权访问" };

  const plan = buildExportPlan(material);
  if (plan.segments.length === 0) {
    return {
      status: "error",
      error: "时间轴上没有可导出的镜头（每个镜头需要有可用的当前视频）",
    };
  }

  // 目标画幅缺省跟随多数镜头的当前视频。
  const ratio =
    params.targetAspectRatio ??
    (() => {
      const counts = new Map<string, number>();
      for (const shot of material.shots) {
        const ar = shot.currentVideo?.aspectRatio;
        if (ar) counts.set(ar, (counts.get(ar) ?? 0) + 1);
      }
      const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
      return (top === "1:1" || top === "9:16" ? top : "16:9") as VideoTargetAspectRatio;
    })();
  const dims = VIDEO_TARGET_DIMENSIONS[ratio];

  const dir = localVideoDir();
  const stamp = Date.now();
  const workDir = path.join(dir, `export-work-${params.storyId}-${stamp}`);
  await fs.promises.mkdir(workDir, { recursive: true });
  const key = `export-${params.storyId}-${stamp}.mp4`;
  const outputPath = path.join(dir, key);

  try {
    const parts: string[] = [];
    for (let index = 0; index < plan.segments.length; index += 1) {
      const seg = plan.segments[index];
      const src = path.join(dir, seg.file);
      if (!fs.existsSync(src)) {
        plan.skipped.push({ shotNo: seg.shotNo, reason: "本地文件缺失" });
        continue;
      }
      const part = path.join(workDir, `part-${String(index).padStart(3, "0")}.mp4`);
      // 归一化：统一分辨率（等比缩放+补边）、30fps、yuv420p、48k 立体声（缺音补静音）。
      await runFfmpeg(
        [
          "-y",
          "-ss", seg.startSec.toFixed(3),
          "-t", seg.durationSec.toFixed(3),
          "-i", src,
          "-f", "lavfi",
          "-t", seg.durationSec.toFixed(3),
          "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
          "-filter_complex",
          `[0:v]scale=${dims.width}:${dims.height}:force_original_aspect_ratio=decrease,` +
            `pad=${dims.width}:${dims.height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
            `fps=30,format=yuv420p,setsar=1[outv];` +
            `[0:a]aresample=48000[a0]`,
          "-map", "[outv]",
          "-map", "[a0]?",
          "-map", "1:a",
          "-c:v", "libx264",
          "-preset", "veryfast",
          "-crf", "19",
          "-c:a", "aac",
          "-shortest",
          part,
        ],
        120_000
      ).catch(async err => {
        // 音频滤镜对无音轨文件会失败：回退成纯静音配乐的简化命令。
        await runFfmpeg(
          [
            "-y",
            "-ss", seg.startSec.toFixed(3),
            "-t", seg.durationSec.toFixed(3),
            "-i", src,
            "-f", "lavfi",
            "-t", seg.durationSec.toFixed(3),
            "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
            "-filter_complex",
            `[0:v]scale=${dims.width}:${dims.height}:force_original_aspect_ratio=decrease,` +
              `pad=${dims.width}:${dims.height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
              `fps=30,format=yuv420p,setsar=1[outv]`,
            "-map", "[outv]",
            "-map", "1:a",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "19",
            "-c:a", "aac",
            "-shortest",
            part,
          ],
          120_000
        ).catch(() => {
          throw err;
        });
      });
      parts.push(part);
    }
    if (parts.length === 0) {
      return { status: "error", error: "所有镜头的本地文件都缺失，无法导出" };
    }

    const listPath = path.join(workDir, "concat.txt");
    await fs.promises.writeFile(
      listPath,
      parts.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join("\n")
    );
    await runFfmpeg(
      ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath],
      120_000
    );

    const totalSec = plan.segments.reduce((sum, s) => sum + s.durationSec, 0);
    return {
      status: "ok",
      videoUrl: `/api/videos/${key}`,
      videoKey: key,
      durationSec: Math.round(totalSec * 10) / 10,
      segmentCount: parts.length,
      skipped: plan.skipped,
    };
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : "导出失败",
    };
  } finally {
    await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
