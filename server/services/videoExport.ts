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
  STORY_TIMELINE_FPS,
  timelineMsToFrames,
  timelineOffsetMsToFrames,
  type StoryMaterialState,
  type TimelineTransform,
  type TimelineVideoEffects,
} from "../../shared/storyMaterial";
import {
  buildTimelineLayout,
  resolveTimelineDocumentFrame,
  timelineTotalFrames,
  type TimelineLayoutRow,
} from "../../shared/timelineLayout";
import { resolveTimelineItemSource } from "../../shared/timelineSource";
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

/**
 * 时间轴切成的一个区间。三种变体分得很清：真有素材的段、创作者有意留的空档、
 * 素材找不到的占位。后两种都要占满同样长的时间，否则后面所有镜头的绝对时间
 * 都会被压回去。
 */
export type ExportPart =
  | ({ kind: "source" } & ExportSegment)
  | {
      kind: "gap";
      startFrame: number;
      durationFrames: number;
      durationSec: number;
    }
  | {
      kind: "missing";
      shotNo: number;
      stableShotId: string;
      reason: string;
      startFrame: number;
      durationFrames: number;
      durationSec: number;
    };

export type ExportPlan = {
  /** 只含真有素材的段；旧调用点和旧测试仍按这个读。 */
  segments: ExportSegment[];
  /** 完整的区间序列，含空档与缺素材占位。 */
  parts: ExportPart[];
  /** 解析出来的成片长度 = 最大结束时间。 */
  totalSec: number;
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

/** 一个镜头内部所有会改变画面来源的边界，换算成绝对帧。 */
function internalBoundaryFrames(row: TimelineLayoutRow): number[] {
  return (row.item.visualClips ?? []).flatMap(clip => {
    const offsetFrame = timelineOffsetMsToFrames(clip.offsetMs);
    const durationFrames = timelineMsToFrames(clip.durationMs);
    return [
      row.startFrame + offsetFrame,
      row.startFrame + offsetFrame + durationFrames,
    ];
  });
}

function framesToSec(frames: number): number {
  return frames / STORY_TIMELINE_FPS;
}

/** 两段能不能合成一段：同一个源、而且源时间接得上。 */
function continuous(previous: ExportSegment, next: ExportSegment): boolean {
  if (previous.file !== next.file) return false;
  if (previous.effects.reverse !== next.effects.reverse) return false;
  if (previous.effects.playbackRate !== next.effects.playbackRate) return false;
  const expected = previous.effects.reverse
    ? next.startSec + next.sourceDurationSec
    : previous.startSec + previous.sourceDurationSec;
  const actual = previous.effects.reverse ? previous.startSec : next.startSec;
  return Math.abs(expected - actual) < 1 / (STORY_TIMELINE_FPS * 4);
}

/**
 * 纯函数：把时间轴切成区间导出计划。
 *
 * 先按所有结构边界（每一镜的头尾、镜头内部每个视频切片的头尾）把时间轴切开，
 * 每个区间问一次共享 resolver「这一刻播的是谁」，因此预览里看到的 gap、
 * overlap 和锚点优先级，导出时会一模一样。
 */
export function buildExportPlan(
  material: StoryMaterialState,
  opts: {
    fallbackToLatestTake?: boolean;
    /** strict 时缺素材直接失败，不出半成品。 */
    missingSourceMode?: "strict" | "relaxed";
  } = {}
): ExportPlan {
  const byIdentity = new Map(
    material.shots.map(shot => [shot.stableShotId, shot] as const)
  );
  const takesById = new Map<number, ShotVideoLike>();
  for (const shot of material.shots) {
    for (const take of shot.videoTakes ?? []) takesById.set(take.id, take);
    if (shot.currentVideo)
      takesById.set(shot.currentVideo.id, shot.currentVideo);
  }
  for (const take of [
    ...(material.unassignedVideoTakes ?? []),
    ...(material.reusableVideoTakes ?? []),
  ]) {
    takesById.set(take.id, take);
  }

  const skipped: ExportPlan["skipped"] = [];
  const rows = buildTimelineLayout(
    material.timeline.items.filter(item => item.included !== false)
  );
  const overlays = material.timeline.overlays ?? [];
  const totalFrames = Math.max(
    timelineTotalFrames(rows),
    ...overlays.map(overlay => overlay.endFrame)
  );
  const boundaries = Array.from(
    new Set(
      rows
        .flatMap(row => [
          row.startFrame,
          row.endFrame,
          ...internalBoundaryFrames(row),
        ])
        .filter(frame => frame >= 0 && frame <= totalFrames)
        .concat(
          overlays.flatMap(overlay => [
            overlay.startFrame,
            overlay.mediaEndFrame,
            overlay.endFrame,
          ])
        )
        .concat(totalFrames > 0 ? [0, totalFrames] : [])
    )
  ).sort((left, right) => left - right);

  const parts: ExportPart[] = [];
  const reported = new Set<string>();
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startFrame = boundaries[index];
    const endFrame = boundaries[index + 1];
    const durationFrames = endFrame - startFrame;
    if (durationFrames <= 0) continue;
    const durationSec = framesToSec(durationFrames);

    const resolved = resolveTimelineDocumentFrame({
      items: material.timeline.items,
      overlays,
      hiddenVisualLayers: material.timeline.visualLayerState?.hidden,
      frame: startFrame,
    });
    if (resolved.kind === "gap") {
      parts.push({ kind: "gap", startFrame, durationFrames, durationSec });
      continue;
    }
    if (resolved.kind === "overlay") {
      const overlay = resolved.overlay;
      const take = takesById.get(overlay.takeId);
      const shotNo = byIdentity.get(overlay.sourceStableShotId)?.shotNo ?? 0;
      const file = take
        ? videoFileName({ id: take.id, videoKey: take.videoKey ?? null })
        : null;
      if (!take || take.status !== "available" || !file) {
        const reason = !take || take.status !== "available"
          ? "上层覆盖视频不可用"
          : "上层覆盖视频缺少本地文件";
        parts.push({
          kind: "missing",
          shotNo,
          stableShotId: overlay.sourceStableShotId,
          reason,
          startFrame,
          durationFrames,
          durationSec,
        });
        skipped.push({ shotNo, reason });
        continue;
      }
      const sourceStartSec = resolved.localFrame / STORY_TIMELINE_FPS;
      const effects = overlay.effects ?? { ...DEFAULT_TIMELINE_VIDEO_EFFECTS };
      parts.push({
        kind: "source",
        shotNo,
        stableShotId: overlay.sourceStableShotId,
        file,
        startSec: sourceStartSec,
        sourceDurationSec: durationSec * effects.playbackRate,
        durationSec,
        effects,
        transform: overlay.transform,
      });
      continue;
    }
    const item = resolved.row.item;
    const shot = byIdentity.get(item.stableShotId);
    const shotNo = shot?.shotNo ?? 0;
    const missing = (reason: string): void => {
      const key = `${item.stableShotId}:${reason}`;
      if (!reported.has(key)) {
        reported.add(key);
        skipped.push({ shotNo, reason });
      }
      parts.push({
        kind: "missing",
        shotNo,
        stableShotId: item.stableShotId,
        reason,
        startFrame,
        durationFrames,
        durationSec,
      });
    };

    // 镜头没写 primaryVideoEdit 时，它显示的就是「当前视频」加上被选中的片段范围。
    // 把它当成兜底来源交给共享 resolver，选谁播由 resolver 一家说了算。
    const currentVideo =
      shot?.currentVideo ??
      (opts.fallbackToLatestTake ? fallbackTakeForShot(shot) : null);
    const range =
      currentVideo?.selectedSelectionType === "range" &&
      currentVideo.selectedRangeId != null
        ? currentVideo.ranges.find(
            entry => entry.id === currentVideo.selectedRangeId
          )
        : null;
    const source = resolveTimelineItemSource({
      item,
      localFrame: resolved.localFrame,
      durationFrames: resolved.row.durationFrames,
      fallback: currentVideo
        ? {
            sourceType: "primary-video",
            sourceId: `take-${currentVideo.id}`,
            offsetFrame: 0,
            durationFrames: resolved.row.durationFrames,
            sourceStartSec: range?.startSec ?? 0,
            sourceEndSec:
              range?.endSec ??
              currentVideo.durationSec ??
              framesToSec(resolved.row.durationFrames),
            effects: { ...DEFAULT_TIMELINE_VIDEO_EFFECTS },
            transform: item.transform,
          }
        : null,
    });
    if (source.kind === "gap" || source.sourceTimeSec == null) {
      // 镜头里有切片、只是没盖住这一刻——那是创作者有意留的空档。
      // 整个镜头一点素材都没有则是缺素材，两者的诊断必须分开。
      if ((item.visualClips?.length ?? 0) > 0) {
        parts.push({ kind: "gap", startFrame, durationFrames, durationSec });
      } else {
        missing("没有可用的当前视频");
      }
      continue;
    }

    const clip =
      source.sourceType === "visual-clip"
        ? (item.visualClips ?? []).find(entry => entry.id === source.sourceId)
        : null;
    const takeId =
      clip?.takeId ??
      (source.sourceType === "primary-video"
        ? (item.primaryVideoEdit?.takeId ?? currentVideo?.id)
        : null);
    const video = (takeId != null ? takesById.get(takeId) : null) ?? currentVideo;
    if (!video || video.status !== "available") {
      missing("没有可用的当前视频");
      continue;
    }
    const file = videoFileName({
      id: video.id,
      videoKey: video.videoKey ?? null,
    });
    if (!file) {
      missing("视频缺少本地文件");
      continue;
    }

    const effects = clip
      ? inferredEffects({
          sourceStartSec: clip.sourceStartSec,
          sourceEndSec: clip.sourceEndSec,
          durationMs: clip.durationMs,
          effects: clip.effects,
        })
      : (item.primaryVideoEdit?.effects ?? {
          ...DEFAULT_TIMELINE_VIDEO_EFFECTS,
          playbackRate: source.rate,
        });
    // 区间两端的源时间；倒放时画面从大往小走，所以取点在小的那头。
    // 源不够长就只取剩下的那点，区间长度不变——余下的时间冻在最后一帧，
    // 绝不把后面镜头的绝对时间压回去。
    const remainingSec = source.sourceWindow
      ? effects.reverse
        ? source.sourceTimeSec - source.sourceWindow.startSec
        : source.sourceWindow.endSec - source.sourceTimeSec
      : durationSec * source.rate;
    const spanSec = Math.max(
      0,
      Math.min(durationSec * source.rate, remainingSec)
    );
    if (spanSec <= 0) {
      // 画面已经停在窗口尽头：这一段没有新素材可取，按空档补等长黑场。
      parts.push({ kind: "gap", startFrame, durationFrames, durationSec });
      continue;
    }
    const startSec = effects.reverse
      ? Math.max(0, source.sourceTimeSec - spanSec)
      : Math.max(0, source.sourceTimeSec);
    parts.push({
      kind: "source",
      shotNo,
      stableShotId: item.stableShotId,
      file,
      startSec,
      sourceDurationSec: spanSec,
      durationSec,
      effects,
      transform: clip?.transform ?? item.transform ?? DEFAULT_TIMELINE_TRANSFORM,
    });
  }

  for (const item of material.timeline.items) {
    if (item.included !== false) continue;
    skipped.push({
      shotNo: byIdentity.get(item.stableShotId)?.shotNo ?? 0,
      reason: "已从成片移除",
    });
  }

  // 连续同源的区间合成一段；跨 winner、跨锚点或源时间接不上的一律不合。
  const coalesced: ExportPart[] = [];
  for (const part of parts) {
    const previous = coalesced.at(-1);
    if (
      part.kind === "source" &&
      previous?.kind === "source" &&
      previous.stableShotId === part.stableShotId &&
      continuous(previous, part)
    ) {
      coalesced[coalesced.length - 1] = {
        ...previous,
        startSec: previous.effects.reverse ? part.startSec : previous.startSec,
        sourceDurationSec: previous.sourceDurationSec + part.sourceDurationSec,
        durationSec: previous.durationSec + part.durationSec,
      };
      continue;
    }
    if (
      part.kind !== "source" &&
      previous?.kind === part.kind &&
      (part.kind === "gap" ||
        (previous.kind === "missing" &&
          previous.stableShotId === part.stableShotId))
    ) {
      coalesced[coalesced.length - 1] = {
        ...previous,
        durationFrames: previous.durationFrames + part.durationFrames,
        durationSec: previous.durationSec + part.durationSec,
      } as ExportPart;
      continue;
    }
    coalesced.push(part);
  }

  return {
    parts: coalesced,
    segments: coalesced.flatMap(part =>
      part.kind === "source" ? [stripKind(part)] : []
    ),
    totalSec: framesToSec(totalFrames),
    skipped,
  };
}

function stripKind(part: { kind: "source" } & ExportSegment): ExportSegment {
  const { kind: _kind, ...segment } = part;
  return segment;
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
  const heartbeat =
    segment.effects.motionPreset?.kind === "heartbeat"
      ? segment.effects.motionPreset
      : null;
  const heartbeatScale = heartbeat
    ? (() => {
        const bpm = clamp(heartbeat.bpm, 36, 180).toFixed(4);
        const amount = clamp(heartbeat.scaleAmount, 0.01, 0.16).toFixed(5);
        const pulse = `((sin(2*PI*${bpm}/60*t)+1)/2)`;
        const scale = `(1+${amount}*${pulse}*${pulse}*${pulse}*${pulse})`;
        return `scale=iw*${scale}:ih*${scale}:eval=frame,crop=${dims.width}:${dims.height}:(iw-${dims.width})/2:(ih-${dims.height})/2`;
      })()
    : null;
  return [
    `scale=${dims.width}:${dims.height}:force_original_aspect_ratio=decrease`,
    `pad=${dims.width}:${dims.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    zoom > 1
      ? `crop=iw/${zoom.toFixed(5)}:ih/${zoom.toFixed(5)}:(iw-iw/${zoom.toFixed(5)})*${cropX}:(ih-ih/${zoom.toFixed(5)})*${cropY}`
      : null,
    zoom > 1 ? `scale=${dims.width}:${dims.height}` : null,
    heartbeatScale,
    segment.effects.reverse ? "reverse" : null,
    `setpts=(PTS-STARTPTS)/${segment.effects.playbackRate.toFixed(5)}`,
    // 源比区间短时冻在最后一帧补满，绝不允许把后面镜头的绝对时间压回去。
    `tpad=stop_mode=clone:stop_duration=${segment.durationSec.toFixed(3)}`,
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

/** 等长黑画面 + 静音，规格与真实片段完全一致，供空档和缺素材占位使用。 */
function blackSilenceArgs(input: {
  durationSec: number;
  dims: { width: number; height: number };
  output: string;
}): string[] {
  const duration = Math.max(1 / 30, input.durationSec).toFixed(3);
  return [
    "-y",
    "-f",
    "lavfi",
    "-t",
    duration,
    "-i",
    `color=c=black:s=${input.dims.width}x${input.dims.height}:r=30`,
    "-f",
    "lavfi",
    "-t",
    duration,
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "19",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-t",
    duration,
    input.output,
  ];
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
  /** strict 时缺素材直接失败；relaxed 补等长黑场并记录诊断。 */
  missingSourceMode?: "strict" | "relaxed";
}): Promise<ExportResult> {
  const material = await getStoryMaterialState(params.storyId, params.userId);
  if (!material) return { status: "error", error: "故事不存在或无权访问" };

  const missingSourceMode = params.missingSourceMode ?? "relaxed";
  const plan = buildExportPlan(material, {
    fallbackToLatestTake: params.fallbackToLatestTake,
    missingSourceMode,
  });
  if (plan.segments.length === 0) {
    return {
      status: "error",
      error: "时间轴上没有可导出的镜头（每个镜头需要有可用的当前视频）",
    };
  }
  const missingParts = plan.parts.filter(part => part.kind === "missing");
  if (missingSourceMode === "strict" && missingParts.length > 0) {
    return {
      status: "error",
      error: `有 ${missingParts.length} 段缺少素材，严格模式不出半成品：${plan.skipped
        .map(entry => `镜头 ${entry.shotNo} ${entry.reason}`)
        .join("；")}`,
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
    for (let index = 0; index < plan.parts.length; index += 1) {
      const planned = plan.parts[index];
      const part = path.join(
        workDir,
        `part-${String(index).padStart(3, "0")}.mp4`
      );
      // 有意的空档和缺素材占位都不去摸文件系统：直接生成等长的黑画面加静音，
      // 规格和真实片段完全一致，concat 时才不会串流失败。
      if (planned.kind !== "source") {
        await runFfmpeg(
          blackSilenceArgs({
            durationSec: planned.durationSec,
            dims,
            output: part,
          }),
          120_000
        );
        parts.push(part);
        continue;
      }
      const seg = planned;
      const src = path.join(dir, seg.file);
      if (!fs.existsSync(src)) {
        plan.skipped.push({ shotNo: seg.shotNo, reason: "本地文件缺失" });
        if (missingSourceMode === "strict") {
          throw new Error(`镜头 ${seg.shotNo} 的本地文件缺失`);
        }
        await runFfmpeg(
          blackSilenceArgs({
            durationSec: seg.durationSec,
            dims,
            output: part,
          }),
          120_000
        );
        parts.push(part);
        continue;
      }
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
          "-t",
          seg.durationSec.toFixed(3),
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
            "-t",
            seg.durationSec.toFixed(3),
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

    // 成片长度就是解析出来的最大结束时间——空档和占位都占满了它们那份时间。
    const totalSec = plan.totalSec;
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
