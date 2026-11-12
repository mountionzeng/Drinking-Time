import { planPausedFrame } from "./pausedFrameReference";
import sharp from "sharp";
import { renderExportImageBytes } from "./videoExportImage";
import { readStoryImageBytes } from "./chatColorTransfer";
import type { PausedFrameSnapshot } from "../../shared/chatFrameReference";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { canonicalizeShotNo } from "../../shared/imageAsset";
import { explicitReferenceShotNumber, referenceFrameOffsets, type ChatFrameReference } from "../../shared/chatFrameReference";
import type { ShotMaterialState, StoryMaterialState } from "../../shared/storyMaterial";
import { buildTimelineLayout } from "../../shared/timelineLayout";
import { createGeneratedImage, getStoryGeneratedImages } from "../repositories/images";
import { getStoryMaterialState } from "./storyMaterials";
import { renderTransitionVideoFrame } from "./videoEndpointFrames";
import { resolveTimelineFrameExtraction } from "./timelineFrameExtraction";
import { storeImageBytes } from "./imageGen";
import { consumeTimelineFrameExtractionAllowance, preflightTimelineFrameExtractionStorage, runTimelineFrameCapture, storeTimelineFrameExtractionBytes } from "./timelineFrameExtractionLimits";

type Input = { storyId: number; userId: number; instruction: string; stableShotId?: string; playheadMs?: number; pausedFrame?: PausedFrameSnapshot };
const dependencies = { getMaterial: getStoryMaterialState, listImages: getStoryGeneratedImages, createImage: createGeneratedImage, capture: renderTransitionVideoFrame, readFile, storeBytes: storeImageBytes, preflight: preflightTimelineFrameExtractionStorage, storeLimited: storeTimelineFrameExtractionBytes, renderFrame: renderExportImageBytes, readImage: readStoryImageBytes };
type Dependencies = typeof dependencies;
type SavedFrame = { id: number; imageUrl: string; imageSize?: { width: number; height: number } };
const saving = new Map<string, Promise<SavedFrame>>();

async function nativeSize(bytes: Uint8Array) {
  const meta = await sharp(bytes).metadata();
  if (!meta.width || !meta.height || meta.width * meta.height > 4096 * 4096)
    throw new Error("原画面尺寸无法安全处理，未缩放或改图 / Source size unavailable or too large; no resize applied");
  return { width: meta.width, height: meta.height };
}

function normalizedName(value: string) {
  return value.toLowerCase().replace(/\.(mp4|mov|webm)$/i, "").replace(/([_-]v)0+(\d+)/g, "$1$2");
}

export function resolveReferenceShot(state: StoryMaterialState, input: Pick<Input, "instruction" | "stableShotId" | "playheadMs">): ShotMaterialState {
  const shotNo = explicitReferenceShotNumber(input.instruction);
  if (shotNo != null) {
    const shots = state.shots.filter(shot => shot.shotNo === shotNo);
    if (shots.length !== 1) throw new Error("未找到唯一的目标镜头 / Shot not found");
    return shots[0];
  }
  const named = normalizedName(input.instruction);
  const aliases = state.shots.filter(shot => shot.videoTakes.some(video => {
    const original = video.parameterSnapshot?.originalName ?? video.parameterSnapshot?.fileName;
    const label = typeof original === "string" ? original : video.videoKey?.split("/").pop();
    return label && named.includes(normalizedName(label));
  }));
  if (aliases.length > 1) throw new Error("素材名对应多个镜头，请指定镜号 / Specify a shot number");
  if (aliases.length === 1) return aliases[0];
  // Do not silently apply an unknown named file to a previously clicked shot.
  if (/\b[\w-]+(?:_v\d+|\.(?:mp4|mov|webm))\b/i.test(input.instruction)) throw new Error("未找到这个视频，请指定镜号 / Video not found; specify a shot number");
  const selected = state.shots.find(shot => shot.stableShotId === input.stableShotId);
  if (selected) return selected;
  throw new Error("请说明第几个镜头，或先点选镜头 / Name or select a shot");
}

export function planChatReferenceFrames(state: StoryMaterialState, input: Pick<Input, "instruction" | "stableShotId">) {
  const shot = resolveReferenceShot(state, input);
  const row = buildTimelineLayout(state.timeline.items).find(row => row.item.stableShotId === shot.stableShotId);
  if (!row || !row.item.included) throw new Error("这个镜头尚未放入剪辑线 / This shot is not on the timeline");
  const video = shot.currentVideo;
  const range = video?.selectedSelectionType === "range" ? video.ranges.find(range => range.id === video.selectedRangeId) : undefined;
  const currentVideosByShot = video ? new Map([[shot.stableShotId, { takeId: video.id, durationSec: video.durationSec, rangeId: range?.id ?? null, sourceStartSec: range?.startSec ?? 0, sourceEndSec: range?.endSec ?? video.durationSec ?? undefined }]]) : undefined;
  return referenceFrameOffsets(input.instruction, row.durationFrames).map(offset => {
    // Inspect this shot's source video, not subtitles, another overlaid shot or a one-frame still.
    const result = resolveTimelineFrameExtraction({ document: { items: [{ ...row.item, timelineStartFrame: row.startFrame, imageClips: [] }] }, timelineFrame: row.startFrame + offset, currentVideosByShot });
    if (result.status !== "ok" || result.descriptor.kind !== "video") throw new Error("该时间点没有可抽取的视频 / No video at this time");
    const descriptor = result.descriptor;
    const takes = [...state.shots.flatMap(shot => shot.videoTakes), ...state.reusableVideoTakes, ...state.unassignedVideoTakes];
    const take = takes.find(take => take.id === descriptor.takeId && take.storyId === state.storyId);
    if (!take || take.status !== "available") throw new Error("原视频不可用 / Source video unavailable");
    return { shot, descriptor, offset };
  });
}

/** Warehouse-only source inspection. Never calls timeline placement or a generation provider. */
export async function extractChatFrameReferences(input: Input, overrides: Partial<Dependencies> = {}) {
  const deps = { ...dependencies, ...overrides };
  const state = await deps.getMaterial(input.storyId, input.userId);
  if (!state) throw new Error("故事不存在或无权操作 / Story unavailable");
  const paused = input.pausedFrame ? planPausedFrame(state, input.pausedFrame) : null;
  const sourceFrame = !input.pausedFrame || input.pausedFrame.imageMode === "source";
  const plan = paused ? [paused] : planChatReferenceFrames(state, input);
  const frames: ChatFrameReference[] = [];
  const failures: string[] = [];
  for (const { shot, descriptor, offset } of plan) {
    try {
      const digest = createHash("sha256").update(JSON.stringify([input.userId, input.storyId, shot.stableShotId, descriptor.kind === "video" ? [descriptor.takeId, descriptor.rangeId, descriptor.atSec.toFixed(3)] : [descriptor.imageId], paused ? [input.pausedFrame, paused.transform, "paused-preview-v1"] : "source-native-v2"])).digest("hex").slice(0, 32);
      const key = `generated/frame-references/source-ref-${digest}.png`;
      let pending = saving.get(key);
      if (!pending) {
        pending = (async () => {
          const existing = (await deps.listImages(input.storyId, input.userId)).find(image => image.imageKey === key && image.shotIdentity === shot.stableShotId);
          if (existing) return sourceFrame ? { ...existing, imageSize: await nativeSize(await deps.readImage(existing)) } : existing;
          if (!consumeTimelineFrameExtractionAllowance({ ...input, requestId: key }).allowed) throw new Error("抽帧频率过高，请稍后重试 / Please try again shortly");
          await deps.preflight({ storageKey: key });
          let bytes: Buffer;
          if (descriptor.kind === "video") {
            const capture = await runTimelineFrameCapture({ userId: input.userId, takeId: descriptor.takeId, rangeId: descriptor.rangeId, atSec: descriptor.atSec, variant: sourceFrame ? "source-native" : "source-aspect", capture: () => deps.capture({ userId: input.userId, takeId: descriptor.takeId, rangeId: descriptor.rangeId, atSec: descriptor.atSec, preserveAspect: true, ...(sourceFrame ? { preserveDimensions: true } : {}) }) });
            bytes = await deps.readFile(capture.path);
          } else {
            const source = (await deps.listImages(input.storyId, input.userId)).find(image => image.id === descriptor.imageId);
            if (!source) throw new Error("图片不存在或无权读取 / Image unavailable");
            bytes = Buffer.from(await deps.readImage(source));
          }
          // Editing uses the source pixels. Timeline contain/cover, pan and zoom remain
          // placement metadata and must not become black borders or a resized base image.
          if (sourceFrame && descriptor.kind === "image") bytes = await sharp(bytes).rotate().png().toBuffer();
          const imageSize = sourceFrame ? await nativeSize(bytes) : undefined;
          if (paused && !sourceFrame) bytes = await deps.renderFrame(bytes, paused.transform, paused.dimensions, descriptor.kind === "video" ? "contain" : "cover");
          const stored = await deps.storeLimited({ bytes, storageKey: key, store: () => deps.storeBytes(bytes, "image/png", { storageKey: key, requireLocal: true }) });
          if (stored.status !== "ok" || !stored.imageUrl) throw new Error("参考帧保存失败 / Could not save reference frame");
          const image = await deps.createImage({ storyId: input.storyId, userId: input.userId, shotNo: canonicalizeShotNo(shot.shotNo), shotIdentity: shot.stableShotId, imageKey: stored.imageKey, imageUrl: stored.imageUrl, prompt: `视频参考帧 / Video reference · 第 ${String(shot.shotNo).padStart(2, "0")} 镜 · ${descriptor.kind === "video" ? `Take ${descriptor.takeId} · 源 ${descriptor.atSec.toFixed(3)}s` : `Image ${descriptor.imageId}`} · ${input.pausedFrame ? `剪辑修订 ${input.pausedFrame.timelineVersion} · ` : ""} · 时间线帧 ${descriptor.timelineFrame}${imageSize ? ` · 原素材 ${imageSize.width}×${imageSize.height} / Native source; timeline placement unchanged` : ""}`, isCurrent: false, generationType: "initial" });
          return { ...image, ...(imageSize ? { imageSize } : {}) };
        })();
        saving.set(key, pending);
      }
      let image: SavedFrame;
      try { image = await pending; }
      finally { if (saving.get(key) === pending) saving.delete(key); }
      frames.push({ storyId: input.storyId, stableShotId: shot.stableShotId, shotNo: shot.shotNo, imageId: image.id, imageUrl: image.imageUrl, ...(descriptor.kind === "video" ? {takeId: descriptor.takeId} : {}), sourceTimeSec: descriptor.kind === "video" ? descriptor.atSec : 0, timelineFrame: descriptor.timelineFrame, shotTimeSec: offset / 30, timelineVersion: state.timeline.version, ...(input.pausedFrame ? { origin: "paused-preview" as const } : {}), ...(sourceFrame ? { sourceFrame: true, imageSize: image.imageSize } : {}) });
    } catch (error) { failures.push(error instanceof Error ? error.message : "抽帧失败 / Frame capture failed"); }
  }
  if (input.pausedFrame) {
    const fresh = await deps.getMaterial(input.storyId, input.userId);
    if (!fresh || fresh.timeline.version !== input.pausedFrame.timelineVersion)
      throw new Error("剪辑版本已变化，参考帧保留在仓库，请重新引用 / Timeline changed; reference saved in Warehouse. Please reference again");
  }
  return { frames, failures, shotNo: plan[0].shot.shotNo, requestedCount: plan.length };
}
