import {
  normalizePublishingVideoStoryboardAggregate,
  type PublishingVideoStoryboardAggregate,
} from "./publishingVideoStoryboard";

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

export type PublishingCoverCandidateIds = [number, number, number, number];

export type PublishingCoverRound = {
  id: string;
  platform: PublishingPlatformId;
  sourceCoreRevision: number;
  parentAssetId: number | null;
  feedback: string;
  assetIds: PublishingCoverCandidateIds;
  createdAt: number;
};

export type PublishingConversationSnapshot = {
  messages: unknown[];
  updatedAt: number;
};

export type PublishingStoryVersion = {
  versionId: string;
  sequence: number;
  displayName: string;
  parentId: string | null;
  versionRevision: number;
  core: PublishingStoryCore | null;
  drafts: Partial<Record<PublishingPlatformId, PublishingPlatformDraft>>;
  activePlatform: PublishingPlatformId;
  selectedPlatforms: PublishingPlatformId[];
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
  updatedAt: number;
  /** Canonical story-level version projection (legacy callers may omit these). */
  activeVersionId?: string;
  versions?: PublishingStoryVersion[];
  containerRevision?: number;
  /** Persisted idempotency receipts for version operations. */
  versionOperationReceipts?: Record<string, string>;
  /** Formal Storyboard activation is independent from the browsed publishing version. */
  activeVideoStoryboardVersionId?: string | null;
  activeVideoStoryboardGroupId?: string | null;
};

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
    assetIds.length !== 4 ||
    assetIds.some((assetId): assetId is null => assetId == null) ||
    new Set(assetIds).size !== 4
  ) {
    return null;
  }
  return {
    id,
    platform: obj.platform,
    sourceCoreRevision: finiteNonNegativeInteger(obj.sourceCoreRevision),
    parentAssetId: positiveInteger(obj.parentAssetId),
    feedback: cleanString(obj.feedback).trim().slice(0, 2_000),
    assetIds: assetIds as PublishingCoverCandidateIds,
    createdAt: timestamp(obj.createdAt, now),
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
  const canonicalVersions =
    hasCanonicalMarkers && dedupedVersions.length > 0
      ? dedupedVersions
      : [versionFromLegacyState(legacy, "v1", 1, "V1", null)];
  const activeVersionId =
    typeof obj.activeVersionId === "string" &&
    canonicalVersions.some(version => version.versionId === obj.activeVersionId)
      ? obj.activeVersionId
      : canonicalVersions[0].versionId;
  const receipts = record(obj.versionOperationReceipts);
  return {
    ...legacy,
    activeVersionId,
    versions: canonicalVersions,
    containerRevision: finiteNonNegativeInteger(
      obj.containerRevision,
      legacy.revision
    ),
    versionOperationReceipts: receipts
      ? Object.fromEntries(
          Object.entries(receipts).filter(
            (entry): entry is [string, string] =>
              typeof entry[0] === "string" && typeof entry[1] === "string"
          )
        )
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
  return {
    versionId,
    sequence: Math.max(1, finiteNonNegativeInteger(obj.sequence, index + 1)),
    displayName: cleanString(obj.displayName).trim() || `V${index + 1}`,
    parentId: typeof obj.parentId === "string" ? obj.parentId : null,
    versionRevision: finiteNonNegativeInteger(obj.versionRevision),
    core: normalizeStoryCore(obj.core, now),
    drafts,
    activePlatform,
    selectedPlatforms,
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
