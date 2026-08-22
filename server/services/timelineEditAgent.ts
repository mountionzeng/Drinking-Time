/**
 * 剪辑指令代理：把「把第三镜挪到最前面」「删掉第 5 镜」「第一镜改成 2 秒」
 * 这类自然语言变成结构化时间轴操作并落库（ChatCut 式对话驱动剪辑的执行层）。
 *
 * 契约要点：
 * - LLM 用【序号】定位镜头（上下文里给编号清单），不回显 stableShotId——
 *   序号几乎不会抄错，长 ID 会。服务端把序号映射回身份后再执行。
 * - 能落库的操作仍只有四类：move / remove / restore / setDuration（+整轴 reorder）。
 * - 两个相邻镜头的衔接/转场先返回带首尾帧的确认提案，不在这里调用视频模型，
 *   也不提前修改时间轴；付费生成和插入由调用方在用户确认后执行。
 * - 指令不是剪辑意图时返回 handled=false，调用方放行回普通聊聊聊天。
 */
import { createHash } from "node:crypto";
import { getStoryById, updateStoryTimeline } from "../db";
import type {
  ShotMaterialState,
  StoryTimelineItem,
  TimelineTransform,
  TimelineVideoEffects,
} from "../../shared/storyMaterial";
import {
  DEFAULT_TIMELINE_TRANSFORM,
  DEFAULT_TIMELINE_VIDEO_EFFECTS,
} from "../../shared/storyMaterial";
import { runJsonAgent } from "./agentRuntime";
import { getStoryMaterialState } from "./storyMaterials";
import { getStoryImageAssets } from "./imageAssets";
import {
  extractedFrameTimeMs,
  requestedExtractedFrameVideoDurationSec,
} from "../../shared/extractedFrameTransition";
import { buildTimelineLayout } from "../../shared/timelineLayout";
import {
  estimateViduQ2TransitionCny,
  estimateViduQ2TransitionCost,
} from "./videoTransition302";
import {
  transitionVideoFrameTime,
  transitionVideoWindow,
} from "./videoEndpointFrames";
import { displayShotCode, promptShotCode } from "../../shared/shotIdentity";
import { adoptVideoTake, appendVideoTakeToTimeline } from "./videoTimeline";

export type TimelineEditSelectionContext = {
  stableShotId?: string | null;
  shotNo?: number | null;
  sourceType?: string;
  sourceId?: string;
  imageId?: number | null;
  videoTakeId?: number | null;
  rangeId?: number | null;
  selection?:
    | { kind: "time"; startSec: number; endSec: number }
    | { kind: "text"; start: number; end: number }
    | { kind: "rect"; x: number; y: number; width: number; height: number }
    | null;
};

export type TimelineTransitionEndpoint =
  | {
      mediaKind: "image";
      stableShotId: string;
      shotNo: number;
      imageId: number;
      imageUrl: string;
    }
  | {
      mediaKind: "video";
      stableShotId: string;
      shotNo: number;
      videoTakeId: number;
      rangeId: number | null;
      selectionType: "full_take" | "range";
      atSec: number;
      mediaRevision: string;
      /** Authenticated local preview of the exact frame; never trusted on confirm. */
      imageUrl: string;
    };

export type TimelineTransitionCandidate = {
  candidateId: string;
  provisionalStableShotId: string;
  storyId: number;
  source: TimelineTransitionEndpoint;
  target: TimelineTransitionEndpoint;
  instruction: string;
  movementAmplitude?: "auto" | "small" | "medium" | "large";
  prompt: string;
  durationSec: number;
  resolution: "720p";
  cutAtSec: 1.4 | null;
  estimatedCredits: number;
  estimatedCny: number;
  expectedTimelineVersion: number;
  placement?: {
    kind: "timeline-overlay";
    startFrame: number;
    targetEndFrame: number;
    leftImageId: number;
    rightImageId: number;
  };
};

export type TimelineEditResult =
  | { handled: false }
  | {
      handled: true;
      reply: string;
      appliedCount: number;
      undoSnapshot?: StoryTimelineItem[];
      proposal?: undefined;
    }
  | {
      handled: true;
      reply: string;
      appliedCount: 0;
      proposal: TimelineTransitionCandidate;
    };

type RawOperation = {
  op?: unknown;
  entry?: unknown;
  toPosition?: unknown;
  seconds?: unknown;
  order?: unknown;
};

type RawAgentPayload = {
  isEditCommand?: unknown;
  operations?: unknown;
  reply?: unknown;
  transitionProposal?: unknown;
};

type RawTransitionProposal = {
  sourceEntry?: unknown;
  targetEntry?: unknown;
  prompt?: unknown;
};

const MIN_DURATION_MS = 100;
const MAX_DURATION_MS = 30_000;
const EXPLICIT_TRANSITION_KEYWORDS =
  /(?:衔接|转场|过渡|快速切换|快速切到|生成.{0,8}(?:衔接|转场|过渡).{0,8}视频)/;
const SCENE_CUT_KEYWORDS = /(?:场景|画面|人物|镜头).{0,6}(?:切换到|切到)/;
const DIRECT_TIMELINE_OPERATION_KEYWORDS =
  /(?:挪|移动|移到|放到|重排|删掉|移除|恢复|时长|前面|后面|第\s*\d+\s*位|\d+(?:\.\d+)?\s*秒)/;
const PREVIOUS_SHOT_KEYWORDS = /(?:上一(?:个)?镜头?|前一(?:个)?镜头?|和前面)/;
const SELECTED_VIDEO_APPEND_KEYWORDS =
  /(?:(?:追加|添加|加上|再加|多加|添上|多添|插入|放进|塞进).{0,10}(?:视频|片段)|(?:视频|片段).{0,10}(?:追加|添加|加到|添到|插入|放进|塞进|放到))/;

type SelectedVideoEdit = {
  effects: Partial<TimelineVideoEffects>;
  transform?: Partial<TimelineTransform>;
  sourceStartSec?: number;
  sourceEndSec?: number;
  labels: string[];
};

type SelectedVisualTransform = {
  transform: Partial<TimelineTransform>;
  labels: string[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeRotation(value: number): number {
  const normalized = ((value % 360) + 360) % 360;
  return normalized > 180 ? normalized - 360 : normalized;
}

function normalizedTimelineTransform(
  base: TimelineTransform | undefined,
  patch: Partial<TimelineTransform>,
  minimumZoom: number
): TimelineTransform {
  const merged = {
    ...DEFAULT_TIMELINE_TRANSFORM,
    ...base,
    ...patch,
  };
  return {
    cropX: clamp(merged.cropX, 0, 1),
    cropY: clamp(merged.cropY, 0, 1),
    cropWidth: clamp(merged.cropWidth, 0.01, 1),
    cropHeight: clamp(merged.cropHeight, 0.01, 1),
    zoom: clamp(merged.zoom, minimumZoom, 8),
    panX: clamp(merged.panX, -1, 1),
    panY: clamp(merged.panY, -1, 1),
    rotationDeg: normalizeRotation(merged.rotationDeg ?? 0),
    flipX: Boolean(merged.flipX),
    flipY: Boolean(merged.flipY),
  };
}

function parseSelectedVisualTransform(
  instruction: string
): SelectedVisualTransform | null {
  const transform: Partial<TimelineTransform> = {};
  const labels: string[] = [];

  if (
    /(?:(?:还原|重置|恢复)(?:画面|构图)|(?:画面|构图)(?:还原|重置|恢复默认))/.test(
      instruction
    )
  ) {
    Object.assign(transform, DEFAULT_TIMELINE_TRANSFORM);
    labels.push("恢复默认构图");
    return { transform, labels };
  }

  const rotationMatch = instruction.match(
    /(?:向左|左转|逆时针)\s*(?:旋转)?\s*(\d+(?:\.\d+)?)\s*(?:度|°)|(?:向右|右转|顺时针)\s*(?:旋转)?\s*(\d+(?:\.\d+)?)\s*(?:度|°)|(?:旋转|转到|转成|转为)\s*(-?\d+(?:\.\d+)?)\s*(?:度|°)/
  );
  if (rotationMatch) {
    const degrees = rotationMatch[1]
      ? -Number(rotationMatch[1])
      : Number(rotationMatch[2] ?? rotationMatch[3]);
    transform.rotationDeg = normalizeRotation(degrees);
    labels.push(`旋转 ${transform.rotationDeg}°`);
  } else if (/(?:取消旋转|恢复正向|画面转正|转回正向)/.test(instruction)) {
    transform.rotationDeg = 0;
    labels.push("恢复正向");
  } else if (/(?:上下颠倒|倒过来显示)/.test(instruction)) {
    transform.rotationDeg = 180;
    labels.push("旋转 180°");
  }

  if (/(?:取消|关闭|去掉)(?:水平翻转|左右镜像|水平镜像)/.test(instruction)) {
    transform.flipX = false;
    labels.push("取消水平镜像");
  } else if (/(?:水平翻转|左右镜像|水平镜像)/.test(instruction)) {
    transform.flipX = true;
    labels.push("水平镜像");
  }

  if (/(?:取消|关闭|去掉)(?:垂直翻转|上下镜像|垂直镜像)/.test(instruction)) {
    transform.flipY = false;
    labels.push("取消垂直镜像");
  } else if (/(?:垂直翻转|上下镜像|垂直镜像)/.test(instruction)) {
    transform.flipY = true;
    labels.push("垂直镜像");
  }

  const zoomPercentMatch = instruction.match(
    /(?:画面|构图)?\s*(?:缩放|放大|缩小)(?:到|至|为|成)?\s*(\d+(?:\.\d+)?)\s*%/
  );
  const zoomRatioMatch = instruction.match(
    /(?:画面|构图)?\s*(?:缩放|放大|缩小)(?:到|至|为|成)?\s*(\d+(?:\.\d+)?)\s*(?:倍|x)/i
  );
  if (zoomPercentMatch || zoomRatioMatch) {
    const zoom = zoomPercentMatch
      ? Number(zoomPercentMatch[1]) / 100
      : Number(zoomRatioMatch![1]);
    transform.zoom = clamp(zoom, 0.25, 8);
    labels.push(`画面缩放 ${transform.zoom.toFixed(2)}x`);
  }

  if (
    /(?:画面|构图)?(?:回到|恢复|保持)?(?:正中|居中|中心位置)/.test(instruction)
  ) {
    transform.panX = 0;
    transform.panY = 0;
    labels.push("画面居中");
  }

  const horizontalMatch = instruction.match(
    /(?:水平|横向|X)\s*(?:位置)?\s*(?:到|至|为|成|移动到)?\s*(-?\d+(?:\.\d+)?)\s*%/i
  );
  if (horizontalMatch) {
    transform.panX = clamp(Number(horizontalMatch[1]) / 100, -1, 1);
    labels.push(`水平位置 ${Math.round(transform.panX * 100)}%`);
  }
  const verticalMatch = instruction.match(
    /(?:垂直|纵向|Y)\s*(?:位置)?\s*(?:到|至|为|成|移动到)?\s*(-?\d+(?:\.\d+)?)\s*%/i
  );
  if (verticalMatch) {
    transform.panY = clamp(Number(verticalMatch[1]) / 100, -1, 1);
    labels.push(`垂直位置 ${Math.round(transform.panY * 100)}%`);
  }

  const directionMatch = instruction.match(
    /(?:向|往)(左|右|上|下)(?:移动|平移|挪动|挪)?\s*(\d+(?:\.\d+)?)\s*%/
  );
  if (directionMatch) {
    const amount = clamp(Number(directionMatch[2]) / 100, 0, 1);
    if (directionMatch[1] === "左" || directionMatch[1] === "右") {
      transform.panX = directionMatch[1] === "左" ? -amount : amount;
      labels.push(`向${directionMatch[1]}移动 ${Math.round(amount * 100)}%`);
    } else {
      transform.panY = directionMatch[1] === "上" ? -amount : amount;
      labels.push(`向${directionMatch[1]}移动 ${Math.round(amount * 100)}%`);
    }
  }

  return labels.length > 0 ? { transform, labels } : null;
}

function parseSelectedVideoEdit(
  instruction: string,
  selection?: TimelineEditSelectionContext
): SelectedVideoEdit | null {
  if (
    !selection?.videoTakeId ||
    (selection.sourceType !== "animatic-video" &&
      selection.sourceType !== "timeline-range")
  ) {
    return null;
  }
  const effects: Partial<TimelineVideoEffects> = {};
  const labels: string[] = [];
  const visualTransform = parseSelectedVisualTransform(instruction);
  const disableHeartbeat =
    /(?:取消|关闭|移除|不要).{0,8}(?:心跳|脉冲)(?:缩放|节奏|运动)?/.test(
      instruction
    );
  const heartbeatRequested =
    /(?:心跳|脉冲).{0,8}(?:频率|节奏|缩放|运动)|(?:运动|缩放).{0,8}(?:心跳|脉冲)/.test(
      instruction
    );
  if (disableHeartbeat) {
    effects.motionPreset = null;
    labels.push("取消心跳缩放");
  } else if (heartbeatRequested) {
    const bpmMatch = instruction.match(
      /(?:按|以|为|改成|设为)?\s*(\d{2,3}(?:\.\d+)?)\s*(?:bpm|拍(?:每分钟)?|次(?:每分钟)?)/i
    );
    const bpm = clamp(bpmMatch ? Number(bpmMatch[1]) : 72, 36, 180);
    effects.motionPreset = { kind: "heartbeat", bpm, scaleAmount: 0.06 };
    labels.push(`心跳缩放 ${Math.round(bpm)} BPM、6% 幅度`);
  }
  const speedMatch = instruction.match(
    /(?:播放速度|速度|倍速|调成|调到|改成|设为|用)?\s*(\d+(?:\.\d+)?)\s*(?:倍速?|x)/i
  );
  if (
    speedMatch &&
    visualTransform?.transform.zoom == null &&
    !/(?:画面|构图|镜头).{0,6}(?:放大|缩放)/.test(instruction)
  ) {
    const playbackRate = clamp(Number(speedMatch[1]), 0.25, 4);
    effects.playbackRate = playbackRate;
    labels.push(`${playbackRate} 倍速`);
  }

  if (/(?:取消倒放|恢复正放|改回正放|正向播放|正常播放)/.test(instruction)) {
    effects.reverse = false;
    labels.push("正向播放");
  } else if (/(?:倒放|反向播放|反着播放)/.test(instruction)) {
    effects.reverse = true;
    labels.push("倒放");
  }

  if (/(?:取消静音|恢复原声|打开原声|保留原声)/.test(instruction)) {
    effects.muted = false;
    labels.push("恢复原声");
  } else if (/(?:静音|关掉原声|关闭原声|不要原声)/.test(instruction)) {
    effects.muted = true;
    labels.push("静音");
  }

  const volumeMatch = instruction.match(
    /(?:音量|原声).{0,8}?(\d{1,3}(?:\.\d+)?)\s*%/
  );
  if (volumeMatch) {
    const percent = clamp(Number(volumeMatch[1]), 0, 200);
    effects.volume = percent / 100;
    labels.push(`音量 ${percent}%`);
  }

  const trimMatch = instruction.match(
    /(?:保留|截取|裁剪|裁到|从)?\s*(\d+(?:\.\d+)?)\s*秒\s*(?:到|至|—|-)\s*(\d+(?:\.\d+)?)\s*秒/
  );
  const sourceStartSec = trimMatch ? Number(trimMatch[1]) : undefined;
  const sourceEndSec = trimMatch ? Number(trimMatch[2]) : undefined;
  if (
    sourceStartSec != null &&
    sourceEndSec != null &&
    sourceEndSec > sourceStartSec
  ) {
    labels.push(`截取 ${sourceStartSec}–${sourceEndSec} 秒`);
  }

  if (visualTransform) labels.push(...visualTransform.labels);
  if (labels.length === 0) return null;
  return {
    effects,
    transform: visualTransform?.transform,
    sourceStartSec,
    sourceEndSec,
    labels,
  };
}

function inferredVideoEffects(input: {
  sourceStartSec: number;
  sourceEndSec: number;
  durationMs: number;
  effects?: TimelineVideoEffects;
}): TimelineVideoEffects {
  if (input.effects) return { ...input.effects };
  const sourceDurationSec = Math.max(
    0.1,
    input.sourceEndSec - input.sourceStartSec
  );
  return {
    ...DEFAULT_TIMELINE_VIDEO_EFFECTS,
    playbackRate: clamp(
      sourceDurationSec / Math.max(0.1, input.durationMs / 1_000),
      0.25,
      4
    ),
  };
}

function shotTargetFromInstruction(input: {
  instruction: string;
  selectionContext?: TimelineEditSelectionContext;
  shotsByIdentity: Map<string, ShotMaterialState>;
}): ShotMaterialState | null {
  const shots = Array.from(input.shotsByIdentity.values());
  const cueTarget = shots
    .filter(shot => shot.cueCode?.trim())
    .sort(
      (left, right) =>
        (right.cueCode?.length ?? 0) - (left.cueCode?.length ?? 0)
    )
    .find(shot => input.instruction.includes(shot.cueCode!.trim()));
  const explicitShotNo = explicitShotNos(input.instruction)[0];
  const numberedTarget =
    explicitShotNo == null
      ? null
      : shots.find(shot => shot.shotNo === explicitShotNo);
  const selectedTarget = input.selectionContext?.stableShotId
    ? input.shotsByIdentity.get(input.selectionContext.stableShotId)
    : shots.find(shot => shot.shotNo === input.selectionContext?.shotNo);
  return cueTarget ?? numberedTarget ?? selectedTarget ?? null;
}

async function applySelectedVideoAppend(input: {
  storyId: number;
  userId: number;
  instruction: string;
  selectionContext?: TimelineEditSelectionContext;
  items: StoryTimelineItem[];
  shotsByIdentity: Map<string, ShotMaterialState>;
  timelineVersion: number;
}): Promise<TimelineEditResult | null> {
  const selection = input.selectionContext;
  if (
    !selection?.videoTakeId ||
    (selection.sourceType !== "animatic-video" &&
      selection.sourceType !== "timeline-range") ||
    !SELECTED_VIDEO_APPEND_KEYWORDS.test(input.instruction)
  ) {
    return null;
  }
  const selectedShot = selection.stableShotId
    ? input.shotsByIdentity.get(selection.stableShotId)
    : Array.from(input.shotsByIdentity.values()).find(
        shot => shot.shotNo === selection.shotNo
      );
  if (!selectedShot) {
    return {
      handled: true,
      reply: "当前选中的视频已经失效，请重新选中后再追加。",
      appliedCount: 0,
    };
  }

  const targetShot =
    shotTargetFromInstruction({
      instruction: input.instruction,
      selectionContext: input.selectionContext,
      shotsByIdentity: input.shotsByIdentity,
    }) ?? selectedShot;
  const sourceItem = input.items.find(
    item => item.stableShotId === selectedShot.stableShotId
  );
  const selectedClip =
    selection.sourceType === "timeline-range" && sourceItem
      ? sourceItem.visualClips?.find(clip => clip.id === selection.sourceId)
      : null;
  const sourceTake = Array.from(input.shotsByIdentity.values())
    .flatMap(shot => shot.videoTakes ?? [])
    .find(take => take.id === selection.videoTakeId);
  const selectedRange =
    sourceTake?.selectedSelectionType === "range" &&
    sourceTake.selectedRangeId != null
      ? sourceTake.ranges.find(range => range.id === sourceTake.selectedRangeId)
      : null;
  const primaryEdit =
    sourceItem?.primaryVideoEdit?.takeId === selection.videoTakeId
      ? sourceItem.primaryVideoEdit
      : null;
  const sourceStartSec = Math.max(
    0,
    selectedClip?.sourceStartSec ??
      primaryEdit?.sourceStartSec ??
      (selection.selection?.kind === "time"
        ? selection.selection.startSec
        : (selectedRange?.startSec ?? 0))
  );
  const sourceEndSec = Math.max(
    sourceStartSec + 1 / 30,
    selectedClip?.sourceEndSec ??
      primaryEdit?.sourceEndSec ??
      (selection.selection?.kind === "time"
        ? selection.selection.endSec
        : (selectedRange?.endSec ??
          sourceTake?.durationSec ??
          sourceStartSec + 3))
  );
  const sourceEffects = inferredVideoEffects({
    sourceStartSec,
    sourceEndSec,
    durationMs:
      selectedClip?.durationMs ??
      sourceItem?.plannedDurationMs ??
      Math.round((sourceEndSec - sourceStartSec) * 1_000),
    effects: selectedClip?.effects ?? primaryEdit?.effects,
  });
  const result = await appendVideoTakeToTimeline(
    {
      storyId: input.storyId,
      sourceTakeId: selection.videoTakeId,
      targetStableShotId: targetShot.stableShotId,
      sourceStartSec,
      sourceEndSec,
      effects: sourceEffects,
      transform: {
        ...(selectedClip?.transform ??
          sourceItem?.transform ?? {
            cropX: 0,
            cropY: 0,
            cropWidth: 1,
            cropHeight: 1,
            zoom: 1,
            panX: 0,
            panY: 0,
          }),
      },
      targetOffsetMs: /(?:开头|最前面|最前方|前面)/.test(input.instruction)
        ? 0
        : undefined,
      expectedTimelineVersion: input.timelineVersion,
    },
    input.userId
  );
  return {
    handled: true,
    reply: `已把选中的视频作为新片段${/(?:开头|最前面|最前方|前面)/.test(input.instruction) ? "插到" : "接到"} ${displayShotCode(targetShot)} ${/(?:开头|最前面|最前方|前面)/.test(input.instruction) ? "开头" : "末尾"}，原视频仍然保留。`,
    appliedCount: 1,
    undoSnapshot: result.beforeItems,
  };
}

async function applySelectedVideoEdit(input: {
  storyId: number;
  userId: number;
  instruction: string;
  selectionContext?: TimelineEditSelectionContext;
  items: StoryTimelineItem[];
  shotsByIdentity: Map<string, ShotMaterialState>;
  timelineVersion: number;
}): Promise<TimelineEditResult | null> {
  const parsed = parseSelectedVideoEdit(
    input.instruction,
    input.selectionContext
  );
  if (!parsed || !input.selectionContext?.videoTakeId) return null;
  const selection = input.selectionContext;
  const shot = selection.stableShotId
    ? input.shotsByIdentity.get(selection.stableShotId)
    : Array.from(input.shotsByIdentity.values()).find(
        candidate => candidate.shotNo === selection.shotNo
      );
  if (!shot) {
    return {
      handled: true,
      reply:
        "我认出了视频剪辑指令，但当前选区已经失效。请重新双击那条视频后再试。",
      appliedCount: 0,
    };
  }
  const itemIndex = input.items.findIndex(
    item => item.stableShotId === shot.stableShotId
  );
  if (itemIndex < 0) {
    return {
      handled: true,
      reply: `${displayShotCode(shot)} 不在当前时间线上，暂时没有修改。`,
      appliedCount: 0,
    };
  }

  const working = input.items.map(item => ({
    ...item,
    transform: { ...item.transform },
    primaryVideoEdit: item.primaryVideoEdit
      ? {
          ...item.primaryVideoEdit,
          effects: { ...item.primaryVideoEdit.effects },
        }
      : undefined,
    visualClips: item.visualClips?.map(clip => ({
      ...clip,
      effects: clip.effects ? { ...clip.effects } : undefined,
      transform: clip.transform ? { ...clip.transform } : undefined,
    })),
  }));
  const item = working[itemIndex];
  const clipId =
    selection.sourceType === "timeline-range" ? selection.sourceId : null;
  const clip = clipId
    ? item.visualClips?.find(candidate => candidate.id === clipId)
    : null;

  if (clip) {
    const sourceStartSec = Math.max(
      0,
      parsed.sourceStartSec ?? clip.sourceStartSec
    );
    const sourceEndSec = Math.max(
      sourceStartSec + 1 / 30,
      parsed.sourceEndSec ?? clip.sourceEndSec
    );
    const effects = {
      ...inferredVideoEffects({
        sourceStartSec: clip.sourceStartSec,
        sourceEndSec: clip.sourceEndSec,
        durationMs: clip.durationMs,
        effects: clip.effects,
      }),
      ...parsed.effects,
    };
    const transform = parsed.transform
      ? normalizedTimelineTransform(
          clip.transform ?? item.transform,
          parsed.transform,
          1
        )
      : clip.transform;
    const durationMs = Math.max(
      100,
      Math.round(
        ((sourceEndSec - sourceStartSec) * 1_000) / effects.playbackRate
      )
    );
    const previousEndMs = clip.offsetMs + clip.durationMs;
    const deltaMs = durationMs - clip.durationMs;
    item.visualClips = (item.visualClips ?? [])
      .map(candidate => {
        if (candidate.id === clip.id) {
          return {
            ...candidate,
            sourceStartSec,
            sourceEndSec,
            durationMs,
            effects,
            transform,
          };
        }
        if (
          item.visualClipsReplacePrimary &&
          candidate.offsetMs >= previousEndMs - 1
        ) {
          return {
            ...candidate,
            offsetMs: Math.max(0, candidate.offsetMs + deltaMs),
          };
        }
        return candidate;
      })
      .sort((left, right) => left.offsetMs - right.offsetMs);
    const lastClipEndMs = item.visualClips.reduce(
      (maximum, candidate) =>
        Math.max(maximum, candidate.offsetMs + candidate.durationMs),
      0
    );
    item.plannedDurationMs = item.visualClipsReplacePrimary
      ? Math.max(100, lastClipEndMs)
      : Math.max(item.plannedDurationMs, lastClipEndMs);
  } else {
    const take = shot.videoTakes.find(
      candidate => candidate.id === selection.videoTakeId
    );
    if (!take?.videoUrl || take.status !== "available") {
      return {
        handled: true,
        reply: "这条视频现在不可播放，未修改时间线。请重新选择一个可用 Take。",
        appliedCount: 0,
      };
    }
    const selectedRange =
      take.selectedSelectionType === "range" && take.selectedRangeId != null
        ? take.ranges.find(range => range.id === take.selectedRangeId)
        : null;
    const currentEdit =
      item.primaryVideoEdit?.takeId === take.id ? item.primaryVideoEdit : null;
    const initialStartSec =
      currentEdit?.sourceStartSec ??
      (selection.selection?.kind === "time"
        ? selection.selection.startSec
        : (selectedRange?.startSec ?? 0));
    const initialEndSec =
      currentEdit?.sourceEndSec ??
      (selection.selection?.kind === "time"
        ? selection.selection.endSec
        : (selectedRange?.endSec ?? take.durationSec ?? initialStartSec + 3));
    const sourceStartSec = clamp(
      parsed.sourceStartSec ?? initialStartSec,
      0,
      Math.max(0, (take.durationSec ?? initialEndSec) - 1 / 30)
    );
    const sourceEndSec = clamp(
      parsed.sourceEndSec ?? initialEndSec,
      sourceStartSec + 1 / 30,
      Math.max(sourceStartSec + 1 / 30, take.durationSec ?? initialEndSec)
    );
    const effects = {
      ...inferredVideoEffects({
        sourceStartSec: initialStartSec,
        sourceEndSec: initialEndSec,
        durationMs: item.plannedDurationMs,
        effects: currentEdit?.effects,
      }),
      ...parsed.effects,
    };
    const durationMs = Math.max(
      100,
      Math.round(
        ((sourceEndSec - sourceStartSec) * 1_000) / effects.playbackRate
      )
    );
    if (!take.isTimelineSelected) {
      await adoptVideoTake(
        {
          storyId: input.storyId,
          stableShotId: shot.stableShotId,
          takeId: take.id,
          plannedDurationSec: durationMs / 1_000,
        },
        input.userId
      );
    }
    item.plannedDurationMs = durationMs;
    if (parsed.transform) {
      item.transform = normalizedTimelineTransform(
        item.transform,
        parsed.transform,
        1
      );
    }
    item.primaryVideoEdit = {
      takeId: take.id,
      sourceStartSec,
      sourceEndSec,
      effects,
    };
  }

  await updateStoryTimeline({
    storyId: input.storyId,
    userId: input.userId,
    expectedVersion: input.timelineVersion,
    items: working.map((item, position) => ({ ...item, position })),
  });
  return {
    handled: true,
    reply: `已把 ${displayShotCode(shot)} 的当前视频改为：${parsed.labels.join("、")}。修改已进入时间线。`,
    appliedCount: 1,
    undoSnapshot: input.items,
  };
}

async function applySelectedImageEdit(input: {
  storyId: number;
  userId: number;
  instruction: string;
  selectionContext?: TimelineEditSelectionContext;
  items: StoryTimelineItem[];
  shotsByIdentity: Map<string, ShotMaterialState>;
  timelineVersion: number;
}): Promise<TimelineEditResult | null> {
  const selection = input.selectionContext;
  if (selection?.sourceType !== "storyboard-image") return null;
  const parsed = parseSelectedVisualTransform(input.instruction);
  if (!parsed) return null;
  const shot = selection.stableShotId
    ? input.shotsByIdentity.get(selection.stableShotId)
    : Array.from(input.shotsByIdentity.values()).find(
        candidate => candidate.shotNo === selection.shotNo
      );
  if (!shot) {
    return {
      handled: true,
      reply: "当前选中的图片已经失效，请重新选中后再调整。",
      appliedCount: 0,
    };
  }
  if (
    selection.imageId != null &&
    shot.currentImage?.id !== selection.imageId
  ) {
    return {
      handled: true,
      reply: `${displayShotCode(shot)} 当前使用的已经不是这张图片。请先选中正在使用的图片，再调整构图。`,
      appliedCount: 0,
    };
  }
  const itemIndex = input.items.findIndex(
    item => item.stableShotId === shot.stableShotId
  );
  if (itemIndex < 0) {
    return {
      handled: true,
      reply: `${displayShotCode(shot)} 不在当前时间线上，暂时没有修改。`,
      appliedCount: 0,
    };
  }
  const working = input.items.map((item, index) =>
    index === itemIndex
      ? {
          ...item,
          transform: normalizedTimelineTransform(
            item.transform,
            parsed.transform,
            0.25
          ),
        }
      : item
  );
  await updateStoryTimeline({
    storyId: input.storyId,
    userId: input.userId,
    expectedVersion: input.timelineVersion,
    items: working.map((item, position) => ({ ...item, position })),
  });
  return {
    handled: true,
    reply: `已把 ${displayShotCode(shot)} 的当前图片改为：${parsed.labels.join("、")}。修改已进入时间线。`,
    appliedCount: 1,
    undoSnapshot: input.items,
  };
}

async function applyShotVisualTransform(input: {
  storyId: number;
  userId: number;
  instruction: string;
  selectionContext?: TimelineEditSelectionContext;
  items: StoryTimelineItem[];
  shotsByIdentity: Map<string, ShotMaterialState>;
  timelineVersion: number;
}): Promise<TimelineEditResult | null> {
  const parsed = parseSelectedVisualTransform(input.instruction);
  if (!parsed) return null;
  const shot = shotTargetFromInstruction({
    instruction: input.instruction,
    selectionContext: input.selectionContext,
    shotsByIdentity: input.shotsByIdentity,
  });
  if (!shot) {
    return {
      handled: true,
      reply:
        "我认出了构图修改，但还不知道要改哪一镜。请先选中画面，或直接说镜头号，例如“把 0102 旋转 180 度”。",
      appliedCount: 0,
    };
  }
  const itemIndex = input.items.findIndex(
    item => item.stableShotId === shot.stableShotId
  );
  if (itemIndex < 0) {
    return {
      handled: true,
      reply: `${displayShotCode(shot)} 不在当前时间线上，暂时没有修改。`,
      appliedCount: 0,
    };
  }
  const working = input.items.map((item, index) => {
    if (index !== itemIndex) return item;
    const containsVideo =
      Boolean(shot.currentVideo) || Boolean(item.visualClips?.length);
    const transform = normalizedTimelineTransform(
      item.transform,
      parsed.transform,
      containsVideo ? 1 : 0.25
    );
    return {
      ...item,
      transform,
      visualClips: item.visualClips?.map(clip => ({
        ...clip,
        transform: normalizedTimelineTransform(
          clip.transform ?? item.transform,
          parsed.transform,
          1
        ),
      })),
    };
  });
  await updateStoryTimeline({
    storyId: input.storyId,
    userId: input.userId,
    expectedVersion: input.timelineVersion,
    items: working.map((item, position) => ({ ...item, position })),
  });
  return {
    handled: true,
    reply: `已把 ${displayShotCode(shot)} 的整镜画面改为：${parsed.labels.join("、")}。修改已进入时间线。`,
    appliedCount: 1,
    undoSnapshot: input.items,
  };
}

function buildSystemPrompt(entries: string[]): string {
  return [
    "你是短片时间轴剪辑助手。用户会用中文口语描述想怎么调整时间轴。",
    "当前时间轴（按顺序编号；「已移除」表示暂不在成片里但可恢复）：",
    ...entries,
    "",
    "判断用户这句话是否是时间轴剪辑指令：",
    '- 是 → "isEditCommand": true，给出 operations（可多个，按执行顺序）。',
    '- 不是（在聊故事/情绪/画面内容等）→ "isEditCommand": false，operations 空。',
    "支持的 operations（entry 一律用上面的序号）：",
    '- {"op":"move","entry":3,"toPosition":1}  把某镜挪到第几位',
    '- {"op":"remove","entry":5}               从成片移除（可恢复）',
    '- {"op":"restore","entry":5}              恢复已移除的镜头',
    '- {"op":"setDuration","entry":2,"seconds":2.5}  改该镜时长（秒）',
    '- {"op":"reorder","order":[2,1,3,...]}    整轴重排（必须列出全部序号）',
    "如果用户要求两个相邻镜头衔接、转场、过渡、快速切换，或生成衔接视频：",
    "- isEditCommand=true，operations 留空，并返回 transitionProposal：",
    '  {"sourceEntry":1,"targetEntry":2,"prompt":"可选的补充运镜说明"}',
    "sourceEntry/targetEntry 必须是时间轴上相邻且未移除的两镜，并按播放先后填写。",
    "统一尺寸/画幅请他用「一键剪辑」，单镜生成或换视频请他在素材仓库操作——",
    "这两类诉求算剪辑意图（isEditCommand: true）但 operations 留空，在 reply 里指路。",
    "reply 用一两句中文口语汇报做了什么（或为什么没做）。",
    "严格返回 JSON，不要 markdown：",
    '{"isEditCommand":true,"operations":[...],"reply":"..."}',
  ].join("\n");
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isRuleTransitionIntent(instruction: string): boolean {
  if (EXPLICIT_TRANSITION_KEYWORDS.test(instruction)) return true;
  return (
    SCENE_CUT_KEYWORDS.test(instruction) &&
    !DIRECT_TIMELINE_OPERATION_KEYWORDS.test(instruction)
  );
}

function shotNoFromChinese(value: string): number | null {
  const digits: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (value === "十") return 10;
  const tenIndex = value.indexOf("十");
  if (tenIndex >= 0) {
    const tens = tenIndex === 0 ? 1 : digits[value[tenIndex - 1]];
    const ones =
      tenIndex === value.length - 1 ? 0 : digits[value[tenIndex + 1]];
    if (tens == null || ones == null) return null;
    return tens * 10 + ones;
  }
  if (value.length === 1 && digits[value] != null) return digits[value];
  return null;
}

function explicitShotNos(instruction: string): number[] {
  const matches: number[] = [];
  const pattern =
    /SH\s*0*(\d+)|第?\s*(\d+)\s*(?:个)?镜(?:头)?|第?\s*([零一二两三四五六七八九十]{1,3})\s*(?:个)?镜(?:头)?/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(instruction)) !== null) {
    const value = match[1]
      ? Number(match[1])
      : match[2]
        ? Number(match[2])
        : shotNoFromChinese(match[3] ?? "");
    if (value && Number.isInteger(value) && !matches.includes(value)) {
      matches.push(value);
    }
  }
  return matches;
}

function transitionPairFromSelection(params: {
  items: StoryTimelineItem[];
  byIdentity: Map<string, { stableShotId: string; shotNo: number }>;
  selectionContext?: TimelineEditSelectionContext;
  instruction: string;
}): [StoryTimelineItem, StoryTimelineItem] | null {
  const included = params.items.filter(item => item.included);
  if (included.length < 2) return null;

  const explicit = explicitShotNos(params.instruction);
  if (explicit.length >= 2) {
    const pair = explicit
      .slice(0, 2)
      .map(shotNo =>
        included.find(
          item => params.byIdentity.get(item.stableShotId)?.shotNo === shotNo
        )
      );
    if (pair[0] && pair[1]) {
      const leftIndex = included.indexOf(pair[0]);
      const rightIndex = included.indexOf(pair[1]);
      if (Math.abs(leftIndex - rightIndex) === 1) {
        return leftIndex < rightIndex ? [pair[0], pair[1]] : [pair[1], pair[0]];
      }
    }
    return null;
  }

  const selection = params.selectionContext;
  if (!selection) return null;
  let selectedIndex = selection.stableShotId
    ? included.findIndex(item => item.stableShotId === selection.stableShotId)
    : -1;
  if (selectedIndex < 0 && Number.isInteger(selection.shotNo)) {
    selectedIndex = included.findIndex(
      item =>
        params.byIdentity.get(item.stableShotId)?.shotNo === selection.shotNo
    );
  }
  if (selectedIndex < 0) return null;

  const wantsPrevious = PREVIOUS_SHOT_KEYWORDS.test(params.instruction);
  if (!wantsPrevious && selectedIndex < included.length - 1) {
    return [included[selectedIndex], included[selectedIndex + 1]];
  }
  if (selectedIndex > 0) {
    return [included[selectedIndex - 1], included[selectedIndex]];
  }
  return [included[selectedIndex], included[selectedIndex + 1]];
}

function transitionPairFromAgent(params: {
  value: unknown;
  items: StoryTimelineItem[];
}): [StoryTimelineItem, StoryTimelineItem] | null {
  const raw = recordOf(params.value) as RawTransitionProposal | null;
  if (!raw) return null;
  const sourceEntry = asEntryNumber(raw.sourceEntry, params.items.length);
  const targetEntry = asEntryNumber(raw.targetEntry, params.items.length);
  if (sourceEntry === null || targetEntry === null) return null;
  const source = params.items[sourceEntry - 1];
  const target = params.items[targetEntry - 1];
  if (!source.included || !target.included) return null;
  const included = params.items.filter(item => item.included);
  const sourceIndex = included.findIndex(
    item => item.stableShotId === source.stableShotId
  );
  const targetIndex = included.findIndex(
    item => item.stableShotId === target.stableShotId
  );
  if (targetIndex !== sourceIndex + 1) return null;
  return [source, target];
}

export function transitionEndpointForShot(
  shot: ShotMaterialState,
  item: StoryTimelineItem,
  role: "start" | "end"
): TimelineTransitionEndpoint | null {
  const video = shot.currentVideo;
  if (
    video &&
    Number.isInteger(video.id) &&
    video.status === "available" &&
    Boolean(video.videoUrl)
  ) {
    const window = transitionVideoWindow(video, item);
    const atSec = transitionVideoFrameTime(window, role);
    const rangeQuery =
      window.rangeId == null ? "" : `&rangeId=${window.rangeId}`;
    return {
      mediaKind: "video",
      stableShotId: shot.stableShotId,
      shotNo: shot.shotNo,
      videoTakeId: video.id,
      rangeId: window.rangeId,
      selectionType: window.selectionType,
      atSec,
      mediaRevision: [
        video.id,
        video.videoKey ?? video.videoUrl,
        video.updatedAt,
        window.selectionType,
        window.rangeId ?? "full",
        window.startSec.toFixed(3),
        window.endSec.toFixed(3),
      ].join(":"),
      imageUrl: `/api/video-frames/${video.id}?atSec=${atSec.toFixed(3)}${rangeQuery}`,
    };
  }
  const image = shot.currentImage;
  if (
    image &&
    Number.isInteger(image.id) &&
    image.imageUrl.trim() &&
    image.availability !== "missing"
  ) {
    return {
      mediaKind: "image",
      stableShotId: shot.stableShotId,
      shotNo: shot.shotNo,
      imageId: image.id,
      imageUrl: image.imageUrl,
    };
  }
  return null;
}

function buildTransitionProposal(params: {
  storyId: number;
  instruction: string;
  expectedTimelineVersion: number;
  sourceItem: StoryTimelineItem;
  targetItem: StoryTimelineItem;
  byIdentity: Map<string, ShotMaterialState>;
  agentPrompt?: string | null;
}):
  | { proposal: TimelineTransitionCandidate; missingShotNos: [] }
  | { proposal: null; missingShotNos: number[] } {
  const source = params.byIdentity.get(params.sourceItem.stableShotId);
  const target = params.byIdentity.get(params.targetItem.stableShotId);
  if (!source || !target) return { proposal: null, missingShotNos: [] };

  // 镜头已有采用视频时，必须取实际播放段的末/首帧；图片只作为无视频时的后备。
  const sourceEndpoint = transitionEndpointForShot(
    source,
    params.sourceItem,
    "end"
  );
  const targetEndpoint = transitionEndpointForShot(
    target,
    params.targetItem,
    "start"
  );
  const missingShotNos = [source, target]
    .filter(shot =>
      shot.stableShotId === source.stableShotId
        ? !sourceEndpoint
        : !targetEndpoint
    )
    .map(shot => shot.shotNo);
  if (missingShotNos.length > 0) {
    return { proposal: null, missingShotNos };
  }

  const endpointFingerprint = (endpoint: TimelineTransitionEndpoint) =>
    endpoint.mediaKind === "image"
      ? `image:${endpoint.imageId}`
      : `video:${endpoint.videoTakeId}:${endpoint.rangeId ?? "full"}:${endpoint.atSec.toFixed(3)}:${endpoint.mediaRevision}`;
  const digest = createHash("sha256")
    .update(
      [
        params.storyId,
        params.expectedTimelineVersion,
        source.stableShotId,
        target.stableShotId,
        endpointFingerprint(sourceEndpoint!),
        endpointFingerprint(targetEndpoint!),
        params.instruction,
      ].join(":"),
      "utf8"
    )
    .digest("hex")
    .slice(0, 16);
  const promptParts = [
    "以首帧和尾帧为硬约束，生成 2 秒、1:1 方形的自然镜头衔接。",
    params.instruction,
    params.agentPrompt?.trim() || "",
    "保持两端人物身份、服装、场景陈设、构图和画风连续，不新增人物、物体、文字或标志。",
    "动作只服务于从首帧快速而连贯地过渡到尾帧，最后准确停在尾帧构图。",
  ].filter(Boolean);

  return {
    missingShotNos: [],
    proposal: {
      candidateId: `transition-${digest}`,
      provisionalStableShotId: `transition-shot-${digest}`,
      storyId: params.storyId,
      source: sourceEndpoint!,
      target: targetEndpoint!,
      instruction: params.instruction,
      prompt: promptParts.join(" "),
      durationSec: 2,
      resolution: "720p",
      cutAtSec: 1.4,
      estimatedCredits: 10,
      estimatedCny: 0.35,
      expectedTimelineVersion: params.expectedTimelineVersion,
    },
  };
}

function asEntryNumber(value: unknown, max: number): number | null {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(num) || num < 1 || num > max) return null;
  return num;
}

export type GapTransitionProposalResult =
  | { status: "ok"; proposal: TimelineTransitionCandidate; reply: string }
  | { status: "blocked"; reply: string };

export async function proposeExtractedFrameTransition(params: {
  storyId: number;
  userId: number;
  leftImageId: number;
  rightImageId: number;
  instruction?: string;
  movementAmplitude?: "auto" | "small" | "medium" | "large";
}): Promise<GapTransitionProposalResult> {
  const [material, images] = await Promise.all([
    getStoryMaterialState(params.storyId, params.userId),
    getStoryImageAssets(params.storyId, params.userId),
  ]);
  if (!material) {
    return { status: "blocked", reply: "故事不存在或无权访问，暂时无法生成覆盖视频。" };
  }
  const left = images.find(image => image.id === params.leftImageId);
  const right = images.find(image => image.id === params.rightImageId);
  const valid = (image: typeof left) =>
    Boolean(
      image &&
        image.assignment === "shot" &&
        image.availability !== "missing" &&
        image.imageUrl.trim() &&
        extractedFrameTimeMs(image.prompt) != null
    );
  if (!valid(left) || !valid(right)) {
    return { status: "blocked", reply: "首帧或尾帧已经失效，请重新选择时间线抽帧。" };
  }
  const leftAtMs = extractedFrameTimeMs(left!.prompt)!;
  const rightAtMs = extractedFrameTimeMs(right!.prompt)!;
  const intervalMs = rightAtMs - leftAtMs;
  const durationSec = requestedExtractedFrameVideoDurationSec(intervalMs);
  if (durationSec < 1) {
    return { status: "blocked", reply: "两张抽帧至少需要间隔 1 秒。" };
  }
  const shotFor = (image: NonNullable<typeof left>) =>
    material.shots.find(shot => shot.stableShotId === image.shotIdentity) ??
    material.shots.find(
      shot => image.canonicalShotNo === `SH${String(shot.shotNo).padStart(2, "0")}`
    );
  const sourceShot = shotFor(left!);
  const targetShot = shotFor(right!);
  if (!sourceShot || !targetShot) {
    return { status: "blocked", reply: "抽帧所属镜头已经不存在，请重新抽帧。" };
  }
  const startFrame = Math.round((leftAtMs * 30) / 1_000);
  const targetEndFrame = Math.round((rightAtMs * 30) / 1_000);
  const anchoredConflict = buildTimelineLayout(material.timeline.items).find(
    row =>
      (row.item.anchors?.length ?? 0) > 0 &&
      row.startFrame < targetEndFrame &&
      row.endFrame > startFrame
  );
  if (anchoredConflict) {
    return {
      status: "blocked",
      reply: "这段目标区间与位置锚点相交。为避免付费后不可见，已停止生成。",
    };
  }
  const cost = estimateViduQ2TransitionCost({
    durationSec,
    resolution: "720p",
    uploadCount: 2,
  });
  const cny = estimateViduQ2TransitionCny({
    durationSec,
    resolution: "720p",
    uploadCount: 2,
  });
  const userInstruction = params.instruction?.trim().slice(0, 2_000) || "";
  const amplitudeLabel =
    params.movementAmplitude === "small"
      ? "小幅度"
      : params.movementAmplitude === "medium"
        ? "中幅度"
        : params.movementAmplitude === "large"
          ? "大幅度"
          : "自动幅度";
  const prompt = [
    `以两张抽帧为硬首尾帧，生成 ${durationSec} 秒、1:1 方形的连续运动镜头。`,
    "首帧和尾帧是确定的画面边界；中间过程必须完整执行用户的画面描述，并自然、连续地抵达尾帧。",
    "用户明确要求的新场景、物体、人物动作、形变和光线变化必须实现，不得以保持连续性为由删除、替换或弱化。",
    "用户未提及的主体身份、服装、画风和视觉质感保持稳定；不得添加用户未要求的文字或标志。",
    "完整保留生成视频的运动，不冻结尾帧。",
    `运动幅度：${amplitudeLabel}。`,
    userInstruction ? `用户完整画面描述（最高优先级）：${userInstruction}` : "",
  ].filter(Boolean).join(" ");
  const digest = createHash("sha256")
    .update(
      [
        params.userId,
        params.storyId,
        left!.id,
        right!.id,
        leftAtMs,
        rightAtMs,
        durationSec,
        prompt,
        "302",
        "viduq2-turbo",
      ].join(":"),
      "utf8"
    )
    .digest("hex")
    .slice(0, 16);
  return {
    status: "ok",
    reply: `已选中两张抽帧：目标区间 ${(intervalMs / 1_000).toFixed(1)} 秒，实际请求 ${durationSec} 秒，预计 ${cost.credits} 点 / ¥${cny.estimatedCny.toFixed(2)}。确认后才会付费；未生成的余段会留空。`,
    proposal: {
      candidateId: `transition-${digest}`,
      provisionalStableShotId: `transition-shot-${digest}`,
      storyId: params.storyId,
      source: {
        mediaKind: "image",
        stableShotId: sourceShot.stableShotId,
        shotNo: sourceShot.shotNo,
        imageId: left!.id,
        imageUrl: left!.imageUrl,
      },
      target: {
        mediaKind: "image",
        stableShotId: targetShot.stableShotId,
        shotNo: targetShot.shotNo,
        imageId: right!.id,
        imageUrl: right!.imageUrl,
      },
      instruction: userInstruction || "用两张时间线抽帧生成上层覆盖视频",
      movementAmplitude: params.movementAmplitude ?? "auto",
      prompt,
      durationSec,
      resolution: "720p",
      cutAtSec: null,
      estimatedCredits: cost.credits,
      estimatedCny: cny.estimatedCny,
      expectedTimelineVersion: material.timeline.version,
      placement: {
        kind: "timeline-overlay",
        startFrame,
        targetEndFrame,
        leftImageId: left!.id,
        rightImageId: right!.id,
      },
    },
  };
}

/**
 * 右键空档「自动创建镜头」的直接入口：跳过自然语言解析，直接拿两个明确的
 * 相邻镜头身份去建同一份衔接提案。复用 buildTransitionProposal，
 * 因此和聊天里打字触发的「衔接/转场」走的是完全同一条付费确认链路——
 * 这里只负责生成待确认卡片，真正调用模型仍然要等用户在卡片上点确认。
 */
export async function proposeGapTransition(params: {
  storyId: number;
  userId: number;
  beforeStableShotId: string;
  afterStableShotId: string;
}): Promise<GapTransitionProposalResult> {
  const material = await getStoryMaterialState(params.storyId, params.userId);
  if (!material) {
    return { status: "blocked", reply: "故事不存在或无权访问，暂时无法创建过渡镜头。" };
  }
  const byIdentity = new Map(
    material.shots.map(shot => [shot.stableShotId, shot] as const)
  );
  const items = [...material.timeline.items].sort(
    (left, right) => left.position - right.position
  );
  const sourceIndex = items.findIndex(
    item => item.stableShotId === params.beforeStableShotId
  );
  const targetIndex = items.findIndex(
    item => item.stableShotId === params.afterStableShotId
  );
  if (sourceIndex < 0 || targetIndex < 0) {
    return { status: "blocked", reply: "这两镜不在时间轴中，暂时无法创建过渡镜头。" };
  }
  // 空档右键只该对着紧挨的两镜生效；故事顺序不相邻就没有稳定的「前后」可言。
  if (targetIndex !== sourceIndex + 1) {
    return {
      status: "blocked",
      reply: "这处空档两侧的镜头故事顺序不相邻，暂不支持自动创建过渡镜头。",
    };
  }
  const built = buildTransitionProposal({
    storyId: params.storyId,
    instruction: "在时间轴空档处自动创建过渡镜头",
    expectedTimelineVersion: material.timeline.version,
    sourceItem: items[sourceIndex],
    targetItem: items[targetIndex],
    byIdentity,
    agentPrompt: null,
  });
  if (!built.proposal) {
    const missing = built.missingShotNos
      .map(shotNo =>
        displayShotCode(
          material.shots.find(shot => shot.shotNo === shotNo) ?? { shotNo }
        )
      )
      .join("、");
    return {
      status: "blocked",
      reply: `${missing || "这两镜"} 还没有可用的当前画面。先为两端各采用一张图片或一条视频，再来这里创建过渡镜头；现在不会调用模型或改时间轴。`,
    };
  }
  return {
    status: "ok",
    proposal: built.proposal,
    reply: `已锁定 ${displayShotCode(
      byIdentity.get(built.proposal.source.stableShotId) ??
        built.proposal.source
    )} → ${displayShotCode(
      byIdentity.get(built.proposal.target.stableShotId) ??
        built.proposal.target
    )} 的空档。先确认这张 2 秒 / 720p 的衔接卡片；确认后才会调用模型，预计约 ¥0.35。`,
  };
}

export async function runTimelineEditCommand(params: {
  storyId: number;
  userId: number;
  instruction: string;
  selectionContext?: TimelineEditSelectionContext;
}): Promise<TimelineEditResult> {
  const instruction = params.instruction.trim();
  if (!instruction) return { handled: false };

  const story = await getStoryById(params.storyId, params.userId);
  if (!story) return { handled: false };

  const material = await getStoryMaterialState(params.storyId, params.userId);
  if (!material) return { handled: false };
  const byIdentity = new Map(
    material.shots.map(shot => [shot.stableShotId, shot] as const)
  );
  // 时间轴条目按 position 排序做编号基准；不在轴上的镜头也列出（可恢复）。
  const items: StoryTimelineItem[] = [...material.timeline.items].sort(
    (left, right) => left.position - right.position
  );
  if (items.length === 0) return { handled: false };

  const selectedVideoAppendResult = await applySelectedVideoAppend({
    storyId: params.storyId,
    userId: params.userId,
    instruction,
    selectionContext: params.selectionContext,
    items,
    shotsByIdentity: byIdentity,
    timelineVersion: material.timeline.version,
  });
  if (selectedVideoAppendResult) return selectedVideoAppendResult;

  const selectedVideoResult = await applySelectedVideoEdit({
    storyId: params.storyId,
    userId: params.userId,
    instruction,
    selectionContext: params.selectionContext,
    items,
    shotsByIdentity: byIdentity,
    timelineVersion: material.timeline.version,
  });
  if (selectedVideoResult) return selectedVideoResult;

  const selectedImageResult = await applySelectedImageEdit({
    storyId: params.storyId,
    userId: params.userId,
    instruction,
    selectionContext: params.selectionContext,
    items,
    shotsByIdentity: byIdentity,
    timelineVersion: material.timeline.version,
  });
  if (selectedImageResult) return selectedImageResult;

  const shotTransformResult = await applyShotVisualTransform({
    storyId: params.storyId,
    userId: params.userId,
    instruction,
    selectionContext: params.selectionContext,
    items,
    shotsByIdentity: byIdentity,
    timelineVersion: material.timeline.version,
  });
  if (shotTransformResult) return shotTransformResult;

  const describe = (item: StoryTimelineItem, index: number): string => {
    const shot = byIdentity.get(item.stableShotId);
    const line =
      shot?.currentVideo?.subtitle || shot?.currentImage?.prompt || "";
    const seconds = (item.plannedDurationMs / 1000).toFixed(1);
    return [
      `${index + 1}. ${promptShotCode(shot ?? { shotNo: index + 1 })}`,
      `${seconds}秒`,
      item.included ? "在轴上" : "已移除",
      line ? line.slice(0, 30) : "",
    ]
      .filter(Boolean)
      .join("｜");
  };

  const ruleTransitionIntent = isRuleTransitionIntent(instruction);
  const hasRulePairContext =
    Boolean(params.selectionContext) ||
    explicitShotNos(instruction).length >= 2;
  const rulePair = ruleTransitionIntent
    ? transitionPairFromSelection({
        items,
        byIdentity,
        selectionContext: params.selectionContext,
        instruction,
      })
    : null;

  const result: RawAgentPayload | null =
    rulePair || (ruleTransitionIntent && hasRulePairContext)
      ? { isEditCommand: true, operations: [] }
      : (
          await runJsonAgent<RawAgentPayload>({
            systemPrompt: buildSystemPrompt(items.map(describe)),
            message: instruction,
            maxTokens: 600,
            fallback: () => ({
              isEditCommand: ruleTransitionIntent,
              operations: [],
            }),
          })
        ).parsed;

  if (!result || result.isEditCommand !== true) return { handled: false };

  const agentPair = transitionPairFromAgent({
    value: result.transitionProposal,
    items,
  });
  const transitionPair = rulePair ?? agentPair;
  if (ruleTransitionIntent || result.transitionProposal != null) {
    if (!transitionPair) {
      return {
        handled: true,
        reply:
          "我知道你要做镜头衔接，但还没锁定一对相邻镜头。请选中其中一镜（默认会接下一镜），或直接告诉我是第几镜到第几镜；现在不会调用模型或改时间轴。",
        appliedCount: 0,
      };
    }
    const rawTransition = recordOf(result.transitionProposal);
    const agentPrompt =
      typeof rawTransition?.prompt === "string" ? rawTransition.prompt : null;
    const built = buildTransitionProposal({
      storyId: params.storyId,
      instruction,
      expectedTimelineVersion: material.timeline.version,
      sourceItem: transitionPair[0],
      targetItem: transitionPair[1],
      byIdentity,
      agentPrompt,
    });
    if (!built.proposal) {
      const missing = built.missingShotNos
        .map(shotNo =>
          displayShotCode(
            material.shots.find(shot => shot.shotNo === shotNo) ?? { shotNo }
          )
        )
        .join("、");
      return {
        handled: true,
        reply: `${missing || "这两镜"} 还没有可用的当前画面。先为两端各采用一张图片或一条视频，我再给你确认衔接；现在不会调用模型或改时间轴。`,
        appliedCount: 0,
      };
    }
    return {
      handled: true,
      reply: `我已锁定 ${displayShotCode(
        byIdentity.get(built.proposal.source.stableShotId) ??
          built.proposal.source
      )} → ${displayShotCode(
        byIdentity.get(built.proposal.target.stableShotId) ??
          built.proposal.target
      )}。先确认这张 2 秒 / 720p 的衔接卡片；确认后才会调用模型，预计约 ¥0.35。`,
      appliedCount: 0,
      proposal: built.proposal,
    };
  }

  const operations: RawOperation[] = Array.isArray(result.operations)
    ? (result.operations as RawOperation[])
    : [];
  const reply =
    typeof result.reply === "string" && result.reply.trim()
      ? result.reply.trim()
      : "收到，这就调整时间轴。";

  // 序号 → 身份的映射以进场时的编号为准（执行过程中不重编号）。
  const identityOfEntry = (entry: unknown): string | null => {
    const num = asEntryNumber(entry, items.length);
    return num === null ? null : items[num - 1].stableShotId;
  };

  let working = items.map(item => ({ ...item }));
  const skipped: string[] = [];
  let appliedCount = 0;

  for (const raw of operations.slice(0, 12)) {
    const op = typeof raw.op === "string" ? raw.op : "";
    if (op === "reorder") {
      const order = Array.isArray(raw.order) ? raw.order : [];
      const identities = order.map(identityOfEntry);
      const unique = new Set(identities.filter(Boolean));
      if (
        identities.some(identity => identity === null) ||
        unique.size !== working.length
      ) {
        skipped.push("整轴重排的序号不完整，已跳过");
        continue;
      }
      const byId = new Map(working.map(item => [item.stableShotId, item]));
      working = identities.map(identity => byId.get(identity!)!);
      appliedCount += 1;
      continue;
    }

    const identity = identityOfEntry(raw.entry);
    if (!identity) {
      skipped.push(`有一步没定位到镜头（序号 ${String(raw.entry)}），已跳过`);
      continue;
    }
    const index = working.findIndex(item => item.stableShotId === identity);
    if (index < 0) continue;

    if (op === "remove" || op === "restore") {
      working[index] = { ...working[index], included: op === "restore" };
      appliedCount += 1;
    } else if (op === "setDuration") {
      const seconds = Number(raw.seconds);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        skipped.push("时长数值不合法，已跳过");
        continue;
      }
      working[index] = {
        ...working[index],
        plannedDurationMs: Math.min(
          MAX_DURATION_MS,
          Math.max(MIN_DURATION_MS, Math.round(seconds * 1000))
        ),
      };
      appliedCount += 1;
    } else if (op === "move") {
      const target = asEntryNumber(raw.toPosition, working.length);
      if (target === null) {
        skipped.push("移动的目标位置不合法，已跳过");
        continue;
      }
      const [moved] = working.splice(index, 1);
      working.splice(target - 1, 0, moved);
      appliedCount += 1;
    } else {
      skipped.push(`不认识的操作 ${op || "(空)"}，已跳过`);
    }
  }

  if (appliedCount > 0) {
    await updateStoryTimeline({
      storyId: params.storyId,
      userId: params.userId,
      expectedVersion: material.timeline.version,
      items: working.map((item, position) => ({ ...item, position })),
    });
  }

  const suffix = skipped.length > 0 ? `（${skipped.join("；")}）` : "";
  return {
    handled: true,
    reply: `${reply}${suffix}`,
    appliedCount,
    undoSnapshot: appliedCount > 0 ? material.timeline.items : undefined,
  };
}
