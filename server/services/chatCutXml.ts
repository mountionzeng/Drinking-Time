import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { StoryTimelineItem } from "../../shared/storyMaterial";
import {
  createStory,
  deleteStory,
  getStoryById,
  getStoryTimeline,
  updateStory,
  updateStoryTimeline,
} from "../db";
import { migrateStoryPromptLineage } from "./promptLineageMigration";
import { getStoryRevision, prepareStoryBody } from "./storySync";

export const MAX_CHATCUT_XML_BYTES = 2_000_000;

type XmlRecord = Record<string, unknown>;

export type ChatCutMediaKind = "video" | "image" | "audio" | "unknown";

export type ChatCutTransform = {
  scalePercent: number;
  centerX: number;
  centerY: number;
  rotation: number;
  cropLeft: number;
  cropRight: number;
  cropTop: number;
  cropBottom: number;
  opacityPercent: number;
};

export type ChatCutTimeRemap = {
  speedPercent: number;
  reverse: boolean;
};

export type ChatCutClip = {
  id: string;
  trackIndex: number;
  name: string;
  fileId: string | null;
  pathUrl: string | null;
  audioUrl?: string | null;
  mediaKind: ChatCutMediaKind;
  sourceWidth: number | null;
  sourceHeight: number | null;
  sourceDurationFrames: number | null;
  startFrame: number;
  endFrame: number;
  inFrame: number;
  outFrame: number;
  transform: ChatCutTransform;
  timeRemap: ChatCutTimeRemap | null;
  linkedClipIds: string[];
};

export type ChatCutTransition = {
  trackIndex: number;
  startFrame: number;
  endFrame: number;
  name: string;
  alignment: string | null;
};

export type ChatCutTrack = {
  index: number;
  clips: ChatCutClip[];
  transitions: ChatCutTransition[];
};

export type ChatCutImportPlan = {
  schemaVersion: 1;
  sourceFormat: "xmeml";
  projectName: string;
  sequenceName: string;
  durationFrames: number;
  fps: number;
  width: number;
  height: number;
  primaryVideoTrackIndex: number;
  videoTracks: ChatCutTrack[];
  audioTracks: ChatCutTrack[];
  mediaFiles: Array<{
    fileId: string | null;
    name: string;
    pathUrl: string | null;
    mediaKind: ChatCutMediaKind;
    sourceWidth: number | null;
    sourceHeight: number | null;
  }>;
  importedCapabilities: {
    exactTiming: true;
    sourceInOut: true;
    cropAndTransform: true;
    timeRemap: true;
    audioManifest: true;
    multiTrackManifest: true;
    mediaRelinkRequired: true;
  };
};

export type ChatCutImportSummary = {
  projectName: string;
  sequenceName: string;
  durationFrames: number;
  durationMs: number;
  fps: number;
  width: number;
  height: number;
  primaryVideoTrackIndex: number;
  videoTrackCount: number;
  audioTrackCount: number;
  primaryClipCount: number;
  videoClipCount: number;
  audioClipCount: number;
  transitionCount: number;
  mediaFileCount: number;
  mediaFiles: string[];
  requiresMediaRelink: true;
};

const DEFAULT_TRANSFORM: ChatCutTransform = {
  scalePercent: 100,
  centerX: 0,
  centerY: 0,
  rotation: 0,
  cropLeft: 0,
  cropRight: 0,
  cropTop: 0,
  cropBottom: 0,
  opacityPercent: 100,
};

function asRecord(value: unknown): XmlRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as XmlRecord)
    : {};
}

function asArray(value: unknown): unknown[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function firstRecord(value: unknown): XmlRecord {
  return asRecord(asArray(value)[0]);
}

function textValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  const record = asRecord(value);
  if (record["#text"] !== undefined) {
    return textValue(record["#text"], fallback);
  }
  return fallback;
}

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(textValue(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function finiteInteger(value: unknown, fallback = 0): number {
  return Math.round(finiteNumber(value, fallback));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function booleanValue(value: unknown, fallback = false): boolean {
  const normalized = textValue(value).toUpperCase();
  if (normalized === "TRUE" || normalized === "1") return true;
  if (normalized === "FALSE" || normalized === "0") return false;
  return fallback;
}

function decodePathName(pathUrl: string): string {
  const withoutScheme = pathUrl.replace(/^file:\/\/(?:\.\/)?/i, "");
  const leaf = withoutScheme.split(/[\\/]/).pop() || withoutScheme;
  try {
    return decodeURIComponent(leaf);
  } catch {
    return leaf;
  }
}

function mediaKindFromName(name: string): ChatCutMediaKind {
  const extension = name.split(".").pop()?.toLowerCase() || "";
  if (
    ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff"].includes(
      extension
    )
  ) {
    return "image";
  }
  if (["mp4", "mov", "m4v", "webm", "avi", "mkv"].includes(extension)) {
    return "video";
  }
  if (["mp3", "wav", "m4a", "aac", "flac", "ogg"].includes(extension)) {
    return "audio";
  }
  return "unknown";
}

function parametersOf(effect: XmlRecord): Map<string, XmlRecord> {
  const result = new Map<string, XmlRecord>();
  for (const rawParameter of asArray(effect.parameter)) {
    const parameter = asRecord(rawParameter);
    const id = textValue(parameter.parameterid).toLowerCase();
    if (id) result.set(id, parameter);
  }
  return result;
}

function parameterNumber(
  parameters: Map<string, XmlRecord>,
  id: string,
  fallback: number
): number {
  return finiteNumber(parameters.get(id)?.value, fallback);
}

function parseEffects(clip: XmlRecord): {
  transform: ChatCutTransform;
  timeRemap: ChatCutTimeRemap | null;
} {
  const transform = { ...DEFAULT_TRANSFORM };
  let timeRemap: ChatCutTimeRemap | null = null;

  for (const rawFilter of asArray(clip.filter)) {
    const effect = firstRecord(asRecord(rawFilter).effect);
    const effectId = textValue(effect.effectid).toLowerCase();
    const parameters = parametersOf(effect);

    if (effectId === "basic") {
      transform.scalePercent = parameterNumber(parameters, "scale", 100);
      transform.rotation = parameterNumber(parameters, "rotation", 0);
      const center = asRecord(parameters.get("center")?.value);
      transform.centerX = finiteNumber(center.horiz, 0);
      transform.centerY = finiteNumber(center.vert, 0);
    } else if (effectId === "crop") {
      transform.cropLeft = parameterNumber(parameters, "left", 0);
      transform.cropRight = parameterNumber(parameters, "right", 0);
      transform.cropTop = parameterNumber(parameters, "top", 0);
      transform.cropBottom = parameterNumber(parameters, "bottom", 0);
    } else if (effectId === "opacity") {
      transform.opacityPercent = parameterNumber(parameters, "opacity", 100);
    } else if (effectId === "timeremap") {
      timeRemap = {
        speedPercent: parameterNumber(parameters, "speed", 100),
        reverse: booleanValue(parameters.get("reverse")?.value),
      };
    }
  }

  return { transform, timeRemap };
}

type FileDescriptor = {
  fileId: string | null;
  name: string;
  pathUrl: string | null;
  mediaKind: ChatCutMediaKind;
  sourceWidth: number | null;
  sourceHeight: number | null;
  sourceDurationFrames: number | null;
};

function descriptorFromFile(file: XmlRecord): FileDescriptor {
  const fileId = textValue(file["@_id"]) || null;
  const pathUrl = textValue(file.pathurl) || null;
  const name =
    textValue(file.name) || (pathUrl ? decodePathName(pathUrl) : "未命名素材");
  const videoCharacteristics = firstRecord(
    firstRecord(firstRecord(file.media).video).samplecharacteristics
  );
  const hasVideo = Object.keys(videoCharacteristics).length > 0;
  const hasAudio =
    Object.keys(firstRecord(firstRecord(file.media).audio)).length > 0;
  const inferredKind = mediaKindFromName(name);
  const mediaKind =
    inferredKind !== "unknown"
      ? inferredKind
      : hasVideo
        ? "video"
        : hasAudio
          ? "audio"
          : "unknown";
  const width = finiteInteger(videoCharacteristics.width, 0);
  const height = finiteInteger(videoCharacteristics.height, 0);
  const duration = finiteInteger(file.duration, 0);
  return {
    fileId,
    name,
    pathUrl,
    mediaKind,
    sourceWidth: width > 0 ? width : null,
    sourceHeight: height > 0 ? height : null,
    sourceDurationFrames: duration > 0 ? duration : null,
  };
}

function richerDescriptor(
  current: FileDescriptor | undefined,
  candidate: FileDescriptor
): FileDescriptor {
  if (!current) return candidate;
  return {
    fileId: current.fileId || candidate.fileId,
    name: current.name !== "未命名素材" ? current.name : candidate.name,
    pathUrl: current.pathUrl || candidate.pathUrl,
    mediaKind:
      current.mediaKind !== "unknown" ? current.mediaKind : candidate.mediaKind,
    sourceWidth: current.sourceWidth || candidate.sourceWidth,
    sourceHeight: current.sourceHeight || candidate.sourceHeight,
    sourceDurationFrames:
      current.sourceDurationFrames || candidate.sourceDurationFrames,
  };
}

function clipNodesFromTrack(track: XmlRecord): XmlRecord[] {
  return asArray(track.clipitem).map(asRecord);
}

function buildFileRegistry(
  trackGroups: XmlRecord[][]
): Map<string, FileDescriptor> {
  const registry = new Map<string, FileDescriptor>();
  for (const tracks of trackGroups) {
    for (const track of tracks) {
      for (const clip of clipNodesFromTrack(track)) {
        const file = firstRecord(clip.file);
        const descriptor = descriptorFromFile(file);
        if (!descriptor.fileId) continue;
        registry.set(
          descriptor.fileId,
          richerDescriptor(registry.get(descriptor.fileId), descriptor)
        );
      }
    }
  }
  return registry;
}

function parseClip(
  clip: XmlRecord,
  trackIndex: number,
  registry: Map<string, FileDescriptor>,
  fallbackFps: number
): ChatCutClip {
  const file = firstRecord(clip.file);
  const inlineDescriptor = descriptorFromFile(file);
  const descriptor = inlineDescriptor.fileId
    ? richerDescriptor(registry.get(inlineDescriptor.fileId), inlineDescriptor)
    : inlineDescriptor;
  const clipName = textValue(clip.name);
  const name =
    clipName ||
    descriptor.name ||
    (descriptor.pathUrl ? decodePathName(descriptor.pathUrl) : "未命名素材");
  const startFrame = finiteInteger(clip.start, 0);
  const endFrame = Math.max(startFrame, finiteInteger(clip.end, startFrame));
  const inFrame = finiteInteger(clip.in, 0);
  const outFrame = Math.max(inFrame, finiteInteger(clip.out, inFrame));
  const clipRate = firstRecord(clip.rate);
  const clipFps = finiteNumber(clipRate.timebase, fallbackFps);
  const effects = parseEffects(clip);

  return {
    id: textValue(clip["@_id"]) || `track-${trackIndex}-${startFrame}`,
    trackIndex,
    name,
    fileId: descriptor.fileId,
    pathUrl: descriptor.pathUrl,
    mediaKind:
      descriptor.mediaKind === "unknown"
        ? mediaKindFromName(name)
        : descriptor.mediaKind,
    sourceWidth: descriptor.sourceWidth,
    sourceHeight: descriptor.sourceHeight,
    sourceDurationFrames: descriptor.sourceDurationFrames,
    startFrame,
    endFrame,
    inFrame,
    outFrame,
    transform: effects.transform,
    timeRemap:
      effects.timeRemap && clipFps > 0 ? effects.timeRemap : effects.timeRemap,
    linkedClipIds: asArray(clip.link)
      .map(rawLink => textValue(asRecord(rawLink).linkclipref))
      .filter(Boolean),
  };
}

function parseTransition(
  rawTransition: unknown,
  trackIndex: number
): ChatCutTransition {
  const transition = asRecord(rawTransition);
  const effect = firstRecord(transition.effect);
  return {
    trackIndex,
    startFrame: finiteInteger(transition.start, 0),
    endFrame: finiteInteger(transition.end, 0),
    name: textValue(effect.name) || textValue(effect.effectid) || "转场",
    alignment: textValue(transition.alignment) || null,
  };
}

function parseTracks(
  rawTracks: XmlRecord[],
  registry: Map<string, FileDescriptor>,
  fallbackFps: number
): ChatCutTrack[] {
  return rawTracks.map((track, index) => ({
    index: index + 1,
    clips: clipNodesFromTrack(track)
      .map(clip => parseClip(clip, index + 1, registry, fallbackFps))
      .filter(clip => clip.endFrame > clip.startFrame)
      .sort((left, right) =>
        left.startFrame === right.startFrame
          ? left.endFrame - right.endFrame
          : left.startFrame - right.startFrame
      ),
    transitions: asArray(track.transitionitem).map(transition =>
      parseTransition(transition, index + 1)
    ),
  }));
}

function selectPrimaryVideoTrack(tracks: ChatCutTrack[]): ChatCutTrack | null {
  return (
    [...tracks]
      .filter(track => track.clips.length > 0)
      .sort((left, right) => {
        if (left.clips.length !== right.clips.length) {
          return right.clips.length - left.clips.length;
        }
        const leftCoverage = left.clips.reduce(
          (total, clip) => total + clip.endFrame - clip.startFrame,
          0
        );
        const rightCoverage = right.clips.reduce(
          (total, clip) => total + clip.endFrame - clip.startFrame,
          0
        );
        return rightCoverage - leftCoverage || right.index - left.index;
      })[0] ?? null
  );
}

export function parseChatCutXml(xml: string): ChatCutImportPlan {
  if (Buffer.byteLength(xml, "utf8") > MAX_CHATCUT_XML_BYTES) {
    throw new Error("XML 文件过大，请控制在 2MB 以内");
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error("XML 包含不允许的外部实体声明");
  }
  const validation = XMLValidator.validate(xml, {
    allowBooleanAttributes: false,
  });
  if (validation !== true) {
    throw new Error(`XML 格式无效：${validation.err.msg}`);
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: true,
    processEntities: { enabled: false },
    maxNestedTags: 160,
  });
  const document = asRecord(parser.parse(xml));
  const xmeml = firstRecord(document.xmeml);
  if (!Object.keys(xmeml).length) {
    throw new Error("这不是 ChatCut / Premiere XMEML 工程文件");
  }
  const project = firstRecord(xmeml.project);
  const sequence = firstRecord(
    project.children ? firstRecord(project.children).sequence : xmeml.sequence
  );
  if (!Object.keys(sequence).length) {
    throw new Error("XML 中没有可导入的 sequence");
  }

  const rate = firstRecord(sequence.rate);
  const fps = finiteNumber(rate.timebase, 30);
  if (fps <= 0 || fps > 240) {
    throw new Error("XML 的时间基准无效");
  }
  const media = firstRecord(sequence.media);
  const video = firstRecord(media.video);
  const audio = firstRecord(media.audio);
  const rawVideoTracks = asArray(video.track).map(asRecord);
  const rawAudioTracks = asArray(audio.track).map(asRecord);
  const registry = buildFileRegistry([rawVideoTracks, rawAudioTracks]);
  const videoTracks = parseTracks(rawVideoTracks, registry, fps);
  const audioTracks = parseTracks(rawAudioTracks, registry, fps);
  const primaryTrack = selectPrimaryVideoTrack(videoTracks);
  if (!primaryTrack) {
    throw new Error("XML 中没有可导入的视频片段");
  }
  const characteristics = firstRecord(
    firstRecord(firstRecord(video.format).samplecharacteristics)
  );
  const width = finiteInteger(characteristics.width, 0);
  const height = finiteInteger(characteristics.height, 0);
  const maxEndFrame = Math.max(
    0,
    ...videoTracks.flatMap(track => track.clips.map(clip => clip.endFrame))
  );
  const durationFrames = Math.max(
    finiteInteger(sequence.duration, 0),
    maxEndFrame
  );
  if (durationFrames <= 0 || width <= 0 || height <= 0) {
    throw new Error("XML 缺少有效的时长或画布尺寸");
  }

  const mediaFilesByKey = new Map<
    string,
    ChatCutImportPlan["mediaFiles"][number]
  >();
  for (const track of [...videoTracks, ...audioTracks]) {
    for (const clip of track.clips) {
      const key = clip.fileId || `${clip.mediaKind}:${clip.name}`;
      if (!mediaFilesByKey.has(key)) {
        mediaFilesByKey.set(key, {
          fileId: clip.fileId,
          name: clip.name,
          pathUrl: clip.pathUrl,
          mediaKind: clip.mediaKind,
          sourceWidth: clip.sourceWidth,
          sourceHeight: clip.sourceHeight,
        });
      }
    }
  }

  return {
    schemaVersion: 1,
    sourceFormat: "xmeml",
    projectName:
      textValue(project.name) || textValue(sequence.name) || "ChatCut 工程",
    sequenceName:
      textValue(sequence.name) || textValue(project.name) || "ChatCut 时间轴",
    durationFrames,
    fps,
    width,
    height,
    primaryVideoTrackIndex: primaryTrack.index,
    videoTracks,
    audioTracks,
    mediaFiles: Array.from(mediaFilesByKey.values()).sort((left, right) =>
      left.name.localeCompare(right.name, "zh-CN")
    ),
    importedCapabilities: {
      exactTiming: true,
      sourceInOut: true,
      cropAndTransform: true,
      timeRemap: true,
      audioManifest: true,
      multiTrackManifest: true,
      mediaRelinkRequired: true,
    },
  };
}

export function summarizeChatCutImport(
  plan: ChatCutImportPlan
): ChatCutImportSummary {
  const primaryTrack = plan.videoTracks.find(
    track => track.index === plan.primaryVideoTrackIndex
  );
  return {
    projectName: plan.projectName,
    sequenceName: plan.sequenceName,
    durationFrames: plan.durationFrames,
    durationMs: Math.round((plan.durationFrames / plan.fps) * 1000),
    fps: plan.fps,
    width: plan.width,
    height: plan.height,
    primaryVideoTrackIndex: plan.primaryVideoTrackIndex,
    videoTrackCount: plan.videoTracks.length,
    audioTrackCount: plan.audioTracks.length,
    primaryClipCount: primaryTrack?.clips.length ?? 0,
    videoClipCount: plan.videoTracks.reduce(
      (total, track) => total + track.clips.length,
      0
    ),
    audioClipCount: plan.audioTracks.reduce(
      (total, track) => total + track.clips.length,
      0
    ),
    transitionCount: [...plan.videoTracks, ...plan.audioTracks].reduce(
      (total, track) => total + track.transitions.length,
      0
    ),
    mediaFileCount: plan.mediaFiles.length,
    mediaFiles: plan.mediaFiles.map(file => file.name),
    requiresMediaRelink: true,
  };
}

function safeShotIdentity(
  sequenceName: string,
  clip: ChatCutClip,
  index: number
) {
  const slug = sequenceName
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 36);
  const clipPart = clip.id
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `chatcut-${slug || "sequence"}-${clipPart || `clip-${index + 1}`}`.slice(
    0,
    128
  );
}

function frameSeconds(frame: number, fps: number): string {
  return (frame / fps).toFixed(2);
}

function timelineTransformOf(
  clip: ChatCutClip
): StoryTimelineItem["transform"] {
  const left = clamp(clip.transform.cropLeft / 100, 0, 0.99);
  const right = clamp(clip.transform.cropRight / 100, 0, 0.99);
  const top = clamp(clip.transform.cropTop / 100, 0, 0.99);
  const bottom = clamp(clip.transform.cropBottom / 100, 0, 0.99);
  return {
    cropX: left,
    cropY: top,
    cropWidth: clamp(1 - left - right, 0.01, 1),
    cropHeight: clamp(1 - top - bottom, 0.01, 1),
    zoom: clamp(clip.transform.scalePercent / 100, 1, 8),
    panX: clamp(clip.transform.centerX, -1, 1),
    panY: clamp(clip.transform.centerY, -1, 1),
  };
}

function cameraMoveOf(clip: ChatCutClip): string {
  const moves: string[] = [];
  if (clip.timeRemap?.reverse) moves.push("倒放");
  if (clip.timeRemap && Math.abs(clip.timeRemap.speedPercent - 100) > 0.5) {
    moves.push(`${(clip.timeRemap.speedPercent / 100).toFixed(2)} 倍速`);
  }
  if (Math.abs(clip.transform.centerX) > 0.001) moves.push("水平平移");
  if (Math.abs(clip.transform.centerY) > 0.001) moves.push("垂直平移");
  if (clip.transform.scalePercent > 100.5) moves.push("放大构图");
  if (clip.transform.scalePercent < 99.5) moves.push("缩小构图");
  return moves.join(" · ") || "保持原镜头运动";
}

function overlapsAudio(plan: ChatCutImportPlan, clip: ChatCutClip): string[] {
  return Array.from(
    new Set(
      plan.audioTracks.flatMap(track =>
        track.clips
          .filter(
            audio =>
              audio.startFrame < clip.endFrame &&
              audio.endFrame > clip.startFrame
          )
          .map(audio => audio.name)
      )
    )
  );
}

function overlappingVideoLayers(
  plan: ChatCutImportPlan,
  clip: ChatCutClip
): ChatCutClip[] {
  return plan.videoTracks.flatMap(track =>
    track.index === plan.primaryVideoTrackIndex
      ? []
      : track.clips.filter(
          layer =>
            layer.startFrame < clip.endFrame && layer.endFrame > clip.startFrame
        )
  );
}

export function buildChatCutStoryPayload(plan: ChatCutImportPlan) {
  const primaryTrack = plan.videoTracks.find(
    track => track.index === plan.primaryVideoTrackIndex
  );
  if (!primaryTrack) throw new Error("主视频轨不存在");

  const clips = [...primaryTrack.clips].sort(
    (left, right) => left.startFrame - right.startFrame
  );
  const shots = clips.map((clip, index) => {
    const stableShotId = safeShotIdentity(plan.sequenceName, clip, index);
    const audioNames = overlapsAudio(plan, clip);
    const layers = overlappingVideoLayers(plan, clip);
    const crop = clip.transform;
    const cropSummary =
      crop.cropLeft || crop.cropRight || crop.cropTop || crop.cropBottom
        ? `；裁剪 L${crop.cropLeft.toFixed(1)} R${crop.cropRight.toFixed(1)} T${crop.cropTop.toFixed(1)} B${crop.cropBottom.toFixed(1)}`
        : "";
    const layerSummary =
      layers.length > 0
        ? `；并行图层：${layers.map(layer => `V${layer.trackIndex} ${layer.name}`).join("、")}`
        : "";
    const sourceIn = frameSeconds(clip.inFrame, plan.fps);
    const sourceOut = frameSeconds(clip.outFrame, plan.fps);
    const timelineIn = frameSeconds(clip.startFrame, plan.fps);
    const timelineOut = frameSeconds(clip.endFrame, plan.fps);
    const isLast = index === clips.length - 1;
    const tailFrames = isLast
      ? Math.max(0, plan.durationFrames - clip.endFrame)
      : 0;
    const durationMs = Math.max(
      100,
      Math.round(
        ((clip.endFrame - clip.startFrame + tailFrames) / plan.fps) * 1000
      )
    );
    return {
      stableShotId,
      shotIdentity: stableShotId,
      shotNo: index + 1,
      cueCode: `SH${String(index + 1).padStart(2, "0")}`,
      durationMs,
      sceneNo: `V${plan.primaryVideoTrackIndex}`,
      sceneTitle: plan.sequenceName,
      sceneArtBrief: `${plan.width}×${plan.height} @ ${plan.fps}fps`,
      subject: clip.name.replace(/\.[^.]+$/, "") || `镜头 ${index + 1}`,
      action: `使用素材 ${clip.name}`,
      dialogue: "",
      shotType: clip.mediaKind === "image" ? "静帧" : "视频",
      beat: index === 0 ? "开场" : index === clips.length - 1 ? "收束" : "推进",
      cameraAngle: "沿用源素材",
      cameraMove: cameraMoveOf(clip),
      location: plan.sequenceName,
      timeLight: "沿用源素材",
      mood: "沿用源素材",
      sound: audioNames.join("、"),
      styleRef: "ChatCut 原工程",
      note: `ChatCut XML ${clip.id}｜V${clip.trackIndex}｜源 ${sourceIn}-${sourceOut}s｜轴 ${timelineIn}-${timelineOut}s｜缩放 ${clip.transform.scalePercent.toFixed(1)}%${cropSummary}${layerSummary}｜待重新关联素材`,
      emotion: "未标",
      sourceCardContent: `导入自 ${plan.projectName}`,
      intent: "忠实复现 ChatCut 时间轴并继续编辑",
      rationale: "保留源片段时序、入出点、画面变换与关联音频清单",
      videoStart: `源入点 ${sourceIn}s`,
      videoEnd: `源出点 ${sourceOut}s`,
      transitionIn: "按 ChatCut XML 清单",
      transitionOut: "按 ChatCut XML 清单",
      videoPrompt: "仅关联原素材，不生成或改写画面内容",
      emotionCharge: "",
      emotionDelta: "",
      visualAnchorText: "",
      negativePrompt: "",
      chatCutMapping: {
        projectId: plan.projectName,
        sequenceId: plan.sequenceName,
        itemId: clip.id,
        assetId: clip.fileId ?? undefined,
      },
    };
  });

  const timelineItems: StoryTimelineItem[] = clips.map((clip, index) => {
    return {
      stableShotId: shots[index].stableShotId,
      included: true,
      position: index,
      plannedDurationMs: shots[index].durationMs,
      transform: timelineTransformOf(clip),
    };
  });

  const body = prepareStoryBody(
    {
      cards: [],
      characters: [],
      shots,
      scenes: [
        {
          sceneNo: `V${plan.primaryVideoTrackIndex}`,
          title: plan.sequenceName,
          artBrief: `${plan.width}×${plan.height} @ ${plan.fps}fps；从 ChatCut XML 主视频轨导入`,
          shotRange: shots.length
            ? `SH01-SH${String(shots.length).padStart(2, "0")}`
            : "",
        },
      ],
      chatCutImport: {
        ...plan,
        importedAt: new Date().toISOString(),
        relinkStatus: "required",
      },
    },
    1
  );

  return { body, shots, timelineItems };
}

export async function importChatCutXmlStory(input: {
  xml: string;
  userId: number;
  title?: string;
}) {
  const plan = parseChatCutXml(input.xml);
  const summary = summarizeChatCutImport(plan);
  const payload = buildChatCutStoryPayload(plan);
  const title = input.title?.trim().slice(0, 255) || plan.sequenceName;
  const durationSec = (summary.durationMs / 1000).toFixed(1);
  const { id } = await createStory({
    userId: input.userId,
    projectId: null,
    title,
    logline: `从 ChatCut XML 导入：${durationSec} 秒，${plan.width}×${plan.height}@${plan.fps}fps，${summary.primaryClipCount} 个主轨镜头。`,
    theme: "ChatCut XML 导入",
    arc: "保留原工程时间轴，可在聊聊继续剪辑",
    summary: `多轨、入出点、缩放、裁剪、变速和音频清单已保留；${summary.mediaFileCount} 个素材文件待重新关联。`,
    body: payload.body,
  });

  try {
    await migrateStoryPromptLineage({
      storyId: id,
      userId: input.userId,
      source: "initial",
      body: payload.body,
    });
    const timeline = await updateStoryTimeline({
      storyId: id,
      userId: input.userId,
      expectedVersion: 0,
      items: payload.timelineItems,
    });
    const story = await getStoryById(id, input.userId);
    if (!story) throw new Error("导入后的故事无法读取");
    return { story, timeline, plan, summary };
  } catch (error) {
    await deleteStory(id, input.userId);
    throw error;
  }
}

function attachmentShotId(
  shot: XmlRecord,
  fallbackShot: XmlRecord,
  index: number
): string {
  for (const value of [
    shot.stableShotId,
    shot.shotIdentity,
    fallbackShot.stableShotId,
    fallbackShot.shotIdentity,
  ]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return `chatcut-shot-${String(index + 1).padStart(4, "0")}`;
}

function attachmentCueCode(shot: XmlRecord): string | null {
  if (typeof shot.cueCode === "string" && shot.cueCode.trim()) {
    return shot.cueCode.trim();
  }
  return null;
}

function voiceCueCode(name: string): string | null {
  return name.match(/(?:^|\b)VO[-_ ]?(\d{4}(?:-\d)?)/i)?.[1] ?? null;
}

function mediaBaseName(value: string): string {
  const leaf = value.split(/[\\/]/).pop() ?? value;
  try {
    return decodeURIComponent(leaf).trim().toLocaleLowerCase();
  } catch {
    return leaf.trim().toLocaleLowerCase();
  }
}

function existingAudioUrls(body: XmlRecord): Map<string, string> {
  const imported = asRecord(body.chatCutImport);
  const tracks = Array.isArray(imported.audioTracks)
    ? imported.audioTracks.map(asRecord)
    : [];
  const urls = new Map<string, string>();
  for (const track of tracks) {
    const clips = Array.isArray(track.clips) ? track.clips.map(asRecord) : [];
    for (const clip of clips) {
      const name = typeof clip.name === "string" ? clip.name.trim() : "";
      const audioUrl =
        typeof clip.audioUrl === "string" ? clip.audioUrl.trim() : "";
      if (name && audioUrl) urls.set(mediaBaseName(name), audioUrl);
    }
  }
  return urls;
}

function existingPlaybackAudioTrackIndexes(body: XmlRecord): number[] {
  const imported = asRecord(body.chatCutImport);
  if (!Array.isArray(imported.playbackAudioTrackIndexes)) return [];
  return Array.from(
    new Set(
      imported.playbackAudioTrackIndexes
        .map(value => Number(value))
        .filter(value => Number.isInteger(value) && value > 0)
    )
  );
}

type AttachmentScriptCue = {
  code: string;
  text: string;
  startFrame: number | null;
  endFrame: number | null;
};

function existingScriptCues(body: XmlRecord): AttachmentScriptCue[] {
  const imported = asRecord(body.chatCutImport);
  const cues = Array.isArray(imported.scriptCues)
    ? imported.scriptCues.map(asRecord)
    : [];
  return cues.flatMap(cue => {
    const code = typeof cue.code === "string" ? cue.code.trim() : "";
    const text = typeof cue.text === "string" ? cue.text.trim() : "";
    if (!code || !text) return [];
    return [{ code, text, startFrame: null, endFrame: null }];
  });
}

function cueTextsInVoiceOrder(
  cues: AttachmentScriptCue[],
  targetCount: number
): { texts: string[]; normalized: boolean } {
  const rawTexts = cues.map(cue => cue.text);
  const normalizedTexts: string[] = [];
  for (const text of rawTexts) {
    for (const part of text
      .split(/\r?\n+/)
      .map(value => value.trim())
      .filter(Boolean)) {
      const previous = normalizedTexts.at(-1);
      if (
        previous &&
        previous.replace(/\s+/g, "") === part.replace(/\s+/g, "")
      ) {
        continue;
      }
      normalizedTexts.push(part);
    }
  }
  const normalized =
    normalizedTexts.length === targetCount &&
    normalizedTexts.some((text, index) => text !== rawTexts[index]);
  return {
    texts: normalized ? normalizedTexts : rawTexts,
    normalized,
  };
}

function scriptCuesForAttachment(
  existingBody: XmlRecord,
  mergedShots: XmlRecord[],
  voiceTimingByCode: Map<string, { startFrame: number; endFrame: number }>
): AttachmentScriptCue[] {
  const semanticCues = mergedShots.flatMap(shot => {
    const code = attachmentCueCode(shot);
    const text = typeof shot.dialogue === "string" ? shot.dialogue.trim() : "";
    return code && text
      ? [{ code, text, startFrame: null, endFrame: null }]
      : [];
  });
  if (voiceTimingByCode.size === 0) return semanticCues;

  const previousCues = existingScriptCues(existingBody);
  const orderedFallbacks =
    previousCues.length > 0 ? previousCues : semanticCues;
  const fallback = cueTextsInVoiceOrder(
    orderedFallbacks,
    voiceTimingByCode.size
  );
  const textByCode = new Map<string, string>();
  for (const cue of [...semanticCues, ...previousCues]) {
    textByCode.set(cue.code, cue.text);
  }

  return Array.from(voiceTimingByCode.entries())
    .sort(
      ([, left], [, right]) =>
        left.startFrame - right.startFrame || left.endFrame - right.endFrame
    )
    .flatMap(([code, timing], index) => {
      const orderedText = fallback.texts[index] ?? "";
      const text = fallback.normalized
        ? orderedText || textByCode.get(code) || ""
        : textByCode.get(code) || orderedText;
      if (!text) return [];
      return [{ code, text, ...timing }];
    });
}

/**
 * Attach a ChatCut timeline to the current semantic story. The XML owns timing,
 * transforms and audio manifests; the story keeps its stable shot identities,
 * dialogue, prompts and generation history.
 */
export async function attachChatCutXmlToStory(input: {
  xml: string;
  storyId: number;
  userId: number;
}) {
  const story = await getStoryById(input.storyId, input.userId);
  if (!story) throw new Error("故事不存在或无权操作");

  const plan = parseChatCutXml(input.xml);
  const summary = summarizeChatCutImport(plan);
  const imported = buildChatCutStoryPayload(plan);
  const existingBody = asRecord(story.body);
  const previousAudioUrls = existingAudioUrls(existingBody);
  const availableAudioTrackIndexes = new Set(
    plan.audioTracks.map(track => track.index)
  );
  const playbackAudioTrackIndexes = existingPlaybackAudioTrackIndexes(
    existingBody
  ).filter(index => availableAudioTrackIndexes.has(index));
  const attachedPlan: ChatCutImportPlan = {
    ...plan,
    audioTracks: plan.audioTracks.map(track => ({
      ...track,
      clips: track.clips.map(clip => ({
        ...clip,
        audioUrl:
          previousAudioUrls.get(mediaBaseName(clip.name)) ??
          clip.audioUrl ??
          null,
      })),
    })),
  };
  const existingShots = Array.isArray(existingBody.shots)
    ? existingBody.shots.map(asRecord)
    : [];
  const importedShots = imported.shots.map(asRecord);
  const shotCount = Math.max(existingShots.length, importedShots.length);
  const mergedShots = Array.from({ length: shotCount }, (_, index) => {
    const existingShot = existingShots[index] ?? {};
    const importedShot = importedShots[index] ?? {};
    const stableShotId = attachmentShotId(existingShot, importedShot, index);
    const merged: XmlRecord = {
      ...importedShot,
      ...existingShot,
      stableShotId,
      shotIdentity: stableShotId,
      shotNo: index + 1,
    };
    if (typeof importedShot.durationMs === "number") {
      merged.durationMs = importedShot.durationMs;
    }
    if (importedShot.chatCutMapping) {
      merged.chatCutMapping = importedShot.chatCutMapping;
    }
    if (
      (!merged.sound || String(merged.sound).trim() === "") &&
      importedShot.sound
    ) {
      merged.sound = importedShot.sound;
    }
    return merged;
  });

  const voiceTimingByCode = new Map<
    string,
    { startFrame: number; endFrame: number }
  >();
  for (const clip of attachedPlan.audioTracks.flatMap(track => track.clips)) {
    const code = voiceCueCode(clip.name);
    if (!code || voiceTimingByCode.has(code)) continue;
    voiceTimingByCode.set(code, {
      startFrame: clip.startFrame,
      endFrame: clip.endFrame,
    });
  }
  const scriptCues = scriptCuesForAttachment(
    existingBody,
    mergedShots,
    voiceTimingByCode
  );
  const nextBody = prepareStoryBody(
    {
      ...existingBody,
      shots: mergedShots,
      chatCutImport: {
        ...attachedPlan,
        ...(playbackAudioTrackIndexes.length > 0
          ? { playbackAudioTrackIndexes }
          : {}),
        scriptCues,
        importedAt: new Date().toISOString(),
        relinkStatus: "required",
      },
    },
    getStoryRevision(story.body) + 1,
    story.body
  );

  const currentTimeline = await getStoryTimeline(input.storyId, input.userId);
  const currentItems = Array.isArray(currentTimeline?.items)
    ? currentTimeline.items.map(asRecord)
    : [];
  const timelineItems = mergedShots.map((shot, index) => {
    const importedItem = asRecord(imported.timelineItems[index]);
    const currentItem = currentItems[index] ?? {};
    const durationMs =
      typeof shot.durationMs === "number" ? shot.durationMs : 3000;
    return {
      ...currentItem,
      ...importedItem,
      stableShotId: String(shot.stableShotId),
      included: true,
      position: index,
      plannedDurationMs: durationMs,
      transform: importedItem.transform ??
        currentItem.transform ?? {
          cropX: 0,
          cropY: 0,
          cropWidth: 1,
          cropHeight: 1,
          zoom: 1,
          panX: 0,
          panY: 0,
        },
    };
  });

  const timeline = await updateStoryTimeline({
    storyId: input.storyId,
    userId: input.userId,
    expectedVersion: currentTimeline?.version ?? 0,
    items: timelineItems,
  });
  await updateStory(input.storyId, input.userId, { body: nextBody });
  const updatedStory = await getStoryById(input.storyId, input.userId);
  if (!updatedStory) throw new Error("ChatCut 时间线已解析，但故事保存失败");
  return { story: updatedStory, timeline, plan: attachedPlan, summary };
}
