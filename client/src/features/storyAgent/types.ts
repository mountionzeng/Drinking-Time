import type { SelectionContext } from "@shared/selectionContext";

/**
 * Story Guide Agent — shared types
 */

export type PromptCandidateStatus = "pending" | "confirmed" | "rejected";

export type PromptCandidateReference = {
  revisionId: number;
  nodeId: number;
  expectedVersion: number;
  label: string;
  status: PromptCandidateStatus;
};

export type EditingTransitionCandidateStatus =
  | "pending"
  | "generating"
  | "applied"
  | "rejected"
  | "failed";

export type EditingTransitionEndpointReference =
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
      imageUrl: string;
    };

export type EditingTransitionCandidateReference = {
  candidateId: string;
  provisionalStableShotId: string;
  storyId: number;
  source: EditingTransitionEndpointReference;
  target: EditingTransitionEndpointReference;
  instruction: string;
  movementAmplitude?: "auto" | "small" | "medium" | "large";
  prompt: string;
  durationSec: number;
  resolution: "720p";
  cutAtSec: 1.4 | null;
  estimatedCredits: number;
  estimatedCny: number;
  expectedTimelineVersion: number;
  placement?:
    | {
        kind: "timeline-overlay";
        startFrame: number;
        targetEndFrame: number;
        leftImageId: number;
        rightImageId: number;
      }
    | {
        kind: "story-shot";
        left: EditingTransitionImageClipReference;
        right: EditingTransitionImageClipReference;
      };
  status: EditingTransitionCandidateStatus;
  error?: string;
  retryable?: boolean;
};

export type EditingTransitionImageClipReference = {
  clipId: string;
  imageId: number;
  timelineFrame: number;
  visualLayer: number;
};

export type StoryboardImageRerenderActionReference = {
  storyId: number | null;
  stableShotId: string | null;
  shotNo: number;
  cueCode: string | null;
  /** Exact storyboard image selected when the edit was requested. */
  imageId?: number | null;
  /** Original user wording; this must reach the image model unchanged. */
  instruction?: string | null;
};

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  /** If set, this user message included an uploaded photo. */
  photoUrl?: string;
  /** If set, this assistant turn produced a card (for inline UI hints). */
  spawnedCardId?: string;
  /** If set, this user message was a selection edit instruction. */
  selectionQuote?: SelectionQuote;
  /** Agent edits are proposals until the user explicitly confirms them. */
  promptCandidate?: PromptCandidateReference;
  /** 对当前镜头图片要求完成确认后，直接回到既有四图重渲链路。 */
  imageRerenderAction?: StoryboardImageRerenderActionReference;
  /** 聊聊提出的付费镜头衔接；只有卡片上的确认按钮会提交 302。 */
  editingTransitionCandidate?: EditingTransitionCandidateReference;
}

export interface StoryCard {
  id: string;
  title: string;
  content: string;
  rawText?: string;
  sourceQuote?: string;
  dialogue?: string;
  emotion: string;
  emotionOptions?: string[];
  emotionBlend?: string[];
  sensoryDetails: string[];
  intensity?: number;
  direction?: string;
  complexity?: string;
  trigger?: string;
  dramaticFunction?: string;
  personalTrace?: string;
  retrievalQuery?: string;
  themeHints?: string[];
  outlierSignal?: string;
  softMembership?: string[];
  createdAt: number;
}

export interface ScriptScene {
  sceneNo: string;
  fromCardId: string;
  visual: string;
  emotion: string;
}

export interface GeneratedScript {
  id: string;
  title: string;
  logline: string;
  theme?: string;
  scenes: ScriptScene[];
  arcSummary: string;
  variants?: Array<{
    mode: "克制版" | "戏剧版" | "诗意版";
    logline: string;
    arc: string;
    treatment: string;
  }>;
  boringCheck?: {
    hasConflict: boolean;
    hasTurn: boolean;
    hasWish: boolean;
    hasCost: boolean;
    hasChange: boolean;
    note: string;
  };
  /** Card order this script was generated from — useful for re-running. */
  cardOrder: string[];
  createdAt: number;
}

export interface NarrativeJob {
  intentSummary: string;
  audience: string;
  claim: string;
  roleConcern?: string;
  causalExplanation?: string;
  evidence: string;
  storyContext?: string;
  visualTranslation: string;
  externalValue?: string;
  recommendationStatus?: string;
  avoidMisread: string;
}

export interface StoryShot {
  /** Stable identity shared by story body, images, videos and chat selections. */
  stableShotId?: string;
  /** Back-compat alias while older persisted stories are being backfilled. */
  shotIdentity?: string;
  shotNo: number;
  /** 幕 / 场编号，例如 SC01。用于按场景选择不同美术参考库。 */
  sceneNo?: string;
  /** 幕 / 场标题，例如“第一幕：被规训”。 */
  sceneTitle?: string;
  /** 该幕的美术参考标准，后续图片 / 视频渲染会作为场景库提示。 */
  sceneArtBrief?: string;
  /** Stable script cue such as 0107. It does not change when shots reorder. */
  cueCode?: string;
  /** Optional act label kept separately from the display order. */
  actNo?: string;
  subject: string;
  action: string;
  /** Rewritten video script for this shot; distinct from publishing copy and dialogue. */
  scriptText?: string;
  /** Immutable lineage for shots confirmed from a publishing-version preview. */
  publishingVideo?: {
    versionId: string;
    sourcePlatform?: string;
    groupId: string;
    segmentIds: string[];
    sourceParagraphIds: string[];
    confirmedRevision: number;
  };
  performance?: string;
  environmentMotion?: string;
  dialogue: string;
  /** 302 TTS 生成的旁白音频及其生成基线；文字变化后 UI 会提示重新生成。 */
  voiceAudioUrl?: string;
  voiceAudioText?: string;
  voiceAudioProvider?: string;
  voiceAudioVoice?: string;
  voiceAudioGeneratedAt?: number;
  /** 用于保证同一镜头最后发起的 TTS 请求优先于较早但较晚完成的请求。 */
  voiceAudioRequestStartedAt?: number;
  shotType: string;
  beat: string;
  cameraAngle: string;
  cameraMove: string;
  cameraHeight?: string;
  lens?: string;
  cameraPath?: string;
  subjectPath?: string;
  location: string;
  timeLight: string;
  lighting?: string;
  colorPalette?: string;
  materialTexture?: string;
  mood: string;
  sound: string;
  soundBridge?: string;
  styleRef: string;
  note: string;
  emotion: string;
  sourceCardContent: string;
  /** 当前镜头承担的用户/叙事意图，缺失时按 null 降级。 */
  intent?: string | null;
  /** 当前镜头为什么这样画，缺失时按 null 降级。 */
  rationale?: string | null;
  /** 图生视频第一帧应该落在什么画面状态。 */
  videoStart?: string;
  /** 图生视频这一镜结束时应该落到什么状态。 */
  videoEnd?: string;
  /** 与上一镜的视觉 / 动作 / 声音衔接。 */
  transitionIn?: string;
  /** 给下一镜留下的视觉 / 动作 / 声音钩子。 */
  transitionOut?: string;
  transitionIntent?: string;
  /** 可直接喂给图生视频模型的镜头运动提示词。 */
  videoPrompt?: string;
  /** 情绪电荷：本镜情绪 + beat 位置 + 与上一镜的流动 delta。 */
  emotionCharge?: string;
  /** 与上一镜的情绪转变描述。转折镜重点表达这个变化。 */
  emotionDelta?: string;
  /** 画布视觉锚摘要，供下游出图继承风格。 */
  visualAnchorText?: string;
  /** 最终出图 prompt：视觉内容 + 情绪电荷 + 视觉锚。 */
  promptDraft?: string;
  negativePrompt?: string;
  characterReference?: string;
  wardrobeReference?: string;
  hairReference?: string;
  sceneReference?: string;
  textureReference?: string;
  generationModel?: string;
  generationParams?: string;
  chatCutMapping?: {
    projectId?: string;
    sequenceId?: string;
    itemId?: string;
    assetId?: string;
    markerId?: string;
  };
  /** 非纪念型意图下，本镜承担的观众理解 / 论证任务。 */
  narrativeJob?: NarrativeJob;
  /** 最近一次真实出图使用的最终提示词与引用信息。 */
  promptRun?: {
    finalPrompt: string;
    generatedAt: number;
    imageId?: number;
    imageUrl?: string;
    source: "draw-this-moment" | "prompt-table-rerender" | "creation-agent";
    usedDimensions: string[];
    references?: Array<{
      kind: "baseImage" | "characterRef" | "styleRef";
      label: string;
      url?: string;
    }>;
  };
  /** 该镜引用的片段 ID 列表（来自提示词片段池）。 */
  fragmentRefs?: string[];
}

export interface VisualCanvasAnalysis {
  /** 客观内容：图里实际有什么，尽量不脑补。 */
  objective: string;
  /** 美术/情绪解读：这张图给人的审美和情绪感觉。 */
  aesthetic: string;
  visualStyle: string[];
  mood: string[];
  colorPalette: string[];
  composition: string;
  lighting: string;
  promptDraft: string;
  negativePrompt: string;
  confidence: number;
}

export interface VisualCanvasItem {
  id: string;
  title: string;
  imageUrl: string;
  originalImageUrl?: string;
  source: "reference" | "riff";
  parentId?: string;
  cardId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  prompt: string;
  userInstruction?: string;
  analysis: VisualCanvasAnalysis;
  createdAt: number;
}

export type SelectionState = SelectionContext;

export type SelectionQuote = Pick<
  SelectionState,
  | "sourceType"
  | "sourceId"
  | "selectedText"
  | "objectVersion"
  | "contentFingerprint"
  | "selection"
  | "confirmedImageRegion"
  | "storyId"
  | "stableShotId"
  | "shotNo"
  | "imageId"
  | "videoTakeId"
  | "rangeId"
>;

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeSelectionQuote(value: unknown): SelectionQuote | undefined {
  if (!value || typeof value !== "object") return undefined;
  const quote = value as Record<string, unknown>;
  if (
    typeof quote.sourceType !== "string" ||
    typeof quote.sourceId !== "string" ||
    typeof quote.selectedText !== "string"
  ) {
    return undefined;
  }
  return value as SelectionQuote;
}

function normalizeEditingTransitionEndpoint(
  value: unknown
): EditingTransitionEndpointReference | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const endpoint = value as Record<string, unknown>;
  if (
    typeof endpoint.stableShotId !== "string" ||
    typeof endpoint.shotNo !== "number" ||
    typeof endpoint.imageUrl !== "string"
  ) {
    return undefined;
  }
  if (endpoint.mediaKind === "video") {
    if (
      typeof endpoint.videoTakeId !== "number" ||
      (endpoint.rangeId !== null && typeof endpoint.rangeId !== "number") ||
      (endpoint.selectionType !== "full_take" &&
        endpoint.selectionType !== "range") ||
      typeof endpoint.atSec !== "number" ||
      typeof endpoint.mediaRevision !== "string"
    ) {
      return undefined;
    }
    return {
      mediaKind: "video",
      stableShotId: endpoint.stableShotId,
      shotNo: endpoint.shotNo,
      videoTakeId: endpoint.videoTakeId,
      rangeId: endpoint.rangeId,
      selectionType: endpoint.selectionType,
      atSec: endpoint.atSec,
      mediaRevision: endpoint.mediaRevision,
      imageUrl: endpoint.imageUrl,
    };
  }
  // 旧聊天里的图片候选没有 mediaKind；继续按 imageId 双读恢复。
  if (typeof endpoint.imageId !== "number") return undefined;
  return {
    mediaKind: "image",
    stableShotId: endpoint.stableShotId,
    shotNo: endpoint.shotNo,
    imageId: endpoint.imageId,
    imageUrl: endpoint.imageUrl,
  };
}

function normalizeEditingTransitionCandidate(
  value: unknown
): EditingTransitionCandidateReference | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  const source = normalizeEditingTransitionEndpoint(candidate.source);
  const target = normalizeEditingTransitionEndpoint(candidate.target);
  const rawStatus = candidate.status;
  const placementRecord =
    candidate.placement &&
    typeof candidate.placement === "object" &&
    !Array.isArray(candidate.placement)
      ? (candidate.placement as Record<string, unknown>)
      : null;
  const legacyPlacement =
    placementRecord?.kind === "timeline-overlay" &&
    typeof placementRecord.startFrame === "number" &&
    typeof placementRecord.targetEndFrame === "number" &&
    typeof placementRecord.leftImageId === "number" &&
    typeof placementRecord.rightImageId === "number"
      ? {
          kind: "timeline-overlay" as const,
          startFrame: placementRecord.startFrame,
          targetEndFrame: placementRecord.targetEndFrame,
          leftImageId: placementRecord.leftImageId,
          rightImageId: placementRecord.rightImageId,
        }
      : undefined;
  const normalizeImageClipReference = (
    raw: unknown
  ): EditingTransitionImageClipReference | undefined => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const value = raw as Record<string, unknown>;
    return typeof value.clipId === "string" &&
      value.clipId.length > 0 &&
      typeof value.imageId === "number" &&
      Number.isInteger(value.imageId) &&
      value.imageId > 0 &&
      typeof value.timelineFrame === "number" &&
      Number.isInteger(value.timelineFrame) &&
      value.timelineFrame >= 0 &&
      typeof value.visualLayer === "number" &&
      Number.isInteger(value.visualLayer) &&
      value.visualLayer >= 0
      ? {
          clipId: value.clipId,
          imageId: value.imageId,
          timelineFrame: value.timelineFrame,
          visualLayer: value.visualLayer,
        }
      : undefined;
  };
  const left = normalizeImageClipReference(placementRecord?.left);
  const right = normalizeImageClipReference(placementRecord?.right);
  const storyShotPlacement =
    placementRecord?.kind === "story-shot" && left && right
      ? { kind: "story-shot" as const, left, right }
      : undefined;
  // A persisted new-style proposal must retain both canonical image clip
  // identities. Dropping a malformed placement would incorrectly turn it into
  // a legacy gap proposal that the confirmation UI could still submit.
  if (placementRecord?.kind === "story-shot" && !storyShotPlacement) {
    return undefined;
  }
  const placement = storyShotPlacement ?? legacyPlacement;
  const allowedStatus =
    rawStatus === "pending" ||
    rawStatus === "generating" ||
    rawStatus === "applied" ||
    rawStatus === "rejected" ||
    rawStatus === "failed"
      ? rawStatus
      : null;
  if (
    typeof candidate.candidateId !== "string" ||
    typeof candidate.provisionalStableShotId !== "string" ||
    typeof candidate.storyId !== "number" ||
    !source ||
    !target ||
    typeof candidate.instruction !== "string" ||
    typeof candidate.prompt !== "string" ||
    typeof candidate.durationSec !== "number" ||
    !Number.isInteger(candidate.durationSec) ||
    candidate.durationSec < 1 ||
    candidate.durationSec > 8 ||
    candidate.resolution !== "720p" ||
    (candidate.cutAtSec !== 1.4 && candidate.cutAtSec !== null) ||
    typeof candidate.estimatedCredits !== "number" ||
    typeof candidate.estimatedCny !== "number" ||
    typeof candidate.expectedTimelineVersion !== "number" ||
    !allowedStatus
  ) {
    return undefined;
  }
  const interrupted = allowedStatus === "generating";
  return {
    candidateId: candidate.candidateId,
    provisionalStableShotId: candidate.provisionalStableShotId,
    storyId: candidate.storyId,
    source,
    target,
    instruction: candidate.instruction,
    ...(candidate.movementAmplitude === "auto" ||
    candidate.movementAmplitude === "small" ||
    candidate.movementAmplitude === "medium" ||
    candidate.movementAmplitude === "large"
      ? { movementAmplitude: candidate.movementAmplitude }
      : {}),
    prompt: candidate.prompt,
    durationSec: candidate.durationSec,
    resolution: "720p",
    cutAtSec: candidate.cutAtSec,
    estimatedCredits: candidate.estimatedCredits,
    estimatedCny: candidate.estimatedCny,
    expectedTimelineVersion: candidate.expectedTimelineVersion,
    ...(placement ? { placement } : {}),
    status: interrupted ? "failed" : allowedStatus,
    error: interrupted
      ? "上次生成被页面刷新打断；继续会查询同一任务，不会重复提交。"
      : typeof candidate.error === "string"
        ? candidate.error
        : undefined,
    retryable:
      interrupted || typeof candidate.retryable !== "boolean"
        ? true
        : candidate.retryable,
  };
}

export function normalizeChatMessages(
  rawMessages: unknown,
  fallbackMessages: ChatMessage[]
): ChatMessage[] {
  if (!Array.isArray(rawMessages) || rawMessages.length === 0)
    return fallbackMessages;
  const converted = rawMessages
    .map((m, i) => {
      if (!m || typeof m !== "object") return null;
      const obj = m as Record<string, unknown>;
      const role =
        obj.role === "user" || obj.who === "u"
          ? "user"
          : obj.role === "assistant" || obj.who === "s" || obj.who === "a"
            ? "assistant"
            : null;
      const content = stringValue(obj.content) ?? stringValue(obj.text) ?? "";
      const photoUrl = stringValue(obj.photoUrl);
      if (!role || (!content.trim() && !photoUrl)) return null;
      const pending = obj.pendingCard as Record<string, unknown> | undefined;
      const message: ChatMessage = {
        id: stringValue(obj.id) ?? `msg-${i}-${Date.now()}`,
        role,
        content,
        timestamp:
          typeof obj.timestamp === "number" ? obj.timestamp : Date.now() + i,
      };
      if (photoUrl) {
        message.photoUrl = photoUrl;
      }
      if (
        pending &&
        typeof pending.cardId === "string" &&
        pending.status === "kept"
      ) {
        message.spawnedCardId = pending.cardId;
      }
      message.selectionQuote = normalizeSelectionQuote(obj.selectionQuote);
      if (obj.promptCandidate && typeof obj.promptCandidate === "object") {
        const candidate = obj.promptCandidate as Record<string, unknown>;
        if (
          typeof candidate.revisionId === "number" &&
          typeof candidate.nodeId === "number" &&
          typeof candidate.expectedVersion === "number" &&
          typeof candidate.label === "string" &&
          (candidate.status === "pending" ||
            candidate.status === "confirmed" ||
            candidate.status === "rejected")
        ) {
          message.promptCandidate = {
            revisionId: candidate.revisionId,
            nodeId: candidate.nodeId,
            expectedVersion: candidate.expectedVersion,
            label: candidate.label,
            status: candidate.status,
          };
        }
      }
      if (
        obj.imageRerenderAction &&
        typeof obj.imageRerenderAction === "object"
      ) {
        const action = obj.imageRerenderAction as Record<string, unknown>;
        if (typeof action.shotNo === "number") {
          message.imageRerenderAction = {
            storyId: typeof action.storyId === "number" ? action.storyId : null,
            stableShotId:
              typeof action.stableShotId === "string"
                ? action.stableShotId
                : null,
            shotNo: action.shotNo,
            cueCode: typeof action.cueCode === "string" ? action.cueCode : null,
            ...(typeof action.imageId === "number"
              ? { imageId: action.imageId }
              : {}),
            ...(typeof action.instruction === "string"
              ? { instruction: action.instruction }
              : {}),
          };
        }
      }
      message.editingTransitionCandidate = normalizeEditingTransitionCandidate(
        obj.editingTransitionCandidate
      );
      return message;
    })
    .filter((m): m is ChatMessage => Boolean(m));
  const compacted = compactChatMessages(converted);
  return compacted.length > 0 ? compacted : fallbackMessages;
}

export const FIRST_QUESTION =
  "今天有没有一件很小的事，在你心里留下了一点感觉？不用重要，随便说。";

export const ASSISTANT_DISPLAY_NAME = "聊聊";
const LEGACY_ASSISTANT_NAME = "小酌";

export function displayAssistantName(content: string): string {
  return content.split(LEGACY_ASSISTANT_NAME).join(ASSISTANT_DISPLAY_NAME);
}

// 开场只留 FIRST_QUESTION 这一句邀请。
// 原先前面还有一段自我介绍 preamble（「你好，我是聊聊——会听你说话的朋友，也是帮你把
// 一件今天的小事做成小短片的助手。」），一进门就先讲自己是谁、能干什么，占掉整屏第一眼，
// 而这些在页面别处已经说过；开场直接问一句，用户更快开口。
// 老故事里带 preamble 的开场仍由 isOpeningChatMessage 的兜底分支识别，不影响历史记录。
export const OPENING_MESSAGE = FIRST_QUESTION;

function compactMessageText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function isOpeningChatMessage(
  message: Pick<ChatMessage, "id" | "content">
): boolean {
  const content = compactMessageText(message.content);
  return (
    message.id === "first-question" ||
    content === compactMessageText(OPENING_MESSAGE) ||
    ((content.includes(`你好，我是${ASSISTANT_DISPLAY_NAME}`) ||
      content.includes(`你好，我是${LEGACY_ASSISTANT_NAME}`)) &&
      content.includes("今天有没有一件很小的事"))
  );
}

/**
 * Older story projections could replay the same opening message many times
 * with new ids and one shared timestamp. Compact only exact same-turn copies;
 * an intentionally repeated sentence at a later time remains a real turn.
 */
export function compactChatMessages(
  messages: readonly ChatMessage[]
): ChatMessage[] {
  const compacted: ChatMessage[] = [];
  const seenExactTurn = new Set<string>();
  let hasOpening = false;

  for (const message of messages) {
    if (isOpeningChatMessage(message)) {
      if (hasOpening) continue;
      hasOpening = true;
      compacted.push({ ...message, role: "assistant" });
      continue;
    }
    const key = [
      message.role,
      compactMessageText(message.content),
      message.photoUrl ?? "",
      String(message.timestamp),
    ].join("\u0000");
    if (seenExactTurn.has(key)) continue;
    seenExactTurn.add(key);
    compacted.push(message);
  }

  return compacted;
}

export function shouldShowReturningGreeting(
  messages: readonly ChatMessage[]
): boolean {
  const meaningful = compactChatMessages(messages).filter(
    message =>
      !isOpeningChatMessage(message) &&
      (message.content.trim().length > 0 || Boolean(message.photoUrl))
  );
  return (
    meaningful.some(message => message.role === "user") &&
    meaningful[meaningful.length - 1]?.role === "assistant"
  );
}

// ── 第二步：召回 + 记忆承诺 ──
// 老用户从「入口选择屏」点回一篇旧故事时，聊聊说的「我还记得上次……」再问候。
// 这是「记忆承诺」体验的核心一句：用真实留存的内容（logline / 最近一张卡片 / 标题）
// 证明「我记着」，把人温柔地接回这篇，邀请往下说。
//
// honesty 约束（R6 / R13）：
//   · 语气克制——只说「还记着 / 还留着 / 还在」，绝不承诺「永久 / 永远记住 / 都会记住」；
//     承诺强度被本地留存能力兜着（同账号服务端留存，不是永久），不能说死。
//   · 不再问「继续还是开新」——那是入口选择屏的事；这里只接回这一篇。
//   · 没有任何用户发言可召回时返回 null（不硬造记忆、不对空故事假装记得）。
// 守着这些约束的回归测试在 returningGreeting.test.ts。
export interface ReturningGreetingInput {
  /** 这篇故事里是否有过用户真实发言（只有开场白不算）。false → 不召回。 */
  hasPriorUserMessages: boolean;
  /** 故事 logline（最有画面感，优先用）。 */
  logline?: string | null;
  /** 最近一张卡片的原话锚点（card.sourceQuote，≤24 字），次选。 */
  lastCardQuote?: string | null;
  /** 故事标题，再次选。 */
  title?: string | null;
}

function clampGreetingText(value: string, max: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max)}…` : compact;
}

export function buildReturningGreeting(
  input: ReturningGreetingInput
): string | null {
  if (!input.hasPriorUserMessages) return null;
  const logline = input.logline?.trim();
  const quote = input.lastCardQuote?.trim();
  const title = input.title?.trim();
  if (logline) {
    return `我还记得我们上次聊到的——「${clampGreetingText(logline, 40)}」。今天想从这儿接着说吗？`;
  }
  if (quote) {
    return `上次你说到「${clampGreetingText(quote, 24)}」，我还记着。今天想接着往下聊吗？`;
  }
  if (title) {
    return `「${clampGreetingText(title, 24)}」我还留着呢。今天想从哪儿接着说？`;
  }
  return "我还在呢，上次聊的都留着。今天想从哪儿接着说？";
}
