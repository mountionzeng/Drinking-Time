import fs from "node:fs/promises";

import type {
  ShotContinuityRisk,
  ShotDirectorAnalysis,
  ShotDirectorReferenceFrame,
  ShotDirectorResult,
} from "../../shared/shotDirector";
import { parseStartEndVideoConfig } from "../../shared/startEndVideo";
import {
  normalizeShotIdentity,
  shotIdentityFromShot,
} from "../../shared/shotIdentity";
import {
  VIDEO_VISUAL_FIDELITY_CLAUSE_EN,
  VIDEO_VISUAL_FIDELITY_CLAUSE_ZH,
} from "../../shared/videoMotionPolicy";
import { getStoryById } from "../db";
import { getStoryImageAssets, materializeImageInput } from "./imageAssets";
import { getStoryMaterialState } from "./storyMaterials";
import {
  directVideoPrompt,
  type VideoPromptAnalysis,
  type VideoPromptDirectorResult,
  type VideoPromptShotContext,
} from "./videoPromptDirector";
import { compileVideoPromptEngineering } from "./videoPromptEngineering";
import { getShotVideoProviderStatus } from "./videoGen";
import { sanitizeVideoPrompt } from "./videoJobs";
import { storyVideoContext } from "./videoShotContext";
import { renderTransitionVideoFrame } from "./videoEndpointFrames";
import {
  transitionEndpointForShot,
  type TimelineTransitionEndpoint,
} from "./timelineEditAgent";

type ShotRecord = Record<string, unknown>;

function record(value: unknown): ShotRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ShotRecord)
    : {};
}

function string(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function storyShotRecords(body: unknown): ShotRecord[] {
  const shots = record(body).shots;
  return Array.isArray(shots)
    ? shots.filter(
        (shot): shot is ShotRecord =>
          Boolean(shot) && typeof shot === "object" && !Array.isArray(shot)
      )
    : [];
}

function stableId(shot: ShotRecord, index: number): string {
  return shotIdentityFromShot(shot, index) ?? `legacy-sh${index + 1}`;
}

function contextValue(
  shot: VideoPromptShotContext | undefined,
  key: keyof VideoPromptShotContext
): string {
  const value = shot?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function heuristicCameraRig(current?: VideoPromptShotContext): string {
  const movement = [
    contextValue(current, "cameraMove"),
    contextValue(current, "cameraPath"),
  ].join(" ");
  if (/手持|handheld|肩扛|shoulder/i.test(movement)) {
    return "受控手持或轻型肩扛：只保留低频、低幅度的呼吸感位移，水平线基本稳定；人物动作起势后再轻微响应，并在结束画面前收稳。";
  }
  if (/跟|追|随|tracking|follow|orbit|环绕|侧移|横移/i.test(movement)) {
    return "三轴稳定器或短滑轨/摄影车：保持运动路径可重复，避免漂浮感；根据主体速度启动和减速。";
  }
  if (/摇|俯仰|pan|tilt/i.test(movement)) {
    return "三脚架配液压云台：机位不漂移，只执行受控的摇摄或俯仰，并在动作终点锁住构图。";
  }
  if (/升|降|crane|jib|boom/i.test(movement)) {
    return "小型摇臂或稳定升降支撑：沿单一垂直弧线运动，速度前缓、中稳、后缓，避免同时无理由推拉。";
  }
  if (/推|拉|dolly|slider|zoom/i.test(movement)) {
    return "短滑轨或小型摄影车：使用真实的前后位移产生视差，不用数码缩放冒充运镜，起止都做缓入缓出。";
  }
  return "锁定三脚架为基准；只有人物动作需要强调时才加入一次短滑轨或云台响应，不做持续漂移。";
}

function heuristicMotionTimeline(
  current?: VideoPromptShotContext,
  next?: VideoPromptShotContext
): string {
  const start = contextValue(current, "videoStart") || "锁住首帧构图";
  const action =
    contextValue(current, "action") ||
    contextValue(current, "subjectPath") ||
    "主体完成一个最小、可见且符合物理的动作";
  const end =
    contextValue(current, "videoEnd") ||
    contextValue(next, "videoStart") ||
    "动作与摄影机同时减速，在可接下一镜的状态停住";
  return `起势 0-25%：${start}；中段 25-75%：${action}，摄影机只在动作产生后作一次有动机的响应；收束 75-100%：${end}。`;
}

function heuristicAnalysis(input: {
  current?: VideoPromptShotContext;
  previous?: VideoPromptShotContext;
  next?: VideoPromptShotContext;
}): ShotDirectorAnalysis {
  const current = input.current;
  const previous = input.previous;
  const next = input.next;
  const currentSubject = contextValue(current, "subject") || "当前主体";
  const currentAction = contextValue(current, "action");
  const currentLocation = contextValue(current, "timeLight");
  const previousLocation = contextValue(previous, "timeLight");
  const risks: ShotContinuityRisk[] = [];
  if (
    contextValue(previous, "shotType") &&
    contextValue(previous, "shotType") === contextValue(current, "shotType") &&
    contextValue(previous, "cameraAngle") ===
      contextValue(current, "cameraAngle")
  ) {
    risks.push({
      kind: "jump-cut",
      detail: "前后景别和机位接近，若动作幅度也相近，直接切换容易形成跳切。",
    });
  }
  if (
    previousLocation &&
    currentLocation &&
    previousLocation !== currentLocation &&
    !contextValue(current, "transitionIn")
  ) {
    risks.push({
      kind: "space",
      detail:
        "相邻镜头的光线或空间描述变化明显，需要建立镜头或声音桥交代位置变化。",
    });
  }
  if (!currentAction) {
    risks.push({
      kind: "action",
      detail: "当前镜头尚未写明可执行动作，图生视频容易只产生无目的漂移。",
    });
  }
  if (risks.length === 0) {
    risks.push({
      kind: "none",
      detail: "文字层面未发现明确连续性冲突，仍需以首尾帧复核。",
    });
  }

  const shotScale = [
    contextValue(previous, "shotType") || "前镜未标",
    contextValue(current, "shotType") || "本镜未标",
    contextValue(next, "shotType") || "后镜未标",
  ].join(" → ");
  const transitionStrategy =
    contextValue(current, "transitionIntent") ||
    contextValue(current, "transitionIn") ||
    contextValue(current, "transitionOut") ||
    (risks.some(risk => risk.kind === "jump-cut")
      ? "用动作匹配或遮挡切避开同机位跳切"
      : "保持动作方向后硬切，让节奏承担转场");

  return {
    visualSummary: `当前缺少可供视觉模型读取的首尾帧，先依据镜头表分析 ${currentSubject}。`,
    narrativeIntent:
      contextValue(current, "intent") || "让当前动作服务这一句台词的叙事节拍。",
    subjectPosition: "需要结合当前首帧确认主体在画面中的具体位置。",
    facingGazeDirection:
      contextValue(current, "subjectPath") ||
      "需要结合首帧确认朝向、视线与运动方向。",
    shotScaleChange: shotScale,
    lightColorMaterial:
      [
        contextValue(current, "timeLight"),
        contextValue(current, "lighting"),
        contextValue(current, "colorPalette"),
        contextValue(current, "materialTexture"),
      ]
        .filter(Boolean)
        .join("；") || "光线、色温、饱和度和材质尚待补充。",
    actionContinuity:
      [
        contextValue(previous, "videoEnd"),
        contextValue(current, "videoStart"),
        contextValue(current, "action"),
      ]
        .filter(Boolean)
        .join(" → ") || "尚未形成可接续的动作链。",
    continuity:
      [
        contextValue(previous, "transitionOut"),
        contextValue(current, "transitionIn"),
        contextValue(current, "transitionOut"),
      ]
        .filter(Boolean)
        .join("；") || "相邻镜头的进入和退出关系尚待明确。",
    transitionStrategy,
    subjectMotion:
      contextValue(current, "subjectPath") ||
      contextValue(current, "action") ||
      "Keep the visible subject still with only natural breathing.",
    cameraMotion:
      contextValue(current, "cameraPath") ||
      contextValue(current, "cameraMove") ||
      "Hold a stable frame with one restrained, motivated move.",
    cameraRig: heuristicCameraRig(current),
    motionTimeline: heuristicMotionTimeline(current, next),
    cameraSubjectCoordination:
      "人物动作承担叙事，摄影机稍后响应；除非镜头文字明确要求冲突感，镜头不与人物同时突然起动，也不在人物停下后继续无目的漂移。",
    preservationConstraints: VIDEO_VISUAL_FIDELITY_CLAUSE_ZH,
    risks,
    recommendedMotion: /快速|冲|跑|甩|剧烈|rapid|fast/i.test(
      [currentAction, contextValue(current, "cameraMove")].join(" ")
    )
      ? "high"
      : "low",
    confidence: 0.45,
  };
}

function mergeAnalysis(
  directed: VideoPromptAnalysis | null,
  fallback: ShotDirectorAnalysis
): ShotDirectorAnalysis {
  if (!directed) return fallback;
  const value = <K extends keyof ShotDirectorAnalysis>(key: K) =>
    directed[key] || fallback[key];
  return {
    visualSummary: value("visualSummary") as string,
    narrativeIntent: value("narrativeIntent") as string,
    subjectPosition: value("subjectPosition") as string,
    facingGazeDirection: value("facingGazeDirection") as string,
    shotScaleChange: value("shotScaleChange") as string,
    lightColorMaterial: value("lightColorMaterial") as string,
    actionContinuity: value("actionContinuity") as string,
    continuity: value("continuity") as string,
    transitionStrategy: value("transitionStrategy") as string,
    subjectMotion: value("subjectMotion") as string,
    cameraMotion: value("cameraMotion") as string,
    cameraRig: value("cameraRig") as string,
    motionTimeline: value("motionTimeline") as string,
    cameraSubjectCoordination: value("cameraSubjectCoordination") as string,
    preservationConstraints: value("preservationConstraints") as string,
    risks: directed.risks.length > 0 ? directed.risks : fallback.risks,
    recommendedMotion: directed.recommendedMotion,
    confidence: directed.confidence,
  };
}

async function endpointImageInput(
  endpoint: TimelineTransitionEndpoint | null,
  userId: number
): Promise<string | undefined> {
  if (!endpoint) return undefined;
  if (endpoint.mediaKind === "image") {
    return materializeImageInput(endpoint.imageUrl);
  }
  const frame = await renderTransitionVideoFrame({
    takeId: endpoint.videoTakeId,
    userId,
    rangeId: endpoint.rangeId,
    atSec: endpoint.atSec,
  });
  const bytes = await fs.readFile(frame.path);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

function previewFrame(
  endpoint: TimelineTransitionEndpoint | null,
  role: ShotDirectorReferenceFrame["role"]
): ShotDirectorReferenceFrame | null {
  if (!endpoint) return null;
  return {
    role,
    stableShotId: endpoint.stableShotId,
    shotNo: endpoint.shotNo,
    mediaKind: endpoint.mediaKind,
    imageUrl: endpoint.imageUrl,
    label:
      role === "previous-end"
        ? "前一镜尾帧"
        : role === "next-start"
          ? "后一镜首帧"
          : role === "current-end"
            ? "当前镜目标尾帧"
            : "当前镜首帧",
  };
}

export async function analyzeShotVideoDirection(
  input: {
    storyId: number;
    shotNo: number;
    stableShotId: string;
    draftPrompt: string;
    subtitle?: string;
  },
  userId: number
): Promise<ShotDirectorResult> {
  const [story, material, imageAssets] = await Promise.all([
    getStoryById(input.storyId, userId),
    getStoryMaterialState(input.storyId, userId),
    getStoryImageAssets(input.storyId, userId),
  ]);
  if (!story || !material) throw new Error("故事不存在或无权操作");

  const requestedId = normalizeShotIdentity(input.stableShotId);
  const records = storyShotRecords(story.body);
  const currentIndex = records.findIndex(
    (shot, index) => stableId(shot, index) === requestedId
  );
  if (currentIndex < 0) throw new Error("当前镜头不存在或稳定 ID 已变化");

  const currentId = stableId(records[currentIndex], currentIndex);
  const previousId =
    currentIndex > 0
      ? stableId(records[currentIndex - 1], currentIndex - 1)
      : null;
  const nextId =
    currentIndex + 1 < records.length
      ? stableId(records[currentIndex + 1], currentIndex + 1)
      : null;
  const byId = new Map(material.shots.map(shot => [shot.stableShotId, shot]));
  const itemById = new Map(
    material.timeline.items.map(item => [item.stableShotId, item])
  );
  const endpoint = (stableShotId: string | null, role: "start" | "end") => {
    if (!stableShotId) return null;
    const shot = byId.get(stableShotId);
    const item = itemById.get(stableShotId);
    return shot && item ? transitionEndpointForShot(shot, item, role) : null;
  };
  const previousEndpoint = endpoint(previousId, "end");
  const currentEndpoint = endpoint(currentId, "start");
  const nextEndpoint = endpoint(nextId, "start");
  const currentShot = records[currentIndex];
  const durationSec =
    typeof currentShot.durationMs === "number" &&
    Number.isFinite(currentShot.durationMs)
      ? currentShot.durationMs / 1_000
      : 5;
  const startEndConfig = parseStartEndVideoConfig(
    currentShot.generationParams,
    durationSec
  );
  const lockedFrameAsset = (imageId: number | undefined) => {
    if (imageId == null) return null;
    const asset = imageAssets.find(candidate => candidate.id === imageId);
    if (
      !asset ||
      asset.assignment !== "shot" ||
      asset.availability === "missing" ||
      (asset.shotIdentity && asset.shotIdentity !== currentId)
    ) {
      return null;
    }
    return asset;
  };
  const lockedStartFrame = lockedFrameAsset(startEndConfig?.firstFrameImageId);
  const lockedEndFrame = lockedFrameAsset(startEndConfig?.lastFrameImageId);
  const context = storyVideoContext(story.body, currentId, input.shotNo);
  const fallbackAnalysis = heuristicAnalysis({
    current: context.currentShot,
    previous: context.previousShot,
    next: context.nextShot,
  });
  const fallbackPrompt = sanitizeVideoPrompt(input.draftPrompt);
  const fallbackEngineering = compileVideoPromptEngineering({
    fallbackPrompt,
    shotNo: input.shotNo,
    cueCode: context.cueCode,
    draftPrompt: input.draftPrompt,
    subtitle: input.subtitle,
    currentShot: context.currentShot,
    previousShot: context.previousShot,
    nextShot: context.nextShot,
  });
  const provider = getShotVideoProviderStatus();

  let directed: VideoPromptDirectorResult = {
    prompt: fallbackEngineering.finalPrompt,
    source: "deterministic-fallback" as const,
    model: provider.promptDirectorModel,
    analysis: null as VideoPromptAnalysis | null,
    materialProfile: null,
    engineering: fallbackEngineering,
    fallbackReason: "当前镜头没有可分析的首帧或已采用视频",
  };
  const [currentImageInput, endImageInput, previousImageInput, nextImageInput] =
    await Promise.all([
      lockedStartFrame
        ? materializeImageInput(lockedStartFrame.imageUrl).catch(
            () => undefined
          )
        : endpointImageInput(currentEndpoint, userId).catch(() => undefined),
      lockedEndFrame
        ? materializeImageInput(lockedEndFrame.imageUrl).catch(() => undefined)
        : Promise.resolve(undefined),
      endpointImageInput(previousEndpoint, userId).catch(() => undefined),
      endpointImageInput(nextEndpoint, userId).catch(() => undefined),
    ]);
  if (currentImageInput) {
    directed = await directVideoPrompt({
      imageInput: currentImageInput,
      endImageInput,
      previousImageInput,
      nextImageInput,
      fallbackPrompt,
      shotNo: input.shotNo,
      draftPrompt: input.draftPrompt,
      subtitle: input.subtitle,
      storyTitle: story.title,
      ...context,
    });
  }
  const analysis = mergeAnalysis(directed.analysis, fallbackAnalysis);
  const lockedFramePreview = (
    role: "current-start" | "current-end",
    asset: typeof lockedStartFrame
  ): ShotDirectorReferenceFrame | null =>
    asset
      ? {
          role,
          stableShotId: currentId,
          shotNo: input.shotNo,
          mediaKind: "image",
          imageUrl: asset.imageUrl,
          label: role === "current-start" ? "当前镜首帧" : "当前镜目标尾帧",
        }
      : null;
  const referenceFrames = [
    previewFrame(previousEndpoint, "previous-end"),
    lockedFramePreview("current-start", lockedStartFrame) ??
      previewFrame(currentEndpoint, "current-start"),
    lockedFramePreview("current-end", lockedEndFrame),
    previewFrame(nextEndpoint, "next-start"),
  ].filter((frame): frame is ShotDirectorReferenceFrame => frame != null);

  return {
    source: directed.source,
    model: directed.model,
    prompt: directed.prompt,
    analysis,
    referenceFrames,
    fallbackReason: directed.fallbackReason,
    suggestedFields: {
      cameraMove:
        [analysis.cameraRig, analysis.cameraMotion]
          .filter(Boolean)
          .join("；") || string(currentShot.cameraMove),
      cameraPath: analysis.motionTimeline || string(currentShot.cameraPath),
      subjectPath:
        [analysis.subjectMotion, analysis.cameraSubjectCoordination]
          .filter(Boolean)
          .join("；") || string(currentShot.subjectPath),
      videoStart:
        string(currentShot.videoStart) ||
        `${string(currentShot.subject) || "主体"}保持当前构图，动作从静止状态开始。`,
      videoEnd:
        string(currentShot.videoEnd) ||
        `${string(currentShot.action) || "动作"}完成后停在可接下一镜的状态。`,
      transitionIn: analysis.transitionStrategy,
      transitionOut: string(currentShot.transitionOut) || analysis.continuity,
      transitionIntent: analysis.transitionStrategy,
      videoPrompt: directed.prompt,
      negativePrompt: [
        string(currentShot.negativePrompt),
        directed.materialProfile?.prohibitedDrift
          ? `Material drift forbidden: ${directed.materialProfile.prohibitedDrift}.`
          : "",
        VIDEO_VISUAL_FIDELITY_CLAUSE_EN,
      ]
        .filter(Boolean)
        .join(" "),
    },
  };
}
