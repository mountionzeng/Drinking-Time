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
 * - 指令不是剪辑意图时返回 handled=false，调用方放行回普通小酌聊天。
 */
import { createHash } from "node:crypto";
import { getStoryById, updateStoryTimeline } from "../db";
import type {
  ShotMaterialState,
  StoryTimelineItem,
} from "../../shared/storyMaterial";
import { runJsonAgent } from "./agentRuntime";
import { getStoryMaterialState } from "./storyMaterials";
import {
  transitionVideoFrameTime,
  transitionVideoWindow,
} from "./videoEndpointFrames";

export type TimelineEditSelectionContext = {
  stableShotId?: string | null;
  shotNo?: number | null;
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
  prompt: string;
  durationSec: 2;
  resolution: "720p";
  cutAtSec: 1.4;
  estimatedCredits: 10;
  estimatedCny: 0.35;
  expectedTimelineVersion: number;
};

export type TimelineEditResult =
  | { handled: false }
  | {
      handled: true;
      reply: string;
      appliedCount: number;
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

  const describe = (item: StoryTimelineItem, index: number): string => {
    const shot = byIdentity.get(item.stableShotId);
    const line =
      shot?.currentVideo?.subtitle || shot?.currentImage?.prompt || "";
    const seconds = (item.plannedDurationMs / 1000).toFixed(1);
    return [
      `${index + 1}. SH${String(shot?.shotNo ?? index + 1).padStart(2, "0")}`,
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
        .map(shotNo => `SH${String(shotNo).padStart(2, "0")}`)
        .join("、");
      return {
        handled: true,
        reply: `${missing || "这两镜"} 还没有可用的当前画面。先为两端各采用一张图片或一条视频，我再给你确认衔接；现在不会调用模型或改时间轴。`,
        appliedCount: 0,
      };
    }
    return {
      handled: true,
      reply: `我已锁定 SH${String(built.proposal.source.shotNo).padStart(2, "0")} → SH${String(built.proposal.target.shotNo).padStart(2, "0")}。先确认这张 2 秒 / 720p 的衔接卡片；确认后才会调用模型，预计 10 credits（约 ¥0.35）。`,
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
  return { handled: true, reply: `${reply}${suffix}`, appliedCount };
}
