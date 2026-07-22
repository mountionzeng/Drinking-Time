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
import {
  DEFAULT_TIMELINE_TRANSFORM,
  DEFAULT_TIMELINE_VIDEO_EFFECTS,
  type StoryMaterialState,
  type TimelineTransform,
  type TimelineVideoEffects,
} from "../../shared/storyMaterial";
import { getStoryMaterialState } from "./storyMaterials";
import { videoFileName } from "./videoConform";
import { localVideoDir } from "./videoMedia";

export type ExportSegment = {
  shotNo: number;
  stableShotId: string;
  file: string;
  startSec: number;
  sourceDurationSec: number;
  durationSec: number;
  effects: TimelineVideoEffects;
  transform: TimelineTransform;
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

type ShotVideoLike = {
  id: number;
  status: string;
  videoUrl?: string | null;
  videoKey?: string | null;
  durationSec?: number | null;
  isTimelineSelected?: boolean;
  selectedSelectionType?: string | null;
  selectedRangeId?: number | null;
  ranges: Array<{ id: number; startSec: number; endSec: number }>;
};

/**
 * 素材兜底：镜头没有「当前视频」时（常见于新鲜度审判误杀，见架构诊断
 * R1/R2），退回该镜头名下【已被时间轴选择】的素材，其次最新可用素材。
 */
function fallbackTakeForShot(
  shot: { videoTakes?: ShotVideoLike[] } | undefined
): ShotVideoLike | null {
  const takes = (shot?.videoTakes ?? []).filter(
    take => take.status === "available" && take.videoUrl
  );
  if (takes.length === 0) return null;
  return (
    takes.find(take => take.isTimelineSelected) ??
    [...takes].sort((left, right) => right.id - left.id)[0]
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function inferredEffects(input: {
  sourceStartSec: number;
  sourceEndSec: number;
  durationMs: number;
  effects?: TimelineVideoEffects;
}): TimelineVideoEffects {
  if (input.effects) return { ...input.effects };
  return {
    ...DEFAULT_TIMELINE_VIDEO_EFFECTS,
    playbackRate: clamp(
      (input.sourceEndSec - input.sourceStartSec) /
        Math.max(0.1, input.durationMs / 1_000),
      0.25,
      4
    ),
  };
}

function exportSegment(input: {
  shotNo: number;
  stableShotId: string;
  video: ShotVideoLike;
  sourceStartSec: number;
  sourceEndSec: number;
  plannedDurationMs: number;
  effects: TimelineVideoEffects;
  transform: TimelineTransform;
}): ExportSegment | null {
  const file = videoFileName({
    id: input.video.id,
    videoKey: input.video.videoKey ?? null,
  });
  if (!file) return null;
  const availableSourceSec = Math.max(
    1 / 30,
    input.sourceEndSec - input.sourceStartSec
  );
  const maximumOutputSec = availableSourceSec / input.effects.playbackRate;
  const durationSec = Math.min(
    MAX_SEGMENT_SEC,
    Math.max(0.1, Math.min(maximumOutputSec, input.plannedDurationMs / 1_000))
  );
  return {
    shotNo: input.shotNo,
    stableShotId: input.stableShotId,
    file,
    startSec: input.sourceStartSec,
    sourceDurationSec: Math.min(
      availableSourceSec,
      durationSec * input.effects.playbackRate
    ),
    durationSec,
    effects: input.effects,
    transform: input.transform,
  };
}

/** 纯函数：从素材状态推导导出计划（每镜头一段：文件 + 入点 + 时长）。 */
export function buildExportPlan(
  material: StoryMaterialState,
  opts: { fallbackToLatestTake?: boolean } = {}
): ExportPlan {
  const byIdentity = new Map(
    material.shots.map(shot => [shot.stableShotId, shot] as const)
  );
  const items = [...material.timeline.items].sort(
    (left, right) => left.position - right.position
  );
  const segments: ExportSegment[] = [];
  const skipped: ExportPlan["skipped"] = [];
  const takesById = new Map<number, ShotVideoLike>();
  for (const shot of material.shots) {
    for (const take of shot.videoTakes ?? []) takesById.set(take.id, take);
    if (shot.currentVideo)
      takesById.set(shot.currentVideo.id, shot.currentVideo);
  }

  for (const item of items) {
    const shot = byIdentity.get(item.stableShotId);
    const shotNo = shot?.shotNo ?? segments.length + skipped.length + 1;
    if (!item.included) {
      skipped.push({ shotNo, reason: "已从成片移除" });
      continue;
    }
    if (item.visualClipsReplacePrimary && item.visualClips?.length) {
      let exportedClipCount = 0;
      for (const clip of [...item.visualClips].sort(
        (left, right) => left.offsetMs - right.offsetMs
      )) {
        const clipVideo = takesById.get(clip.takeId);
        if (!clipVideo || clipVideo.status !== "available") continue;
        const effects = inferredEffects({
          sourceStartSec: clip.sourceStartSec,
          sourceEndSec: clip.sourceEndSec,
          durationMs: clip.durationMs,
          effects: clip.effects,
        });
        const segment = exportSegment({
          shotNo,
          stableShotId: item.stableShotId,
          video: clipVideo,
          sourceStartSec: clip.sourceStartSec,
          sourceEndSec: clip.sourceEndSec,
          plannedDurationMs: clip.durationMs,
          effects,
          transform: clip.transform ?? item.transform,
        });
        if (!segment) continue;
        segments.push(segment);
        exportedClipCount += 1;
      }
      if (exportedClipCount === 0) {
        skipped.push({ shotNo, reason: "视频切片缺少本地文件" });
      }
      continue;
    }
    const video: ShotVideoLike | null | undefined =
      shot?.currentVideo ??
      (opts.fallbackToLatestTake ? fallbackTakeForShot(shot) : null);
    if (!video || video.status !== "available") {
      skipped.push({ shotNo, reason: "没有可用的当前视频" });
      continue;
    }
    // 修剪：选中了片段范围就用范围，否则从头播；计划时长封顶。
    const range =
      video.selectedSelectionType === "range" && video.selectedRangeId != null
        ? video.ranges.find(r => r.id === video.selectedRangeId)
        : null;
    const edit =
      item.primaryVideoEdit?.takeId === video.id ? item.primaryVideoEdit : null;
    const startSec = Math.max(0, edit?.sourceStartSec ?? range?.startSec ?? 0);
    const sourceEnd = Math.max(
      startSec + 1 / 30,
      edit?.sourceEndSec ??
        range?.endSec ??
        video.durationSec ??
        MAX_SEGMENT_SEC
    );
    const segment = exportSegment({
      shotNo,
      stableShotId: item.stableShotId,
      video,
      sourceStartSec: startSec,
      sourceEndSec: sourceEnd,
      plannedDurationMs: item.plannedDurationMs,
      effects: edit?.effects ?? DEFAULT_TIMELINE_VIDEO_EFFECTS,
      transform: item.transform ?? DEFAULT_TIMELINE_TRANSFORM,
    });
    if (!segment) {
      skipped.push({ shotNo, reason: "视频缺少本地文件" });
      continue;
    }
    segments.push(segment);
  }
  return { segments, skipped };
}

function atempoFilters(rate: number): string[] {
  const filters: string[] = [];
  let remaining = clamp(rate, 0.25, 4);
  while (remaining < 0.5) {
    filters.push("atempo=0.5");
    remaining /= 0.5;
  }
  while (remaining > 2) {
    filters.push("atempo=2");
    remaining /= 2;
  }
  filters.push(`atempo=${remaining.toFixed(5)}`);
  return filters;
}

function videoFilters(
  segment: ExportSegment,
  dims: { width: number; height: number }
): string {
  const zoom = clamp(segment.transform.zoom, 1, 8);
  const cropX = ((clamp(segment.transform.panX, -1, 1) + 1) / 2).toFixed(5);
  const cropY = ((clamp(segment.transform.panY, -1, 1) + 1) / 2).toFixed(5);
  return [
    `scale=${dims.width}:${dims.height}:force_original_aspect_ratio=decrease`,
    `pad=${dims.width}:${dims.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    zoom > 1
      ? `crop=iw/${zoom.toFixed(5)}:ih/${zoom.toFixed(5)}:(iw-iw/${zoom.toFixed(5)})*${cropX}:(ih-ih/${zoom.toFixed(5)})*${cropY}`
      : null,
    zoom > 1 ? `scale=${dims.width}:${dims.height}` : null,
    segment.effects.reverse ? "reverse" : null,
    `setpts=(PTS-STARTPTS)/${segment.effects.playbackRate.toFixed(5)}`,
    "fps=30",
    "format=yuv420p",
    "setsar=1",
  ]
    .filter(Boolean)
    .join(",");
}

function audioFilters(segment: ExportSegment): string {
  return [
    segment.effects.reverse ? "areverse" : null,
    ...atempoFilters(segment.effects.playbackRate),
    `volume=${segment.effects.muted ? 0 : segment.effects.volume.toFixed(5)}`,
    "aresample=48000",
  ]
    .filter(Boolean)
    .join(",");
}

function runFfmpeg(args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
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
  fallbackToLatestTake?: boolean;
}): Promise<ExportResult> {
  const material = await getStoryMaterialState(params.storyId, params.userId);
  if (!material) return { status: "error", error: "故事不存在或无权访问" };

  const plan = buildExportPlan(material, {
    fallbackToLatestTake: params.fallbackToLatestTake,
  });
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
      const top = Array.from(counts.entries()).sort(
        (a, b) => b[1] - a[1]
      )[0]?.[0];
      return (
        top === "1:1" || top === "9:16" ? top : "16:9"
      ) as VideoTargetAspectRatio;
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
      const part = path.join(
        workDir,
        `part-${String(index).padStart(3, "0")}.mp4`
      );
      // 归一化：统一分辨率（等比缩放+补边）、30fps、yuv420p、48k 立体声（缺音补静音）。
      await runFfmpeg(
        [
          "-y",
          "-ss",
          seg.startSec.toFixed(3),
          "-t",
          seg.sourceDurationSec.toFixed(3),
          "-i",
          src,
          "-f",
          "lavfi",
          "-t",
          seg.durationSec.toFixed(3),
          "-i",
          "anullsrc=channel_layout=stereo:sample_rate=48000",
          "-filter_complex",
          `[0:v]${videoFilters(seg, dims)}[outv];` +
            `[0:a]${audioFilters(seg)}[a0]`,
          "-map",
          "[outv]",
          "-map",
          "[a0]?",
          "-map",
          "[a0]",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "19",
          "-c:a",
          "aac",
          "-shortest",
          part,
        ],
        120_000
      ).catch(async err => {
        // 音频滤镜对无音轨文件会失败：回退成纯静音配乐的简化命令。
        await runFfmpeg(
          [
            "-y",
            "-ss",
            seg.startSec.toFixed(3),
            "-t",
            seg.sourceDurationSec.toFixed(3),
            "-i",
            src,
            "-f",
            "lavfi",
            "-t",
            seg.durationSec.toFixed(3),
            "-i",
            "anullsrc=channel_layout=stereo:sample_rate=48000",
            "-filter_complex",
            `[0:v]${videoFilters(seg, dims)}[outv]`,
            "-map",
            "[outv]",
            "-map",
            "1:a",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "19",
            "-c:a",
            "aac",
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
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-c",
        "copy",
        outputPath,
      ],
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
    await fs.promises
      .rm(workDir, { recursive: true, force: true })
      .catch(() => {});
  }
}
