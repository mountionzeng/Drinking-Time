import {
  normalizePublishingVideoStoryboardAggregate,
  type PublishingVideoStoryboardAggregate,
} from "./publishingVideoStoryboard";
import {
  resolveStoryIntentProfile,
  storyIntentProfileFromLegacy,
  normalizeIntentProposal,
  type StoryIntentProfile,
  type IntentProposal,
} from "./storyIntentProfile";
import type { ScopeKey, ScopedRevision } from "./scopedResource";
import {
  PUBLISHING_TREND_PLATFORM_IDS,
  normalizePublishingPlatformContextState,
  type PublishingPlatformContextState,
  type PublishingTrendPlatformId,
} from "./publishingPlatformContext";

export const PUBLISHING_PLATFORM_IDS = [
  "xiaohongshu",
  "x",
  "instagram",
  "linkedin",
  "wechat_moments",
  "douyin_tiktok",
] as const;

export type PublishingPlatformId = (typeof PUBLISHING_PLATFORM_IDS)[number];

export type PublishingCoverSafeArea = {
  /** Normalized coordinates in the final exported image. */
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type PublishingPlatformAdapter = {
  id: PublishingPlatformId;
  label: string;
  shortLabel: string;
  aliases: readonly string[];
  copyGuidance: string;
  cover: {
    width: number;
    height: number;
    aspectRatio: string;
    safeArea: PublishingCoverSafeArea;
  };
};

export const PUBLISHING_PLATFORM_REGISTRY = {
  xiaohongshu: {
    id: "xiaohongshu",
    label: "小红书",
    shortLabel: "小红书",
    aliases: ["小红书", "xhs", "rednote"],
    copyGuidance: "开头尽快说清真实处境，使用易读短段落，可选少量话题标签。",
    cover: {
      width: 1080,
      height: 1440,
      aspectRatio: "3:4",
      safeArea: { top: 0.1, right: 0.9, bottom: 0.88, left: 0.1 },
    },
  },
  x: {
    id: "x",
    label: "X",
    shortLabel: "X",
    aliases: ["x", "twitter", "推特"],
    copyGuidance:
      "首句直接给出判断；单条不超过 X 的 280 加权字符，较长内容拆成最多 8 条、逐条编号的 thread。",
    cover: {
      width: 1600,
      height: 900,
      aspectRatio: "16:9",
      safeArea: { top: 0.12, right: 0.9, bottom: 0.88, left: 0.1 },
    },
  },
  instagram: {
    id: "instagram",
    label: "Instagram",
    shortLabel: "Instagram",
    aliases: ["instagram", "ig"],
    copyGuidance:
      "用视觉感强的短开头进入正文，保持自然语气，可选克制 hashtags。",
    cover: {
      width: 1080,
      height: 1350,
      aspectRatio: "4:5",
      safeArea: { top: 0.1, right: 0.9, bottom: 0.9, left: 0.1 },
    },
  },
  linkedin: {
    id: "linkedin",
    label: "LinkedIn",
    shortLabel: "LinkedIn",
    aliases: ["linkedin", "领英"],
    copyGuidance: "先交代专业语境，再给证据与个人判断，保持清晰的段落节奏。",
    cover: {
      width: 1200,
      height: 627,
      aspectRatio: "1.91:1",
      safeArea: { top: 0.12, right: 0.9, bottom: 0.88, left: 0.1 },
    },
  },
  wechat_moments: {
    id: "wechat_moments",
    label: "朋友圈",
    shortLabel: "朋友圈",
    aliases: ["朋友圈", "wechat moments", "moments"],
    copyGuidance: "像对熟人说话一样自然，控制格式和标签，不把分享写成营销稿。",
    cover: {
      width: 1080,
      height: 1080,
      aspectRatio: "1:1",
      safeArea: { top: 0.1, right: 0.9, bottom: 0.9, left: 0.1 },
    },
  },
  douyin_tiktok: {
    id: "douyin_tiktok",
    label: "抖音 / TikTok",
    shortLabel: "抖音",
    aliases: ["抖音", "douyin", "tiktok"],
    copyGuidance: "开头先给钩子，句子短而可读，可选少量话题标签。",
    cover: {
      width: 1080,
      height: 1920,
      aspectRatio: "9:16",
      safeArea: { top: 0.14, right: 0.88, bottom: 0.78, left: 0.12 },
    },
  },
} as const satisfies Record<PublishingPlatformId, PublishingPlatformAdapter>;

export const DEFAULT_PUBLISHING_PLATFORM: PublishingPlatformId = "xiaohongshu";
export const PUBLISHING_DRAFT_STATE_VERSION = 1 as const;

export type PublishingDraftContent = {
  title: string;
  body: string;
  tags: string[];
};

export const X_POST_WEIGHTED_CHARACTER_LIMIT = 280;
export const X_THREAD_POST_LIMIT = 8;

export type XThreadStats = {
  postCount: number;
  weightedLengths: number[];
  maxWeightedLength: number;
  error: string | null;
};

function xCharacterWeight(character: string): number {
  const codePoint = character.codePointAt(0) ?? 0;
  return (codePoint >= 0x0000 && codePoint <= 0x10ff) ||
    (codePoint >= 0x2000 && codePoint <= 0x200d) ||
    (codePoint >= 0x2010 && codePoint <= 0x201f) ||
    (codePoint >= 0x2032 && codePoint <= 0x2037)
    ? 1
    : 2;
}

/** A conservative local equivalent of X's weighted character counter. */
export function xWeightedCharacterLength(value: string): number {
  return Array.from(value).reduce(
    (total, character) => total + xCharacterWeight(character),
    0
  );
}

export function splitXThreadPosts(body: string): string[] {
  return body
    .trim()
    .split(/\n[\t ]*\n+/)
    .map(post => post.trim())
    .filter(Boolean);
}

export function numberXThreadPosts(body: string): string {
  const posts = splitXThreadPosts(body).map(post =>
    post.replace(/^\s*\d+\s*\/\s*\d+\s+/, "").trim()
  );
  if (posts.length <= 1) return posts[0] ?? "";
  return posts
    .map((post, index) => `${index + 1}/${posts.length} ${post}`)
    .join("\n\n");
}

function publishingTagsText(tags: string[]): string {
  return tags
    .map(tag => tag.trim().replace(/^#+/, ""))
    .filter(Boolean)
    .map(tag => `#${tag}`)
    .join(" ");
}

export function buildXPublishableText(content: PublishingDraftContent): string {
  const body = numberXThreadPosts(content.body);
  const tags = publishingTagsText(content.tags);
  return [body, tags].filter(Boolean).join("\n");
}

export function getXThreadStats(content: PublishingDraftContent): XThreadStats {
  const posts = splitXThreadPosts(numberXThreadPosts(content.body));
  const publishablePosts = [...posts];
  const tags = publishingTagsText(content.tags);
  if (tags && publishablePosts.length > 0) {
    const lastIndex = publishablePosts.length - 1;
    publishablePosts[lastIndex] = `${publishablePosts[lastIndex]}\n${tags}`;
  }
  const weightedLengths = publishablePosts.map(xWeightedCharacterLength);
  const maxWeightedLength = Math.max(0, ...weightedLengths);
  let error: string | null = null;
  if (posts.length === 0) {
    error = "X 正文不能为空";
  } else if (posts.length > X_THREAD_POST_LIMIT) {
    error = `X thread 最多 ${X_THREAD_POST_LIMIT} 条`;
  } else {
    const oversizedIndex = weightedLengths.findIndex(
      length => length > X_POST_WEIGHTED_CHARACTER_LIMIT
    );
    if (oversizedIndex >= 0) {
      error = `X thread 第 ${oversizedIndex + 1} 条超过 ${X_POST_WEIGHTED_CHARACTER_LIMIT} 加权字符`;
    }
  }
  return {
    postCount: posts.length,
    weightedLengths,
    maxWeightedLength,
    error,
  };
}

export function getPublishingContentError(
  platform: PublishingPlatformId,
  content: PublishingDraftContent
): string | null {
  return platform === "x" ? getXThreadStats(content).error : null;
}

export type PublishingStoryCore = {
  revision: number;
  facts: string[];
  thesis: string;
  emotion: string;
  voiceTraits: string[];
  visualConcept: string;
  updatedAt: number;
};

/**
 * A version's story-making mission. This is deliberately separate from a
 * publishing platform: the same story can be a gift for one person and also
 * have a public-sharing version without either version rewriting the other.
 */
export const PUBLISHING_NARRATIVE_PURPOSES = [
  "preserve",
  "gift",
  "share",
  "persuade",
  "create",
] as const;

export type PublishingNarrativePurpose =
  (typeof PUBLISHING_NARRATIVE_PURPOSES)[number];

export type PublishingNarrativeIntent = {
  primaryPurpose: PublishingNarrativePurpose;
  secondaryPurposes: PublishingNarrativePurpose[];
  coreAudience: string;
  secondaryAudiences: string[];
  status: "provisional" | "confirmed";
  updatedAt: number;
};

export const PUBLISHING_NARRATIVE_PURPOSE_LABELS: Record<
  PublishingNarrativePurpose,
  string
> = {
  preserve: "留存",
  gift: "赠予",
  share: "分享",
  persuade: "介绍／说服",
  create: "创作",
};

export function publishingNarrativePurposeLabel(
  purpose: PublishingNarrativePurpose
): string {
  return PUBLISHING_NARRATIVE_PURPOSE_LABELS[purpose];
}

export type PublishingPlatformDraft = {
  platform: PublishingPlatformId;
  content: PublishingDraftContent;
  /** Last content explicitly accepted through Generate, Convert, or Apply. */
  appliedBaseline: PublishingDraftContent;
  sourceCoreRevision: number;
  revision: number;
  needsReview: boolean;
  updatedAt: number;
};

export type PublishingCoverReference = {
  assetId: number;
  sourceCoreRevision: number;
  createdAt: number;
};

/** One paid request asks for four images; pixel QA may quarantine some of them. */
export type PublishingCoverCandidateIds = number[];

/** 用户参考图中经 Vision 提取、并允许用户逐项修订的美术信息。 */
export type PublishingCoverArtReference = {
  label: string;
  /** 只保存可安全持久化的 URL；内联大图不进入故事状态。 */
  imageUrl?: string;
  style: string[];
  palette: string[];
  light: string[];
  composition: string[];
  material: string[];
  mood: string[];
};

export type PublishingCoverRound = {
  id: string;
  platform: PublishingPlatformId;
  sourceCoreRevision: number;
  parentAssetId: number | null;
  feedback: string;
  /** 本轮实际使用的累计用户要求；feedback 仅保留本轮新增文字以兼容旧数据。 */
  instructions?: string[];
  /** 本轮实际使用的参考图美术 DNA 快照。 */
  artReference?: PublishingCoverArtReference | null;
  assetIds: PublishingCoverCandidateIds;
  /**
   * Legacy rounds dropped risky candidates outright. Kept so old data still
   * explains why a paid round shows fewer than four images.
   */
  qualityRejectedCount?: number;
  /**
   * Candidates pixel QA flagged for text/logo/watermark risk. They stay in
   * assetIds and stay selectable: QA advises, the user decides.
   */
  qualityFlaggedAssetIds?: number[];
  /**
   * QA could not run at all (provider unreachable). Without this, "inspected
   * and clean" and "never inspected" both look like an empty flag list, and the
   * UI silently presents unchecked images as if they had passed.
   */
  qualityCheckUnavailable?: boolean;
  qualityCheckedAt?: number;
  createdAt: number;
};

/**
 * One paid cover request at a time. This receipt is deliberately stored with
 * the Story rather than kept in React: the provider task can outlive a tab,
 * a request, or a dev-server reload.
 */
export type PublishingCoverGeneration = {
  operationToken: string;
  versionId: string;
  status: "pending" | "completed" | "failed" | "unknown";
  platform: PublishingPlatformId;
  provider?: "midjourney" | "gpt-image" | "flux-schnell";
  referenceAssetId: number | null;
  feedback: string;
  instructions?: string[];
  artReference?: PublishingCoverArtReference | null;
  prompt: string;
  roundId: string;
  taskId: string | null;
  claimedAt: number;
  updatedAt: number;
  expiresAt: number;
  error?: string;
};

const RECOVERABLE_COVER_GENERATION_ERROR =
  /timeout|timed out|fetch failed|terminated|other side closed|network|socket|tls|econn|epipe|aborted|temporar|超时|网络|断开|暂时|隔离|质检/i;

/**
 * A provider task id is a paid-job receipt. Transient transport failures must
 * resume that receipt instead of creating another paid cover request. So must
 * failures we caused after delivery — a round the pixel gate quarantined was
 * still produced and still billed, and its images are one free query away.
 */
export function isRecoverablePublishingCoverGeneration(
  generation: PublishingCoverGeneration | null | undefined
): generation is PublishingCoverGeneration & { taskId: string } {
  if (!generation?.taskId?.trim()) return false;
  if (generation.status === "pending") return true;
  if (generation.status !== "failed" && generation.status !== "unknown") {
    return false;
  }
  return RECOVERABLE_COVER_GENERATION_ERROR.test(generation.error ?? "");
}

export type PublishingConversationSnapshot = {
  messages: unknown[];
  updatedAt: number;
};

export type PublishingStoryVersion = {
  versionId: string;
  sequence: number;
  displayName: string;
  displayNameSource?: "manual" | "automatic";
  parentId: string | null;
  versionRevision: number;
  core: PublishingStoryCore | null;
  drafts: Partial<Record<PublishingPlatformId, PublishingPlatformDraft>>;
  activePlatform: PublishingPlatformId;
  selectedPlatforms: PublishingPlatformId[];
  /** The purpose and audience that generated this version. */
  narrativeIntent: PublishingNarrativeIntent;
  /** Immutable purpose/audience snapshot for this version. */
  intentSnapshot?: StoryIntentProfile;
  /** Canonical lifecycle records; rejected/superseded ids survive refresh. */
  intentProposals?: IntentProposal[];
  /** Version-scoped paid recovery receipt; never follows active selection. */
  coverGeneration?: PublishingCoverGeneration | null;
  /** Durable text-operation claims/results; always owned by this exact version. */
  textOperations?: Record<string, PublishingTextOperationReceipt>;
  /** Immutable provider snapshots and explicit tag selection, scoped per platform. */
  platformContexts?: Partial<Record<
    PublishingTrendPlatformId,
    PublishingPlatformContextState
  >>;
  platformStatuses?: Partial<Record<PublishingPlatformId,
    "inherited" | "carried" | "awaiting_generation" | "generation_failed" | "ready">>;
  cover: PublishingCoverReference | null;
  coverRounds: PublishingCoverRound[];
  conversationSnapshot: PublishingConversationSnapshot | null;
  /** Version-local preview/confirmed script state. Never projected across versions. */
  videoStoryboard: PublishingVideoStoryboardAggregate | null;
};

export type PublishingDraftState = {
  version: typeof PUBLISHING_DRAFT_STATE_VERSION;
  revision: number;
  activePlatform: PublishingPlatformId;
  selectedPlatforms: PublishingPlatformId[];
  core: PublishingStoryCore | null;
  drafts: Partial<Record<PublishingPlatformId, PublishingPlatformDraft>>;
  cover: PublishingCoverReference | null;
  coverRounds: PublishingCoverRound[];
  /** Latest paid cover request, persisted so its 302 task can be resumed. */
  coverGeneration?: PublishingCoverGeneration | null;
  updatedAt: number;
  /** Canonical story-level version projection (legacy callers may omit these). */
  activeVersionId?: string;
  versions?: PublishingStoryVersion[];
  containerRevision?: number;
  /** New writers set this after canonical materialization. */
  canonicalAuthority?: "versions";
  /** Persisted idempotency receipts for version operations. */
  versionOperationReceipts?: Record<string, string | PublishingVersionOperationReceipt>;
  /** Formal Storyboard activation is independent from the browsed publishing version. */
  activeVideoStoryboardVersionId?: string | null;
  activeVideoStoryboardGroupId?: string | null;
};

export type PublishingBufferDisposition = "leave" | "carry" | "cancel";
export type PublishingTextOperationKind =
  | "generate"
  | "convert"
  | "rewrite"
  | "format_repair";
export type PublishingTextOperationScope = {
  storyId: number;
  versionId: string;
  platform: PublishingPlatformId;
  sourcePlatform?: PublishingPlatformId;
  containerRevision: number;
  versionRevision: number;
  coreRevision: number;
  draftRevision: number;
  sourceDraftRevision?: number;
  intentRevision: number;
  contextRevision: number;
};
export type PublishingTextOperationReceipt = {
  status: "pending" | "completed" | "failed";
  kind: PublishingTextOperationKind;
  operationToken: string;
  requestHash: string;
  scope: PublishingTextOperationScope;
  claimedAt: number;
  updatedAt: number;
  expiresAt: number;
  result?: {
    status: "created" | "candidate" | "preview" | "repaired";
    content: PublishingDraftContent;
    core?: PublishingStoryCoreContent;
    modelLabel: string;
    draftRevision?: number;
  };
  error?: string;
};
export type PublishingVersionOperationReceipt = {
  status: "committed";
  operationKind: "create_version" | "select_version" | "rename_version";
  operationToken: string;
  requestHash: string;
  versionId: string;
  resultActiveVersionId: string;
  sourceVersionId?: string;
  storyId: number;
  platform: PublishingPlatformId;
  bufferDisposition?: Exclude<PublishingBufferDisposition, "cancel">;
  sourceBufferKey?: string;
  sourceBufferHash?: string;
  committedAt: number;
  baseContainerRevision: number;
  baseVersionRevision?: number;
};

export type PublishingVersionRequestHashInput = {
  storyId: number;
  sourceVersionId: string;
  platform: PublishingPlatformId;
  baseContainerRevision: number;
  baseVersionRevision?: number;
  baseCoreRevision: number;
  baseDraftRevision: number;
  core: PublishingStoryCoreContent;
  content: PublishingDraftContent;
  narrativeIntent?: PublishingNarrativeIntent;
  bufferDisposition: PublishingBufferDisposition;
  sourceBufferKey?: string;
  sourceBufferHash?: string;
};

export type PublishingSimpleVersionRequestHashInput = {
  storyId: number;
  type: "select_version" | "rename_version";
  versionId: string;
  displayName?: string;
  baseContainerRevision: number;
  baseVersionRevision?: number;
};

export type PublishingTextOperationRequestHashInput = {
  kind: PublishingTextOperationKind;
  scope: PublishingTextOperationScope;
  payload: unknown;
};

function canonicalHashJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalHashJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalHashJson(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function stableFingerprint128(value: string): string {
  let h1 = 1_779_033_703;
  let h2 = 3_144_134_277;
  let h3 = 1_013_904_242;
  let h4 = 2_773_480_762;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ code, 597_399_067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2_869_860_233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951_274_213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2_716_044_179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597_399_067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2_869_860_233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951_274_213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2_716_044_179);
  return [h1, h2, h3, h4]
    .map(hash => (hash >>> 0).toString(16).padStart(8, "0"))
    .join("");
}

export function computePublishingVersionRequestHash(input: PublishingVersionRequestHashInput): string {
  const value = canonicalHashJson({
    storyId: input.storyId,
    sourceVersionId: input.sourceVersionId,
    platform: input.platform,
    baseContainerRevision: input.baseContainerRevision,
    baseVersionRevision: input.baseVersionRevision,
    baseCoreRevision: input.baseCoreRevision,
    baseDraftRevision: input.baseDraftRevision,
    core: input.core,
    content: input.content,
    narrativeIntent: input.narrativeIntent,
    bufferDisposition: input.bufferDisposition,
    sourceBufferKey: input.sourceBufferKey,
    sourceBufferHash: input.sourceBufferHash,
  });
  return `pv2-${stableFingerprint128(value)}`;
}

export function computePublishingSimpleVersionRequestHash(
  input: PublishingSimpleVersionRequestHashInput
): string {
  return `pvo2-${stableFingerprint128(canonicalHashJson({
    type: input.type,
    storyId: input.storyId,
    versionId: input.versionId,
    displayName: input.type === "rename_version" ? input.displayName : undefined,
    baseContainerRevision: input.baseContainerRevision,
    baseVersionRevision: input.baseVersionRevision,
  }))}`;
}

export function computePublishingTextOperationRequestHash(
  input: PublishingTextOperationRequestHashInput
): string {
  return `pto2-${stableFingerprint128(canonicalHashJson({
    kind: input.kind,
    scope: input.scope,
    payload: input.payload,
  }))}`;
}

export function computePublishingDraftContentHash(content: PublishingDraftContent): string {
  return `pb2-${stableFingerprint128(canonicalHashJson({
    title: content.title,
    body: content.body,
    tags: content.tags,
  }))}`;
}

export function publishingDraftBufferKey(
  storyId: number,
  platform: PublishingPlatformId,
  versionId = "v1"
): string {
  return versionId === "v1"
    ? `${storyId}:${platform}`
    : `${storyId}:${versionId}:${platform}`;
}

export type PublishingEditOutcome =
  | "wording_only"
  | "core_change"
  | "uncertain";

export type PublishingEditAssessment = {
  outcome: PublishingEditOutcome;
  reason: string;
};

export type PublishingStoryCoreContent = Omit<
  PublishingStoryCore,
  "revision" | "updatedAt"
>;

export function isPublishingPlatformId(
  value: unknown
): value is PublishingPlatformId {
  return (
    typeof value === "string" &&
    (PUBLISHING_PLATFORM_IDS as readonly string[]).includes(value)
  );
}

export function emptyPublishingDraftContent(): PublishingDraftContent {
  return { title: "", body: "", tags: [] };
}

export function emptyPublishingDraftState(
  now = Date.now()
): PublishingDraftState {
  const state: PublishingDraftState = {
    version: PUBLISHING_DRAFT_STATE_VERSION,
    revision: 0,
    activePlatform: DEFAULT_PUBLISHING_PLATFORM,
    selectedPlatforms: [DEFAULT_PUBLISHING_PLATFORM],
    core: null,
    drafts: {},
    cover: null,
    coverRounds: [],
    coverGeneration: null,
    updatedAt: now,
  };
  const version = versionFromLegacyState(state, "v1", 1, "V1", null);
  return {
    ...state,
    activeVersionId: version.versionId,
    versions: [version],
    containerRevision: 0,
    versionOperationReceipts: {},
    activeVideoStoryboardVersionId: null,
    activeVideoStoryboardGroupId: null,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNonNegativeInteger(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

function timestamp(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function cleanStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map(item => item.trim())
        .filter(Boolean)
    )
  );
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0;
}

function normalizeVersionOperationReceipt(
  token: string,
  value: unknown,
  versions: PublishingStoryVersion[]
): string | PublishingVersionOperationReceipt | null {
  const cleanToken = token.trim();
  if (!cleanToken) return null;
  const versionIds = new Set(versions.map(version => version.versionId));
  if (typeof value === "string") {
    const versionId = value.trim();
    return versionId && versionIds.has(versionId) ? versionId : null;
  }
  const receipt = record(value);
  if (!receipt || receipt.status !== "committed" || receipt.operationToken !== cleanToken) return null;
  const operationKind = receipt.operationKind;
  const requestHash = cleanString(receipt.requestHash).trim();
  const versionId = cleanString(receipt.versionId).trim();
  const resultActiveVersionId = cleanString(receipt.resultActiveVersionId).trim();
  if (
    !["create_version", "select_version", "rename_version"].includes(String(operationKind)) ||
    !requestHash ||
    !versionIds.has(versionId) ||
    !versionIds.has(resultActiveVersionId) ||
    !isFiniteNonNegativeInteger(receipt.storyId) ||
    !isFiniteNonNegativeInteger(receipt.committedAt) ||
    !isFiniteNonNegativeInteger(receipt.baseContainerRevision) ||
    (receipt.baseVersionRevision !== undefined && !isFiniteNonNegativeInteger(receipt.baseVersionRevision)) ||
    !isPublishingPlatformId(receipt.platform)
  ) return null;
  if (operationKind === "create_version") {
    const sourceVersionId = cleanString(receipt.sourceVersionId).trim();
    if (
      !versionIds.has(sourceVersionId) ||
      (receipt.bufferDisposition !== "leave" && receipt.bufferDisposition !== "carry")
    ) return null;
    if (
      receipt.bufferDisposition === "carry" &&
      (!cleanString(receipt.sourceBufferKey).trim() || !cleanString(receipt.sourceBufferHash).trim())
    ) return null;
  }
  return structuredClone(value) as PublishingVersionOperationReceipt;
}

function normalizeTextOperationReceipt(
  token: string,
  value: unknown,
  versionId: string
): PublishingTextOperationReceipt | null {
  const cleanToken = token.trim();
  const receipt = record(value);
  const scope = record(receipt?.scope);
  if (
    !cleanToken ||
    !receipt ||
    !scope ||
    receipt.operationToken !== cleanToken ||
    !["pending", "completed", "failed"].includes(String(receipt.status)) ||
    !["generate", "convert", "rewrite", "format_repair"].includes(String(receipt.kind)) ||
    !cleanString(receipt.requestHash).trim() ||
    scope.versionId !== versionId ||
    !isFiniteNonNegativeInteger(scope.storyId) ||
    !isPublishingPlatformId(scope.platform) ||
    (scope.sourcePlatform !== undefined && !isPublishingPlatformId(scope.sourcePlatform)) ||
    !isFiniteNonNegativeInteger(scope.containerRevision) ||
    !isFiniteNonNegativeInteger(scope.versionRevision) ||
    !isFiniteNonNegativeInteger(scope.coreRevision) ||
    !isFiniteNonNegativeInteger(scope.draftRevision) ||
    (scope.sourceDraftRevision !== undefined && !isFiniteNonNegativeInteger(scope.sourceDraftRevision)) ||
    !isFiniteNonNegativeInteger(scope.intentRevision) ||
    !isFiniteNonNegativeInteger(scope.contextRevision) ||
    !isFiniteNonNegativeInteger(receipt.claimedAt) ||
    !isFiniteNonNegativeInteger(receipt.updatedAt) ||
    !isFiniteNonNegativeInteger(receipt.expiresAt)
  ) return null;
  if (receipt.status === "completed") {
    const result = record(receipt.result);
    const rawContent = record(result?.content);
    const content = rawContent ? {
      title: cleanString(rawContent.title),
      body: cleanString(rawContent.body),
      tags: cleanStringList(rawContent.tags),
    } : null;
    const resultStatusMatches =
      (receipt.kind === "generate" && result?.status === "created") ||
      (receipt.kind === "convert" && (result?.status === "created" || result?.status === "candidate")) ||
      (receipt.kind === "rewrite" && result?.status === "preview") ||
      (receipt.kind === "format_repair" && result?.status === "repaired");
    if (
      !result ||
      !content ||
      !resultStatusMatches ||
      !cleanString(result.modelLabel).trim() ||
      getPublishingContentError(scope.platform as PublishingPlatformId, content) ||
      (result.draftRevision !== undefined && !isFiniteNonNegativeInteger(result.draftRevision)) ||
      (receipt.kind === "generate" && !cleanString(record(result.core)?.thesis).trim())
    ) return null;
  }
  return structuredClone(value) as PublishingTextOperationReceipt;
}

function boundedStringList(
  value: unknown,
  maxItems: number,
  maxItemLength: number
): string[] {
  return cleanStringList(value)
    .map(item => item.slice(0, maxItemLength))
    .slice(0, maxItems);
}

function isPublishingNarrativePurpose(
  value: unknown
): value is PublishingNarrativePurpose {
  return (
    typeof value === "string" &&
    (PUBLISHING_NARRATIVE_PURPOSES as readonly string[]).includes(value)
  );
}

function narrativePurposeFromLegacy(
  value: unknown
): PublishingNarrativePurpose {
  switch (value) {
    case "gift":
      return "gift";
    case "social_post":
      return "share";
    case "linkedin_job_search":
    case "portfolio":
    case "product_intro":
      return "persuade";
    case "fiction":
    case "creative_expression":
      return "create";
    default:
      return "preserve";
  }
}

function audienceFromLegacy(value: unknown): string {
  switch (value) {
    case "specific_person":
      return "某位重要的人";
    case "friends":
      return "朋友";
    case "public":
      return "公开观众";
    case "recruiters":
      return "招聘者";
    case "clients":
      return "客户";
    case "investors":
      return "投资人";
    case "teammates":
      return "团队";
    default:
      return "自己";
  }
}

export function defaultPublishingNarrativeIntent(
  now = Date.now()
): PublishingNarrativeIntent {
  return {
    primaryPurpose: "preserve",
    secondaryPurposes: [],
    coreAudience: "自己",
    secondaryAudiences: [],
    status: "provisional",
    updatedAt: now,
  };
}

/** Normalizes both the new profile and the legacy chat intent persisted on Story. */
export function normalizePublishingNarrativeIntent(
  value: unknown,
  now = Date.now()
): PublishingNarrativeIntent {
  const obj = record(value);
  if (!obj) return defaultPublishingNarrativeIntent(now);
  const primaryPurpose = isPublishingNarrativePurpose(obj.primaryPurpose)
    ? obj.primaryPurpose
    : narrativePurposeFromLegacy(obj.purpose);
  const secondaryPurposes = Array.isArray(obj.secondaryPurposes)
    ? Array.from(
        new Set(obj.secondaryPurposes.filter(isPublishingNarrativePurpose))
      )
        .filter(purpose => purpose !== primaryPurpose)
        .slice(0, 4)
    : [];
  const coreAudience =
    cleanString(obj.coreAudience).trim().slice(0, 80) ||
    audienceFromLegacy(obj.audience);
  return {
    primaryPurpose,
    secondaryPurposes,
    coreAudience,
    secondaryAudiences: cleanStringList(obj.secondaryAudiences)
      .filter(audience => audience !== coreAudience)
      .slice(0, 5),
    status: obj.status === "confirmed" ? "confirmed" : "provisional",
    updatedAt: timestamp(obj.updatedAt, now),
  };
}

function normalizeDraftContent(value: unknown): PublishingDraftContent | null {
  const obj = record(value);
  if (!obj) return null;
  return {
    title: cleanString(obj.title),
    body: cleanString(obj.body),
    tags: cleanStringList(obj.tags),
  };
}

function cloneDraftContent(
  value: PublishingDraftContent
): PublishingDraftContent {
  return {
    title: value.title,
    body: value.body,
    tags: [...value.tags],
  };
}

function normalizeStoryCore(
  value: unknown,
  now: number
): PublishingStoryCore | null {
  const obj = record(value);
  if (!obj) return null;
  return {
    revision: finiteNonNegativeInteger(obj.revision),
    facts: cleanStringList(obj.facts),
    thesis: cleanString(obj.thesis),
    emotion: cleanString(obj.emotion),
    voiceTraits: cleanStringList(obj.voiceTraits),
    visualConcept: cleanString(obj.visualConcept),
    updatedAt: timestamp(obj.updatedAt, now),
  };
}

function normalizePlatformDraft(
  value: unknown,
  platform: PublishingPlatformId,
  now: number
): PublishingPlatformDraft | null {
  const obj = record(value);
  if (!obj) return null;
  const content = normalizeDraftContent(obj.content);
  if (!content) return null;
  const appliedBaseline =
    normalizeDraftContent(obj.appliedBaseline) ?? cloneDraftContent(content);
  return {
    platform,
    content,
    appliedBaseline,
    sourceCoreRevision: finiteNonNegativeInteger(obj.sourceCoreRevision),
    revision: Math.max(1, finiteNonNegativeInteger(obj.revision, 1)),
    needsReview: obj.needsReview === true,
    updatedAt: timestamp(obj.updatedAt, now),
  };
}

function normalizeCover(
  value: unknown,
  now: number
): PublishingCoverReference | null {
  const obj = record(value);
  if (!obj) return null;
  if (
    typeof obj.assetId !== "number" ||
    !Number.isInteger(obj.assetId) ||
    obj.assetId <= 0
  ) {
    return null;
  }
  return {
    assetId: obj.assetId,
    sourceCoreRevision: finiteNonNegativeInteger(obj.sourceCoreRevision),
    createdAt: timestamp(obj.createdAt, now),
  };
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function normalizeCoverArtReference(
  value: unknown
): PublishingCoverArtReference | null {
  const obj = record(value);
  if (!obj) return null;
  const label = cleanString(obj.label).trim().slice(0, 160);
  const persistentImageUrl = cleanString(obj.imageUrl).trim();
  const imageUrl =
    persistentImageUrl &&
    persistentImageUrl.length <= 2_000 &&
    !persistentImageUrl.startsWith("data:")
      ? persistentImageUrl
      : "";
  const result: PublishingCoverArtReference = {
    label: label || "用户参考图",
    style: boundedStringList(obj.style, 12, 300),
    palette: boundedStringList(obj.palette, 12, 300),
    light: boundedStringList(obj.light, 12, 300),
    composition: boundedStringList(obj.composition, 12, 300),
    material: boundedStringList(obj.material, 12, 300),
    mood: boundedStringList(obj.mood, 12, 300),
  };
  if (imageUrl) result.imageUrl = imageUrl;
  const hasDna = [
    result.style,
    result.palette,
    result.light,
    result.composition,
    result.material,
    result.mood,
  ].some(values => values.length > 0);
  return hasDna ? result : null;
}

function normalizeCoverRound(
  value: unknown,
  now: number
): PublishingCoverRound | null {
  const obj = record(value);
  if (!obj) return null;
  const id = cleanString(obj.id).trim();
  if (!id || !isPublishingPlatformId(obj.platform)) return null;
  if (!Array.isArray(obj.assetIds)) return null;
  const assetIds = obj.assetIds.map(positiveInteger);
  if (
    assetIds.length < 1 ||
    assetIds.length > 4 ||
    assetIds.some((assetId): assetId is null => assetId == null) ||
    new Set(assetIds).size !== assetIds.length
  ) {
    return null;
  }
  const qualityRejectedCount = Math.min(
    4 - assetIds.length,
    finiteNonNegativeInteger(obj.qualityRejectedCount)
  );
  const flaggedAssetIds = Array.isArray(obj.qualityFlaggedAssetIds)
    ? Array.from(
        new Set(
          obj.qualityFlaggedAssetIds
            .map(positiveInteger)
            .filter(
              (assetId): assetId is number =>
                assetId != null && assetIds.includes(assetId)
            )
        )
      )
    : [];
  const qualityCheckUnavailable = obj.qualityCheckUnavailable === true;
  const qualityChecked =
    qualityRejectedCount > 0 ||
    flaggedAssetIds.length > 0 ||
    qualityCheckUnavailable;
  return {
    id,
    platform: obj.platform,
    sourceCoreRevision: finiteNonNegativeInteger(obj.sourceCoreRevision),
    parentAssetId: positiveInteger(obj.parentAssetId),
    feedback: cleanString(obj.feedback).trim().slice(0, 2_000),
    instructions: boundedStringList(obj.instructions, 20, 2_000),
    artReference: normalizeCoverArtReference(obj.artReference),
    assetIds: assetIds as PublishingCoverCandidateIds,
    ...(qualityRejectedCount > 0 ? { qualityRejectedCount } : {}),
    ...(flaggedAssetIds.length > 0
      ? { qualityFlaggedAssetIds: flaggedAssetIds }
      : {}),
    ...(qualityCheckUnavailable ? { qualityCheckUnavailable: true } : {}),
    ...(qualityChecked
      ? { qualityCheckedAt: timestamp(obj.qualityCheckedAt, now) }
      : {}),
    createdAt: timestamp(obj.createdAt, now),
  };
}

function normalizeCoverGeneration(
  value: unknown,
  now: number
): PublishingCoverGeneration | null {
  const obj = record(value);
  if (!obj || !isPublishingPlatformId(obj.platform)) return null;
  const operationToken = cleanString(obj.operationToken).trim();
  const versionId = cleanString(obj.versionId).trim();
  const prompt = cleanString(obj.prompt).trim();
  const roundId = cleanString(obj.roundId).trim();
  const rawStatus = cleanString(obj.status);
  if (
    !operationToken ||
    !versionId ||
    !prompt ||
    !roundId ||
    !["pending", "completed", "failed", "unknown"].includes(rawStatus)
  ) {
    return null;
  }
  return {
    operationToken: operationToken.slice(0, 200),
    versionId: versionId.slice(0, 64),
    status: rawStatus as PublishingCoverGeneration["status"],
    platform: obj.platform,
    provider:
      obj.provider === "gpt-image" || obj.provider === "flux-schnell"
        ? obj.provider
        : "midjourney",
    referenceAssetId: positiveInteger(obj.referenceAssetId),
    feedback: cleanString(obj.feedback).trim().slice(0, 2_000),
    instructions: boundedStringList(obj.instructions, 20, 2_000),
    artReference: normalizeCoverArtReference(obj.artReference),
    prompt: prompt.slice(0, 12_000),
    roundId: roundId.slice(0, 200),
    taskId: cleanString(obj.taskId).trim().slice(0, 500) || null,
    claimedAt: timestamp(obj.claimedAt, now),
    updatedAt: timestamp(obj.updatedAt, now),
    expiresAt: timestamp(obj.expiresAt, now),
    ...(cleanString(obj.error).trim()
      ? { error: cleanString(obj.error).trim().slice(0, 2_000) }
      : {}),
  };
}

export function normalizePublishingDraftState(
  value: unknown,
  now = Date.now()
): PublishingDraftState {
  const obj = record(value);
  if (!obj) return emptyPublishingDraftState(now);

  const selectedPlatforms = Array.isArray(obj.selectedPlatforms)
    ? Array.from(new Set(obj.selectedPlatforms.filter(isPublishingPlatformId)))
    : [];
  const activePlatform = isPublishingPlatformId(obj.activePlatform)
    ? obj.activePlatform
    : (selectedPlatforms[0] ?? DEFAULT_PUBLISHING_PLATFORM);
  if (!selectedPlatforms.includes(activePlatform)) {
    selectedPlatforms.unshift(activePlatform);
  }

  const rawDrafts = record(obj.drafts);
  const drafts: PublishingDraftState["drafts"] = {};
  if (rawDrafts) {
    for (const platform of PUBLISHING_PLATFORM_IDS) {
      const draft = normalizePlatformDraft(rawDrafts[platform], platform, now);
      if (draft) drafts[platform] = draft;
    }
  }

  const knownRoundIds = new Set<string>();
  const coverRounds = Array.isArray(obj.coverRounds)
    ? obj.coverRounds.flatMap(value => {
        const round = normalizeCoverRound(value, now);
        if (!round || knownRoundIds.has(round.id)) return [];
        knownRoundIds.add(round.id);
        return [round];
      })
    : [];

  const legacy: PublishingDraftState = {
    version: PUBLISHING_DRAFT_STATE_VERSION,
    revision: finiteNonNegativeInteger(obj.revision),
    activePlatform,
    selectedPlatforms,
    core: normalizeStoryCore(obj.core, now),
    drafts,
    cover: normalizeCover(obj.cover, now),
    coverRounds,
    coverGeneration: normalizeCoverGeneration(obj.coverGeneration, now),
    updatedAt: timestamp(obj.updatedAt, now),
  };
  const rawVersions = Array.isArray(obj.versions) ? obj.versions : [];
  const versions = rawVersions
    .map((value, index) => normalizeStoryVersion(value, index, now))
    .filter((version): version is PublishingStoryVersion => Boolean(version));
  const dedupedVersions = versions.filter(
    (version, index, candidates) =>
      candidates.findIndex(
        candidate => candidate.versionId === version.versionId
      ) === index
  );
  // A legacy payload is always retained as V1 unless the canonical markers are
  // present. Malformed version metadata must never discard its formal cover or
  // platform drafts.
  const hasCanonicalMarkers =
    typeof obj.activeVersionId === "string" ||
    typeof obj.containerRevision === "number";
  const hasCanonicalAuthority = obj.canonicalAuthority === "versions";
  let canonicalVersions =
    hasCanonicalMarkers && dedupedVersions.length > 0
      ? dedupedVersions
      : [versionFromLegacyState(legacy, "v1", 1, "V1", null)];
  const activeVersionId =
    typeof obj.activeVersionId === "string" &&
    canonicalVersions.some(version => version.versionId === obj.activeVersionId)
      ? obj.activeVersionId
      : canonicalVersions[0].versionId;
  if (hasCanonicalMarkers && !hasCanonicalAuthority) {
    canonicalVersions = canonicalVersions.map(version =>
      version.versionId !== activeVersionId
        ? {
            ...version,
            coverGeneration:
              legacy.coverGeneration?.versionId === version.versionId
                ? structuredClone(legacy.coverGeneration)
                : version.coverGeneration,
          }
        : {
            ...version,
            core: version.core ?? (legacy.core ? structuredClone(legacy.core) : null),
            drafts: {
              ...structuredClone(legacy.drafts),
              ...structuredClone(version.drafts),
            },
            activePlatform: legacy.activePlatform,
            selectedPlatforms: [...legacy.selectedPlatforms],
            cover: version.cover ?? (legacy.cover ? { ...legacy.cover } : null),
            coverRounds:
              version.coverRounds.length > 0
                ? version.coverRounds
                : structuredClone(legacy.coverRounds),
            coverGeneration:
              legacy.coverGeneration?.versionId === version.versionId
                ? structuredClone(legacy.coverGeneration)
                : version.coverGeneration,
          }
    );
  }
  const receipts = record(obj.versionOperationReceipts);
  const activeVersion = canonicalVersions.find(version => version.versionId === activeVersionId) ?? canonicalVersions[0];
  return {
    ...legacy,
    core: structuredClone(activeVersion.core),
    drafts: structuredClone(activeVersion.drafts),
    activePlatform: activeVersion.activePlatform,
    selectedPlatforms: [...activeVersion.selectedPlatforms],
    cover: activeVersion.cover ? { ...activeVersion.cover } : null,
    coverRounds: structuredClone(activeVersion.coverRounds),
    coverGeneration: activeVersion.coverGeneration
      ? structuredClone(activeVersion.coverGeneration)
      : null,
    activeVersionId,
    versions: canonicalVersions,
    canonicalAuthority: hasCanonicalAuthority ? "versions" : undefined,
    containerRevision: finiteNonNegativeInteger(
      obj.containerRevision,
      legacy.revision
    ),
    versionOperationReceipts: receipts
      ? Object.fromEntries(Object.entries(receipts).flatMap(([token, value]) => {
          const normalized = normalizeVersionOperationReceipt(token, value, canonicalVersions);
          return normalized == null ? [] : [[token.trim(), normalized]];
        }))
      : {},
    activeVideoStoryboardVersionId:
      typeof obj.activeVideoStoryboardVersionId === "string" &&
      canonicalVersions.some(
        version => version.versionId === obj.activeVideoStoryboardVersionId
      )
        ? obj.activeVideoStoryboardVersionId
        : null,
    activeVideoStoryboardGroupId:
      typeof obj.activeVideoStoryboardGroupId === "string" &&
      obj.activeVideoStoryboardGroupId.trim()
        ? obj.activeVideoStoryboardGroupId.trim()
        : null,
  };
}

function versionFromLegacyState(
  state: PublishingDraftState,
  versionId: string,
  sequence: number,
  displayName: string,
  parentId: string | null
): PublishingStoryVersion {
  return {
    versionId,
    sequence,
    displayName,
    parentId,
    versionRevision: state.revision,
    core: state.core ? structuredClone(state.core) : null,
    drafts: structuredClone(state.drafts),
    activePlatform: state.activePlatform,
    selectedPlatforms: [...state.selectedPlatforms],
    narrativeIntent: defaultPublishingNarrativeIntent(),
    intentSnapshot: undefined,
    intentProposals: [],
    coverGeneration: state.coverGeneration
      ? structuredClone(state.coverGeneration)
      : null,
    textOperations: {},
    platformContexts: {},
    platformStatuses: Object.fromEntries(
      Object.keys(state.drafts).map(platform => [platform, "ready"])
    ) as PublishingStoryVersion["platformStatuses"],
    cover: state.cover ? { ...state.cover } : null,
    coverRounds: structuredClone(state.coverRounds),
    conversationSnapshot: null,
    videoStoryboard: null,
  };
}

function normalizeStoryVersion(
  value: unknown,
  index: number,
  now: number
): PublishingStoryVersion | null {
  const obj = record(value);
  if (!obj) return null;
  const versionId = cleanString(obj.versionId).trim();
  if (!versionId) return null;
  const activePlatform = isPublishingPlatformId(obj.activePlatform)
    ? obj.activePlatform
    : DEFAULT_PUBLISHING_PLATFORM;
  const selectedPlatforms = Array.isArray(obj.selectedPlatforms)
    ? Array.from(new Set(obj.selectedPlatforms.filter(isPublishingPlatformId)))
    : [activePlatform];
  if (!selectedPlatforms.includes(activePlatform))
    selectedPlatforms.unshift(activePlatform);
  const rawDrafts = record(obj.drafts);
  const drafts: PublishingDraftState["drafts"] = {};
  if (rawDrafts)
    for (const platform of PUBLISHING_PLATFORM_IDS) {
      const draft = normalizePlatformDraft(rawDrafts[platform], platform, now);
      if (draft) drafts[platform] = draft;
    }
  const rounds = Array.isArray(obj.coverRounds)
    ? obj.coverRounds
        .map(round => normalizeCoverRound(round, now))
        .filter((round): round is PublishingCoverRound => Boolean(round))
    : [];
  const snapshotObj = record(obj.conversationSnapshot);
  const intentSnapshot = storyIntentProfileFromLegacy(
    record(obj.intentSnapshot),
    { now, source: "version_snapshot" }
  );
  const intentProposals = Array.isArray(obj.intentProposals)
    ? obj.intentProposals.flatMap(value => {
        const proposal = normalizeIntentProposal(value);
        return proposal ? [proposal] : [];
      })
    : [];
  const rawTextOperations = record(obj.textOperations);
  const textOperations = rawTextOperations
    ? Object.fromEntries(Object.entries(rawTextOperations).flatMap(([token, value]) => {
        const receipt = normalizeTextOperationReceipt(token, value, versionId);
        return receipt ? [[token.trim(), receipt]] : [];
      }))
    : {};
  const rawPlatformContexts = record(obj.platformContexts);
  const platformContexts = rawPlatformContexts
    ? Object.fromEntries(PUBLISHING_TREND_PLATFORM_IDS.flatMap(platform => {
        if (!(platform in rawPlatformContexts)) return [];
        return [[platform, normalizePublishingPlatformContextState(
          rawPlatformContexts[platform],
          { versionId, platform, now }
        )]];
      })) as Partial<Record<PublishingTrendPlatformId, PublishingPlatformContextState>>
    : {};
  return {
    versionId,
    sequence: Math.max(1, finiteNonNegativeInteger(obj.sequence, index + 1)),
    displayName: cleanString(obj.displayName).trim() || `V${index + 1}`,
    displayNameSource:
      obj.displayNameSource === "manual" || obj.displayNameSource === "automatic"
        ? obj.displayNameSource
        : undefined,
    parentId: typeof obj.parentId === "string" ? obj.parentId : null,
    versionRevision: finiteNonNegativeInteger(obj.versionRevision),
    core: normalizeStoryCore(obj.core, now),
    drafts,
    activePlatform,
    selectedPlatforms,
    narrativeIntent: normalizePublishingNarrativeIntent(
      obj.narrativeIntent,
      now
    ),
    intentSnapshot: intentSnapshot ?? undefined,
    intentProposals,
    coverGeneration: normalizeCoverGeneration(obj.coverGeneration, now),
    textOperations,
    platformContexts,
    platformStatuses: record(obj.platformStatuses)
      ? Object.fromEntries(Object.entries(record(obj.platformStatuses)!).filter(([platform, status]) =>
          isPublishingPlatformId(platform) && ["inherited", "carried", "awaiting_generation", "generation_failed", "ready"].includes(String(status))))
      : undefined,
    cover: normalizeCover(obj.cover, now),
    coverRounds: rounds,
    conversationSnapshot: snapshotObj
      ? {
          messages: Array.isArray(snapshotObj.messages)
            ? structuredClone(snapshotObj.messages)
            : [],
          updatedAt: timestamp(snapshotObj.updatedAt, now),
        }
      : null,
    videoStoryboard: normalizePublishingVideoStoryboardAggregate(
      obj.videoStoryboard
    ),
  };
}

export function resolvePublishingActiveVersion(
  state: PublishingDraftState
): PublishingStoryVersion {
  const versions = state.versions ?? [
    versionFromLegacyState(state, "v1", 1, "V1", null),
  ];
  return (
    versions.find(version => version.versionId === state.activeVersionId) ??
    versions[0]
  );
}

/**
 * 用途：构造某个发布版本的 ScopeKey，统一 storyId + versionId 的资源身份
 *   表达，替代散落各处的 `story.id === activeStoryId && versionId === xxx`
 *   手写比较。
 * 调用入口（至今没有生产调用方）：预期是 server 发布版本写入前置校验，以及
 *   client 发布工作台判断响应是否仍属于当前浏览版本。
 * 下游调用：@shared/scopedResource.ts 的 scopeKeysEqual。
 */
export function publishingVersionScopeKey(
  storyId: number,
  versionId: string
): ScopeKey {
  return { resourceKind: "publishingVersion", storyId, versionId };
}

/**
 * 用途：把某个发布版本现有的 `versionRevision` / `containerRevision` 字段
 *   映射为跨层统一的 ScopedRevision 形状，避免为"资源 revision 与聚合 revision
 *   是两件事"这个区分再存一份平行数据。
 * 调用入口（至今没有生产调用方）：预期是 server 发布版本写入前置校验与 client
 *   乐观更新冲突判断。
 * 下游调用：无（叶子纯函数）。
 */
export function publishingVersionScopedRevision(
  state: PublishingDraftState,
  versionId: string
): ScopedRevision {
  const version = (state.versions ?? []).find(
    candidate => candidate.versionId === versionId
  );
  return {
    resourceRevision: version?.versionRevision ?? 0,
    aggregateRevision: state.containerRevision ?? state.revision,
  };
}

export function hasPersistedPublishingVersion(
  state: PublishingDraftState
): boolean {
  const active = resolvePublishingActiveVersion(state);
  return Boolean(
    active.intentSnapshot ||
    state.core ||
    Object.keys(state.drafts).length > 0 ||
    state.cover ||
    state.coverRounds.length > 0 ||
    state.coverGeneration ||
    active.core ||
    Object.keys(active.drafts).length > 0 ||
    active.cover ||
    active.coverRounds.length > 0 ||
    active.conversationSnapshot ||
    active.videoStoryboard
  );
}

export function resolvePublishingIntentProfile(
  state: PublishingDraftState,
  preVersionProfile: StoryIntentProfile | null
) {
  const activeVersion = resolvePublishingActiveVersion(state);
  const legacySnapshot = hasPersistedPublishingVersion(state)
    ? activeVersion.intentSnapshot ??
      storyIntentProfileFromLegacy(activeVersion.narrativeIntent, {
        revision: activeVersion.versionRevision,
        source: "version_snapshot",
        now: activeVersion.narrativeIntent.updatedAt,
      })
    : null;
  return resolveStoryIntentProfile({
    preVersionProfile,
    activeVersionSnapshot: legacySnapshot,
  });
}

export function appendPublishingCoverRound(
  state: PublishingDraftState,
  round: PublishingCoverRound,
  now = Date.now()
): PublishingDraftState {
  const normalized = normalizeCoverRound(round, now);
  if (!normalized) throw new Error("Invalid publishing cover round");
  if (state.coverRounds.some(candidate => candidate.id === normalized.id)) {
    throw new Error(`Publishing cover round already exists: ${normalized.id}`);
  }
  return {
    ...state,
    revision: state.revision + 1,
    coverRounds: [...state.coverRounds, normalized],
    updatedAt: now,
  };
}

function assertPlatform(platform: PublishingPlatformId): void {
  if (!isPublishingPlatformId(platform)) {
    throw new Error(`Unsupported publishing platform: ${String(platform)}`);
  }
}

function normalizeAcceptedContent(
  value: PublishingDraftContent
): PublishingDraftContent {
  return {
    title: cleanString(value.title),
    body: cleanString(value.body),
    tags: cleanStringList(value.tags),
  };
}

export function upsertPublishingPlatformDraft(
  state: PublishingDraftState,
  params: {
    platform: PublishingPlatformId;
    content: PublishingDraftContent;
    activate?: boolean;
    now?: number;
  }
): PublishingDraftState {
  assertPlatform(params.platform);
  const now = params.now ?? Date.now();
  const existing = state.drafts[params.platform];
  const acceptedContent = normalizeAcceptedContent(params.content);
  const selectedPlatforms = state.selectedPlatforms.includes(params.platform)
    ? [...state.selectedPlatforms]
    : [...state.selectedPlatforms, params.platform];
  return {
    ...state,
    revision: state.revision + 1,
    activePlatform: params.activate ? params.platform : state.activePlatform,
    selectedPlatforms,
    drafts: {
      ...state.drafts,
      [params.platform]: {
        platform: params.platform,
        content: cloneDraftContent(acceptedContent),
        appliedBaseline: cloneDraftContent(acceptedContent),
        sourceCoreRevision: state.core?.revision ?? 0,
        revision: (existing?.revision ?? 0) + 1,
        needsReview: false,
        updatedAt: now,
      },
    },
    updatedAt: now,
  };
}

export function applyPublishingWordingEdit(
  state: PublishingDraftState,
  platform: PublishingPlatformId,
  content: PublishingDraftContent,
  now = Date.now()
): PublishingDraftState {
  assertPlatform(platform);
  if (!state.drafts[platform]) {
    throw new Error(
      `Publishing draft does not exist for platform: ${platform}`
    );
  }
  return upsertPublishingPlatformDraft(state, { platform, content, now });
}

export function confirmPublishingCoreChange(
  state: PublishingDraftState,
  params: {
    platform: PublishingPlatformId;
    nextCore: PublishingStoryCoreContent;
    activeDraftContent: PublishingDraftContent;
    now?: number;
  }
): PublishingDraftState {
  assertPlatform(params.platform);
  const now = params.now ?? Date.now();
  const nextCoreRevision = (state.core?.revision ?? 0) + 1;
  const activeDraft = state.drafts[params.platform];
  const acceptedContent = normalizeAcceptedContent(params.activeDraftContent);
  const drafts: PublishingDraftState["drafts"] = {};

  for (const platform of PUBLISHING_PLATFORM_IDS) {
    const existing = state.drafts[platform];
    if (!existing) continue;
    drafts[platform] =
      platform === params.platform
        ? {
            ...existing,
            content: cloneDraftContent(acceptedContent),
            appliedBaseline: cloneDraftContent(acceptedContent),
            sourceCoreRevision: nextCoreRevision,
            revision: existing.revision + 1,
            needsReview: false,
            updatedAt: now,
          }
        : { ...existing, needsReview: true };
  }

  if (!activeDraft) {
    drafts[params.platform] = {
      platform: params.platform,
      content: cloneDraftContent(acceptedContent),
      appliedBaseline: cloneDraftContent(acceptedContent),
      sourceCoreRevision: nextCoreRevision,
      revision: 1,
      needsReview: false,
      updatedAt: now,
    };
  }

  const selectedPlatforms = state.selectedPlatforms.includes(params.platform)
    ? [...state.selectedPlatforms]
    : [...state.selectedPlatforms, params.platform];

  return {
    ...state,
    revision: state.revision + 1,
    activePlatform: params.platform,
    selectedPlatforms,
    core: {
      revision: nextCoreRevision,
      facts: cleanStringList(params.nextCore.facts),
      thesis: cleanString(params.nextCore.thesis),
      emotion: cleanString(params.nextCore.emotion),
      voiceTraits: cleanStringList(params.nextCore.voiceTraits),
      visualConcept: cleanString(params.nextCore.visualConcept),
      updatedAt: now,
    },
    drafts,
    updatedAt: now,
  };
}
