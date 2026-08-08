import { createHash, randomUUID } from "node:crypto";
import type {
  PublishingDraftState,
  PublishingPlatformDraft,
  PublishingStoryCore,
  PublishingStoryVersion,
} from "../../shared/publishingDraft";
import {
  normalizePublishingDraftState,
  resolvePublishingActiveVersion,
} from "../../shared/publishingDraft";
import {
  canonicalizePublishingVideoParagraphs,
  emptyPublishingVideoStoryboardAggregate,
  publishingVideoContentHash,
  validatePublishingVideoPreview,
  type PublishingVideoConfirmedSnapshot,
  type PublishingVideoPreviewSource,
  type PublishingVideoStoryboardShot,
  type PublishingVideoStoryboardPreview,
} from "../../shared/publishingVideoStoryboard";
import { ensureShotIdentities } from "../../shared/shotIdentity";
import { normalizeStoryArtDirection } from "../../shared/artDirection";
import { getStoryById } from "../db";
import {
  persistPreparedStoryBody,
  StoryBodyRevisionConflictError,
} from "./storyBodyPersistence";
import { getStoryRevision, prepareStoryBody } from "./storySync";
import { generatePublishingVideoStoryboardPreview } from "./publishingVideoStoryboard";

const CLAIM_TTL_MS = 5 * 60_000;
const MAX_CAS_ATTEMPTS = 4;

export class PublishingVideoStoryboardEligibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishingVideoStoryboardEligibilityError";
  }
}

export class PublishingVideoStoryboardOperationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishingVideoStoryboardOperationConflictError";
  }
}

export class PublishingVideoStoryboardConfirmationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishingVideoStoryboardConfirmationError";
  }
}

export type PublishingVideoPreviewPersistenceResult = {
  status: "ready" | "pending";
  storyId: number;
  storyRevision: number;
  publishing: PublishingDraftState;
  preview: PublishingVideoStoryboardPreview | null;
  reused: boolean;
  modelLabel: string | null;
};

export type PublishingVideoConfirmationResult = {
  status: "confirmed";
  storyId: number;
  storyRevision: number;
  publishing: PublishingDraftState;
  preview: PublishingVideoStoryboardPreview;
  shots: Record<string, unknown>[];
  reused: boolean;
};

type PreviewContext = {
  storyId: number;
  userId: number;
  storyRevision: number;
  body: Record<string, unknown>;
  publishing: PublishingDraftState;
  version: PublishingStoryVersion;
  draft: PublishingPlatformDraft;
  core: PublishingStoryCore | null;
  source: PublishingVideoPreviewSource;
  requestHash: string;
};

function storyBodyRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

function operationRequestHash(input: {
  storyId: number;
  version: PublishingStoryVersion;
  draft: PublishingPlatformDraft;
  publishing: PublishingDraftState;
  storyRevision: number;
  body: Record<string, unknown>;
}): { hash: string; source: PublishingVideoPreviewSource } {
  const paragraphs = canonicalizePublishingVideoParagraphs(
    input.draft.content.body
  );
  const canonicalContentHash = publishingVideoContentHash(paragraphs);
  const explicitStoryboardRevision = input.body._storyboardRevision;
  const storyboardRevision =
    typeof explicitStoryboardRevision === "number" &&
    Number.isInteger(explicitStoryboardRevision) &&
    explicitStoryboardRevision >= 0
      ? explicitStoryboardRevision
      : 0;
  const storyboardFingerprint = createHash("sha256")
    .update(
      JSON.stringify(
        ensureShotIdentities(
          (Array.isArray(input.body.shots) ? input.body.shots : []).filter(
            (shot): shot is Record<string, unknown> =>
              Boolean(shot && typeof shot === "object" && !Array.isArray(shot))
          )
        )
      )
    )
    .digest("hex");
  const source: PublishingVideoPreviewSource = {
    storyId: input.storyId,
    versionId: input.version.versionId,
    platform: input.version.activePlatform,
    storyRevision: input.storyRevision,
    publishingRevision: input.publishing.revision,
    versionRevision: input.version.versionRevision,
    draftRevision: input.draft.revision,
    storyboardRevision,
    canonicalContentHash,
    formalCoverAssetId: input.version.cover?.assetId ?? null,
  };
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        operationKind: "preview",
        storyId: source.storyId,
        versionId: source.versionId,
        platform: source.platform,
        publishingRevision: source.publishingRevision,
        versionRevision: source.versionRevision,
        draftRevision: source.draftRevision,
        storyboardRevision: source.storyboardRevision,
        storyboardFingerprint,
        canonicalContentHash: source.canonicalContentHash,
        formalCoverAssetId: source.formalCoverAssetId,
        coreRevision: input.version.core?.revision ?? 0,
      })
    )
    .digest("hex");
  return { hash, source };
}

async function loadPreviewContext(input: {
  storyId: number;
  userId: number;
  versionId?: string;
}): Promise<PreviewContext> {
  const story = await getStoryById(input.storyId, input.userId);
  if (!story) {
    throw new PublishingVideoStoryboardEligibilityError("故事不存在");
  }
  const body = storyBodyRecord(story.body);
  const publishing = normalizePublishingDraftState(body.publishing);
  const version = input.versionId
    ? publishing.versions?.find(candidate => candidate.versionId === input.versionId)
    : resolvePublishingActiveVersion(publishing);
  if (!version) {
    throw new PublishingVideoStoryboardEligibilityError("文字稿版本不存在");
  }
  const draft = version.drafts[version.activePlatform];
  if (!draft || !draft.content.body.trim()) {
    throw new PublishingVideoStoryboardEligibilityError("请先保存一份非空文字稿");
  }
  if (draft.needsReview) {
    throw new PublishingVideoStoryboardEligibilityError(
      "这份文字稿需要先确认内容变更"
    );
  }
  const storyRevision = getStoryRevision(body);
  const request = operationRequestHash({
    storyId: input.storyId,
    version,
    draft,
    publishing,
    storyRevision,
    body,
  });
  return {
    storyId: input.storyId,
    userId: input.userId,
    storyRevision,
    body,
    publishing,
    version,
    draft,
    core: version.core,
    source: request.source,
    requestHash: request.hash,
  };
}

function withVersionStoryboard(
  publishing: PublishingDraftState,
  versionId: string,
  transform: (
    version: PublishingStoryVersion
  ) => PublishingStoryVersion
): PublishingDraftState {
  return {
    ...publishing,
    versions: publishing.versions?.map(version =>
      version.versionId === versionId ? transform(version) : version
    ),
  };
}

async function writePublishingProjection(input: {
  context: PreviewContext;
  publishing: PublishingDraftState;
}) {
  const body = input.context.body;
  const expectedRevision = input.context.storyRevision;
  const nextBody = {
    ...body,
    publishing: input.publishing,
    _revision: expectedRevision + 1,
  };
  return persistPreparedStoryBody({
    storyId: input.context.storyId,
    userId: input.context.userId,
    expectedRevision,
    body: nextBody,
  });
}

async function claimPreviewOperation(input: {
  storyId: number;
  userId: number;
  operationToken: string;
  versionId?: string;
  now: number;
}): Promise<
  | { status: "claimed"; context: PreviewContext }
  | {
      status: "pending" | "completed";
      context: PreviewContext;
      preview: PublishingVideoStoryboardPreview | null;
    }
> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const context = await loadPreviewContext(input);
    const aggregate =
      context.version.videoStoryboard ?? emptyPublishingVideoStoryboardAggregate();
    const existing = aggregate.operations[input.operationToken];
    if (existing && existing.requestHash !== context.requestHash) {
      throw new PublishingVideoStoryboardOperationConflictError(
        "同一个操作标识不能用于不同的文字稿或版本"
      );
    }
    if (existing?.status === "completed") {
      return {
        status: "completed",
        context,
        preview:
          aggregate.latestPreview?.previewId === existing.resultId
            ? aggregate.latestPreview
            : null,
      };
    }
    if (existing?.status === "pending" && existing.expiresAt > input.now) {
      return {
        status: "pending",
        context,
        preview: aggregate.latestPreview,
      };
    }
    const nextAggregate = {
      ...aggregate,
      operations: {
        ...aggregate.operations,
        [input.operationToken]: {
          status: "pending" as const,
          operationToken: input.operationToken,
          requestHash: context.requestHash,
          operationKind: "preview" as const,
          claimedAt: input.now,
          expiresAt: input.now + CLAIM_TTL_MS,
        },
      },
    };
    const publishing = withVersionStoryboard(
      context.publishing,
      context.version.versionId,
      version => ({ ...version, videoStoryboard: nextAggregate })
    );
    try {
      await writePublishingProjection({ context, publishing });
      return { status: "claimed", context };
    } catch (error) {
      if (error instanceof StoryBodyRevisionConflictError) continue;
      throw error;
    }
  }
  throw new PublishingVideoStoryboardOperationConflictError(
    "故事正在被其他操作更新，请稍后重试"
  );
}

async function completePreviewOperation(input: {
  claimed: PreviewContext;
  operationToken: string;
  preview: PublishingVideoStoryboardPreview;
  now: number;
}): Promise<PublishingVideoPreviewPersistenceResult> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const latest = await loadPreviewContext({
      storyId: input.claimed.storyId,
      userId: input.claimed.userId,
      versionId: input.claimed.version.versionId,
    });
    const aggregate =
      latest.version.videoStoryboard ?? emptyPublishingVideoStoryboardAggregate();
    const operation = aggregate.operations[input.operationToken];
    if (!operation || operation.requestHash !== input.claimed.requestHash) {
      throw new PublishingVideoStoryboardOperationConflictError(
        "预览操作声明已失效，请重新进入视频制作"
      );
    }
    if (operation.status === "completed") {
      return {
        status: "ready",
        storyId: latest.storyId,
        storyRevision: latest.storyRevision,
        publishing: latest.publishing,
        preview:
          aggregate.latestPreview?.previewId === operation.resultId
            ? aggregate.latestPreview
            : null,
        reused: true,
        modelLabel: null,
      };
    }
    if (operation.status !== "pending") {
      throw new PublishingVideoStoryboardOperationConflictError(
        "预览操作已失败，请使用新的操作标识重试"
      );
    }
    const stillCurrent = latest.requestHash === input.claimed.requestHash;
    const preview: PublishingVideoStoryboardPreview = {
      ...input.preview,
      previewId: `preview-${input.operationToken}`,
      status: stillCurrent ? "preview" : "stale",
      source: input.claimed.source,
      staleReasons: stillCurrent ? [] : ["content"],
      updatedAt: input.now,
    };
    const nextAggregate = {
      ...aggregate,
      latestPreview: preview,
      operations: {
        ...aggregate.operations,
        [input.operationToken]: {
          status: "completed" as const,
          operationToken: input.operationToken,
          requestHash: input.claimed.requestHash,
          operationKind: "preview" as const,
          resultId: preview.previewId,
          completedAt: input.now,
        },
      },
    };
    const publishing = withVersionStoryboard(
      latest.publishing,
      latest.version.versionId,
      version => ({ ...version, videoStoryboard: nextAggregate })
    );
    try {
      const saved = await writePublishingProjection({
        context: latest,
        publishing,
      });
      return {
        status: "ready",
        storyId: latest.storyId,
        storyRevision: getStoryRevision(saved.body),
        publishing,
        preview,
        reused: false,
        modelLabel: null,
      };
    } catch (error) {
      if (error instanceof StoryBodyRevisionConflictError) continue;
      throw error;
    }
  }
  throw new PublishingVideoStoryboardOperationConflictError(
    "预览已经生成，但保存时发生冲突，请重试"
  );
}

async function failPreviewOperation(input: {
  claimed: PreviewContext;
  operationToken: string;
  now: number;
}): Promise<void> {
  try {
    const latest = await loadPreviewContext({
      storyId: input.claimed.storyId,
      userId: input.claimed.userId,
      versionId: input.claimed.version.versionId,
    });
    const aggregate =
      latest.version.videoStoryboard ?? emptyPublishingVideoStoryboardAggregate();
    const operation = aggregate.operations[input.operationToken];
    if (
      operation?.status !== "pending" ||
      operation.requestHash !== input.claimed.requestHash
    ) {
      return;
    }
    const publishing = withVersionStoryboard(
      latest.publishing,
      latest.version.versionId,
      version => ({
        ...version,
        videoStoryboard: {
          ...aggregate,
          operations: {
            ...aggregate.operations,
            [input.operationToken]: {
              status: "failed" as const,
              operationToken: input.operationToken,
              requestHash: input.claimed.requestHash,
              operationKind: "preview" as const,
              failedAt: input.now,
              retryable: true,
            },
          },
        },
      })
    );
    await writePublishingProjection({ context: latest, publishing });
  } catch {
    // The original generation error remains authoritative. A failed cleanup
    // leaves an expiring pending claim, never a formal Storyboard mutation.
  }
}

export async function generateAndPersistPublishingVideoPreview(input: {
  storyId: number;
  userId: number;
  operationToken?: string;
  versionId?: string;
  now?: number;
  generate?: typeof generatePublishingVideoStoryboardPreview;
}): Promise<PublishingVideoPreviewPersistenceResult> {
  const now = input.now ?? Date.now();
  const operationToken = input.operationToken?.trim() || randomUUID();
  const claim = await claimPreviewOperation({
    storyId: input.storyId,
    userId: input.userId,
    operationToken,
    versionId: input.versionId,
    now,
  });
  if (claim.status === "pending") {
    return {
      status: "pending",
      storyId: claim.context.storyId,
      storyRevision: claim.context.storyRevision,
      publishing: claim.context.publishing,
      preview: claim.preview,
      reused: true,
      modelLabel: null,
    };
  }
  if (claim.status === "completed") {
    return {
      status: "ready",
      storyId: claim.context.storyId,
      storyRevision: claim.context.storyRevision,
      publishing: claim.context.publishing,
      preview: claim.preview,
      reused: true,
      modelLabel: null,
    };
  }

  try {
    const generated = await (input.generate ??
      generatePublishingVideoStoryboardPreview)({
      body: claim.context.draft.content.body,
      platform: claim.context.version.activePlatform,
      core: claim.context.core,
      coverVisualDescription: claim.context.core?.visualConcept ?? null,
      now,
    });
    const completed = await completePreviewOperation({
      claimed: claim.context,
      operationToken,
      preview: generated.preview,
      now,
    });
    return { ...completed, modelLabel: generated.modelLabel };
  } catch (error) {
    await failPreviewOperation({
      claimed: claim.context,
      operationToken,
      now,
    });
    throw error;
  }
}

const LEGACY_OPENING_ID = "publishing-cover-opening";
const LEGACY_DEFAULTS = {
  subject: "文字稿封面",
  action: "作为开场画面，建立这篇文字稿的视觉语气。",
  beat: "开场",
  shotType: "开场镜头",
  note: "从文字稿封面继承，可继续编辑或直接生成视频。",
} as const;

function isLegacyPublishingOpening(shot: Record<string, unknown>): boolean {
  return (
    shot.stableShotId === LEGACY_OPENING_ID ||
    shot.shotIdentity === LEGACY_OPENING_ID
  );
}

function isUntouchedLegacyPublishingOpening(
  shot: Record<string, unknown>
): boolean {
  if (!isLegacyPublishingOpening(shot)) return false;
  const fields = Object.entries(LEGACY_DEFAULTS) as Array<
    [keyof typeof LEGACY_DEFAULTS, string]
  >;
  if (
    fields.some(([field, defaultValue]) => {
      const value = shot[field];
      return typeof value === "string" && value.trim() && value !== defaultValue;
    })
  ) {
    return false;
  }
  return ![
    "promptRun",
    "promptOverrides",
    "chatCutMapping",
    "videoPrompt",
    "promptDraft",
    "scriptText",
  ].some(field => shot[field] != null && shot[field] !== "");
}

function stablePublishingShotId(input: {
  storyId: number;
  versionId: string;
  previewId: string;
  draftShotId: string;
}): string {
  const suffix = createHash("sha256")
    .update(
      `${input.storyId}:${input.versionId}:${input.previewId}:${input.draftShotId}`
    )
    .digest("hex")
    .slice(0, 20);
  return `publishing-${input.versionId}-${suffix}`;
}

function confirmedShotSnapshot(
  shot: PublishingVideoStoryboardShot,
  stableShotId: string
): PublishingVideoStoryboardShot {
  return { ...structuredClone(shot), stableShotId };
}

function formalShotFromPreview(input: {
  shot: PublishingVideoStoryboardShot;
  stableShotId: string;
  shotNo: number;
  versionId: string;
  groupId: string;
  confirmedRevision: number;
}): Record<string, unknown> {
  return {
    stableShotId: input.stableShotId,
    shotIdentity: input.stableShotId,
    shotNo: input.shotNo,
    subject: input.shot.subject || "按剧本呈现主体",
    action: input.shot.action || "按剧本完成动作",
    scriptText: input.shot.scriptText,
    dialogue: "",
    shotType: "剧本镜头",
    beat: "正文推进",
    cameraAngle: "",
    cameraMove: "",
    location: "",
    timeLight: "",
    mood: "",
    sound: "",
    styleRef: "故事级封面风格参考（如有）",
    note: "由文字稿剧本预览确认生成",
    emotion: "",
    sourceCardContent: "",
    promptDraft: input.shot.imageRequirement,
    videoPrompt: input.shot.videoRequirement,
    publishingVideo: {
      versionId: input.versionId,
      groupId: input.groupId,
      segmentIds: [...input.shot.segmentIds],
      sourceParagraphIds: [...input.shot.sourceParagraphIds],
      confirmedRevision: input.confirmedRevision,
    },
  };
}

function storyStyleReference(
  body: Record<string, unknown>,
  coverAssetId: number | null,
  now: number
) {
  const direction = normalizeStoryArtDirection(body.artDirection);
  const references = direction.references.filter(
    reference =>
      reference.source !== "publishing-cover" && reference.role !== "story-style"
  );
  if (coverAssetId) {
    references.push({
      id: `publishing-cover-${coverAssetId}`,
      label: "文字稿正式封面（故事风格）",
      source: "publishing-cover" as const,
      purpose: "aesthetic" as const,
      selected: true,
      role: "story-style" as const,
      scope: "story" as const,
      assetId: coverAssetId,
      text: "继承人物设计、色板、油画颜料或纸张纤维、光线与情绪；不得复制封面构图，也不得把封面当人物身份锁。",
      constraints: [
        "aesthetic-only",
        "preserve-people-palette-material-texture-mood",
        "do-not-copy-composition",
        "do-not-use-as-character-identity",
      ],
    });
  }
  return {
    ...direction,
    phase: direction.phase === "empty" ? ("references" as const) : direction.phase,
    references,
    updatedAt: now,
  };
}

function confirmationRequestHash(input: {
  previewId: string;
  versionId: string;
  groupId: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify({ operationKind: "confirm", ...input }))
    .digest("hex");
}

export async function confirmPublishingVideoStoryboard(input: {
  storyId: number;
  userId: number;
  versionId: string;
  previewId: string;
  operationToken?: string;
  now?: number;
}): Promise<PublishingVideoConfirmationResult> {
  const now = input.now ?? Date.now();
  const operationToken = input.operationToken?.trim() || randomUUID();
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const context = await loadPreviewContext({
      storyId: input.storyId,
      userId: input.userId,
      versionId: input.versionId,
    });
    const aggregate =
      context.version.videoStoryboard ?? emptyPublishingVideoStoryboardAggregate();
    const preview = aggregate.latestPreview;
    if (!preview || preview.previewId !== input.previewId) {
      throw new PublishingVideoStoryboardConfirmationError(
        "剧本预览不存在或已经更新，请重新检查"
      );
    }
    const validation = validatePublishingVideoPreview(preview);
    if (preview.status === "stale" || validation.length > 0) {
      throw new PublishingVideoStoryboardConfirmationError(
        "剧本预览已过期或覆盖不完整，请重新转写"
      );
    }
    const groupId = `publishing-group-${input.versionId}-${input.previewId}`;
    const requestHash = confirmationRequestHash({
      previewId: input.previewId,
      versionId: input.versionId,
      groupId,
    });
    const existingOperation = aggregate.operations[operationToken];
    if (existingOperation && existingOperation.requestHash !== requestHash) {
      throw new PublishingVideoStoryboardOperationConflictError(
        "同一个确认标识不能用于不同的剧本预览"
      );
    }
    const body = context.body;
    const rawShots = Array.isArray(body.shots)
      ? body.shots.filter((shot): shot is Record<string, unknown> =>
          Boolean(shot && typeof shot === "object" && !Array.isArray(shot))
        )
      : [];
    if (existingOperation?.status === "completed") {
      return {
        status: "confirmed",
        storyId: input.storyId,
        storyRevision: context.storyRevision,
        publishing: context.publishing,
        preview,
        shots: rawShots,
        reused: true,
      };
    }
    const previewOperation = Object.values(aggregate.operations).find(
      operation =>
        operation.operationKind === "preview" &&
        operation.status === "completed" &&
        operation.resultId === preview.previewId
    );
    const previewSource = preview.source;
    const sourceMatchesCurrentDraft = Boolean(
      previewOperation &&
        previewSource &&
        previewSource.storyId === context.source.storyId &&
        previewSource.versionId === context.source.versionId &&
        previewSource.platform === context.source.platform &&
        previewSource.publishingRevision === context.source.publishingRevision &&
        previewSource.versionRevision === context.source.versionRevision &&
        previewSource.draftRevision === context.source.draftRevision &&
        previewSource.storyboardRevision === context.source.storyboardRevision &&
        previewSource.canonicalContentHash === context.source.canonicalContentHash &&
        previewSource.formalCoverAssetId === context.source.formalCoverAssetId
    );
    if (!sourceMatchesCurrentDraft) {
      throw new PublishingVideoStoryboardConfirmationError(
        "文字稿已经变化，请重新转写后确认"
      );
    }
    const ambiguousLegacy = rawShots.find(
      shot => isLegacyPublishingOpening(shot) && !isUntouchedLegacyPublishingOpening(shot)
    );
    if (ambiguousLegacy) {
      throw new PublishingVideoStoryboardConfirmationError(
        "旧封面镜头已经被编辑，需要先在影响检查中决定保留或退休"
      );
    }
    const activeGroupId = context.publishing.activeVideoStoryboardGroupId;
    const managedIndexes = rawShots.flatMap((shot, index) => {
      const provenance = storyBodyRecord(shot.publishingVideo);
      return activeGroupId && provenance.groupId === activeGroupId ? [index] : [];
    });
    const legacyIndex = rawShots.findIndex(isUntouchedLegacyPublishingOpening);
    const insertionIndex =
      managedIndexes[0] ?? (legacyIndex >= 0 ? legacyIndex : rawShots.length);
    const removedIndexes = new Set([
      ...managedIndexes,
      ...(legacyIndex >= 0 ? [legacyIndex] : []),
    ]);
    const unrelated = rawShots.filter((_, index) => !removedIndexes.has(index));
    const usedStableIds = new Set(
      unrelated.flatMap(shot => {
        const id =
          typeof shot.stableShotId === "string"
            ? shot.stableShotId
            : typeof shot.shotIdentity === "string"
              ? shot.shotIdentity
              : null;
        return id ? [id] : [];
      })
    );
    const confirmedRevision = context.storyRevision + 1;
    const confirmedShots = preview.shots.map(shot => {
      const stableShotId = stablePublishingShotId({
        storyId: input.storyId,
        versionId: input.versionId,
        previewId: input.previewId,
        draftShotId: shot.draftShotId,
      });
      if (usedStableIds.has(stableShotId)) {
        throw new PublishingVideoStoryboardConfirmationError(
          `镜头身份冲突：${stableShotId}`
        );
      }
      usedStableIds.add(stableShotId);
      return confirmedShotSnapshot(shot, stableShotId);
    });
    const formalConfirmed = confirmedShots.map((shot, index) =>
      formalShotFromPreview({
        shot,
        stableShotId: shot.stableShotId!,
        shotNo: insertionIndex + index + 1,
        versionId: input.versionId,
        groupId,
        confirmedRevision,
      })
    );
    const nextShots = [
      ...unrelated.slice(0, insertionIndex),
      ...formalConfirmed,
      ...unrelated.slice(insertionIndex),
    ].map((shot, index) => ({ ...shot, shotNo: index + 1 }));
    const confirmed: PublishingVideoConfirmedSnapshot = {
      previewId: preview.previewId,
      groupId,
      confirmedAt: now,
      confirmedStoryRevision: confirmedRevision,
      paragraphs: structuredClone(preview.paragraphs),
      segments: structuredClone(preview.segments),
      shots: confirmedShots,
      baselineByStableShotId: Object.fromEntries(
        confirmedShots.map(shot => [shot.stableShotId!, structuredClone(shot)])
      ),
    };
    const confirmedPreview = {
      ...preview,
      status: "confirmed" as const,
      updatedAt: now,
    };
    const nextAggregate = {
      ...aggregate,
      latestPreview: confirmedPreview,
      confirmed,
      impactPlan: null,
      operations: {
        ...aggregate.operations,
        [operationToken]: {
          status: "completed" as const,
          operationToken,
          requestHash,
          operationKind: "confirm" as const,
          resultId: groupId,
          completedAt: now,
        },
      },
    };
    const publishing = {
      ...withVersionStoryboard(
        context.publishing,
        input.versionId,
        version => ({ ...version, videoStoryboard: nextAggregate })
      ),
      activeVideoStoryboardVersionId: input.versionId,
      activeVideoStoryboardGroupId: groupId,
    };
    const coverAssetId = context.version.cover?.assetId ?? null;
    const nextBody = prepareStoryBody(
      {
        ...body,
        shots: nextShots,
        publishing,
        artDirection: storyStyleReference(body, coverAssetId, now),
        _storyboardRevision:
          (typeof body._storyboardRevision === "number"
            ? body._storyboardRevision
            : 0) + 1,
      },
      confirmedRevision,
      {
        ...body,
        publishing,
      }
    );
    try {
      const saved = await persistPreparedStoryBody({
        storyId: input.storyId,
        userId: input.userId,
        expectedRevision: context.storyRevision,
        body: nextBody,
      });
      return {
        status: "confirmed",
        storyId: input.storyId,
        storyRevision: getStoryRevision(saved.body),
        publishing,
        preview: confirmedPreview,
        shots: nextShots,
        reused: false,
      };
    } catch (error) {
      if (error instanceof StoryBodyRevisionConflictError) continue;
      throw error;
    }
  }
  throw new PublishingVideoStoryboardOperationConflictError(
    "确认期间故事持续被修改，请刷新后重试"
  );
}
