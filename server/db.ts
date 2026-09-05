import {
  eq,
  and,
  desc,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createKeyedSerialLock } from "./utils/keyedSerialLock";
import { TIMELINE_FRAME_EXTRACTION_QUOTA_ERROR } from "./persistence/timelineFrameExtractionErrors";
export { TIMELINE_FRAME_EXTRACTION_QUOTA_ERROR } from "./persistence/timelineFrameExtractionErrors";
import type { StoryTimelineOverlay } from "../shared/storyMaterial";
import {
  decodeStoredStoryTimeline,
  encodeStoredStoryTimeline,
  mergeStoredStoryTimelineExtensions,
} from "./persistence/storyTimelinePersistence";
import {
  isValidAudioStorageKey,
  resolveManagedAudioPath,
} from "./services/audioMedia";
import { canonicalJsonStringify } from "../shared/canonicalJson";
import {
  InsertUser,
  users,
  User,
  accessSessions,
  AccessSession,
  InsertProject,
  projects,
  Project,
  InsertReference,
  references,
  Reference,
  InsertShot,
  shots,
  Shot,
  InsertAnalysisResult,
  analysisResults,
  AnalysisResult,
  InsertEmotionAnalysisProfile,
  emotionAnalysisProfiles,
  EmotionAnalysisProfile,
  InsertEmotionDailyLetter,
  emotionDailyLetters,
  EmotionDailyLetter,
  personalMemorySources,
  personalMemoryEvents,
  personalMemoryJobs,
  personalMemoryPrivacyEpochs,
  personalMemoryInsights,
  personalMemoryEvidence,
  personalMemorySuppressions,
  emotionDailyLetterVersions,
  InsertStory,
  stories,
  Story,
  StoryBody,
  InsertEditSnapshot,
  editSnapshots,
  EditSnapshot,
  InsertSemanticAnnotation,
  semanticAnnotations,
  SemanticAnnotation,
  InsertGeneratedImage,
  generatedImages,
  GeneratedImage,
  previewMaskedImageOperations,
  PreviewMaskedImageOperation,
  timelineFrameExtractionOperations,
  TimelineFrameExtractionOperation,
  storyAudioAssets,
  StoryAudioAsset,
  InsertStoryAudioAsset,
  storyAudioImportOperations,
  StoryAudioImportOperation,
  InsertStoryAudioImportOperation,
  InsertImageSignal,
  imageSignals,
  ImageSignal,
  InsertVideoTake,
  videoTakes,
  VideoTake,
  InsertVideoTakeRange,
  videoTakeRanges,
  VideoTakeRange,
  InsertVideoTimelineSelection,
  videoTimelineSelections,
  VideoTimelineSelection,
  storyTimelines,
  StoryTimeline,
  InsertShotDerivationDraft,
  shotDerivationDrafts,
  ShotDerivationDraft,
  InsertStoryOperation,
  storyOperations,
  StoryOperation,
  storyPromptStates,
  promptNodes,
  promptRevisions,
  promptNodeBindings,
  promptCompilations,
  promptCompilationHeads,
  storyConversations,
  storyConversationMessages,
  storyMessageReferences,
  storyArtPromptBindings,
  promptOperationReceipts,
  emailOtps,
  EmailOtp,
  inviteCodes,
  InviteCode,
  InsertInviteCode,
  creditAccounts,
  CreditAccount,
  creditLedgerEntries,
  CreditLedgerEntry,
  creditHolds,
  CreditHold,
  billingOperations,
  BillingOperation,
  providerAttempts,
  ProviderAttempt,
  accountIdentities,
  AccountIdentity,
  accountCredentials,
  AccountCredential,
  accountVerificationChallenges,
  AccountVerificationChallenge,
  accountRateLimits,
  AccountRateLimit,
} from "../drizzle/schema";
export type { EditSnapshot, SemanticAnnotation, GeneratedImage };
import { ENV } from "./_core/env";
import {
  createEmptyPromptLineageLocalState,
  normalizePromptLineageLocalState,
  type PromptLineageLocalState,
  type PromptCompilationHead,
} from "../shared/promptLineage";
import {
  applyPersonalMemoryCapture,
  createEmptyPersonalMemoryEventSnapshot,
  createEmptyPersonalMemoryLocalState,
  currentLetterVersion,
  decideEvidenceLossOutcome,
  decideInsightMutation,
  decideLineageStateChange,
  insightLineageTip,
  reinforceInsightConfidence,
  normalizePersonalMemoryEventIdentity,
  normalizePersonalMemoryLocalState,
  personalMemoryEventFingerprint,
  projectLetterRowFromVersion,
  projectPersonalMemoryOutbox,
  type PersonalMemoryCapture,
  type PersonalMemoryEventIdentity,
  type PersonalMemoryEventRecord,
  type PersonalMemoryEvidenceRecord,
  type PersonalMemoryInsightLineageView,
  type PersonalMemoryInsightMutation,
  type PersonalMemoryInsightRecord,
  type PersonalMemoryInsightState,
  type PersonalMemoryJobRecord,
  type PersonalMemoryLetterEnvelope,
  type PersonalMemoryLetterPayload,
  type PersonalMemoryLetterVersionRecord,
  type PersonalMemoryLocalState,
  type PersonalMemoryOutboxEntry,
  type PersonalMemorySourceType,
  type PersonalMemorySuppressionRecord,
  type PersonalMemoryTimelineCursor,
} from "../shared/personalMemory";
import { isUntitledStoryTitle } from "../shared/storyTitle";

let _db: ReturnType<typeof drizzle> | null = null;
let mysqlModeLogged = false;
let localPersistModeLogged = false;
const LEGACY_GUEST_OPEN_ID = "local-guest";

type MemoryState = {
  users: User[];
  accessSessions: AccessSession[];
  projects: Project[];
  references: Reference[];
  shots: Shot[];
  analysisResults: AnalysisResult[];
  emotionAnalysisProfiles: EmotionAnalysisProfile[];
  emotionDailyLetters: EmotionDailyLetter[];
  stories: Story[];
  editSnapshots: EditSnapshot[];
  semanticAnnotations: SemanticAnnotation[];
  generatedImages: GeneratedImage[];
  previewMaskedImageOperations: PreviewMaskedImageOperation[];
  timelineFrameExtractionOperations: TimelineFrameExtractionOperation[];
  imageSignals: ImageSignal[];
  videoTakes: VideoTake[];
  videoTakeRanges: VideoTakeRange[];
  videoTimelineSelections: VideoTimelineSelection[];
  storyTimelines: StoryTimeline[];
  storyAudioAssets: StoryAudioAsset[];
  storyAudioImportOperations: StoryAudioImportOperation[];
  shotDerivationDrafts: ShotDerivationDraft[];
  storyOperations: StoryOperation[];
  inviteCodes: InviteCode[];
  creditAccounts: CreditAccount[];
  creditLedgerEntries: CreditLedgerEntry[];
  creditHolds: CreditHold[];
  billingOperations: BillingOperation[];
  providerAttempts: ProviderAttempt[];
  accountIdentities: AccountIdentity[];
  accountCredentials: AccountCredential[];
  accountVerificationChallenges: AccountVerificationChallenge[];
  accountRateLimits: AccountRateLimit[];
  promptLineage: PromptLineageLocalState;
  /**
   * 个人记忆（U1）。它同时是 local-persist 自己那部分来源的家，
   * 和**统一足迹索引**——prompt-lineage 聚合的 outbox 由 projector 投影进来。
   * 刻意不新建第三份 JSON 文件：跟着 memoryState 一起原子落盘。
   */
  personalMemory: PersonalMemoryLocalState;
  nextIds: {
    user: number;
    accessSession: number;
    project: number;
    reference: number;
    shot: number;
    analysisResult: number;
    emotionAnalysisProfile: number;
    emotionDailyLetter: number;
    story: number;
    editSnapshot: number;
    semanticAnnotation: number;
    generatedImage: number;
    previewMaskedImageOperation: number;
    timelineFrameExtractionOperation: number;
    imageSignal: number;
    videoTake: number;
    videoTakeRange: number;
    videoTimelineSelection: number;
    storyTimeline: number;
    storyAudioAsset: number;
    storyAudioImportOperation: number;
    shotDerivationDraft: number;
    storyOperation: number;
    inviteCode: number;
    creditAccount: number;
    creditLedgerEntry: number;
    creditHold: number;
    billingOperation: number;
    providerAttempt: number;
    accountIdentity: number;
    accountCredential: number;
    accountVerificationChallenge: number;
    accountRateLimit: number;
  };
};

const memoryState: MemoryState = {
  users: [],
  accessSessions: [],
  projects: [],
  references: [],
  shots: [],
  analysisResults: [],
  emotionAnalysisProfiles: [],
  emotionDailyLetters: [],
  stories: [],
  editSnapshots: [],
  semanticAnnotations: [],
  generatedImages: [],
  previewMaskedImageOperations: [],
  timelineFrameExtractionOperations: [],
  imageSignals: [],
  videoTakes: [],
  videoTakeRanges: [],
  videoTimelineSelections: [],
  storyTimelines: [],
  storyAudioAssets: [],
  storyAudioImportOperations: [],
  shotDerivationDrafts: [],
  storyOperations: [],
  inviteCodes: [],
  creditAccounts: [],
  creditLedgerEntries: [],
  creditHolds: [],
  billingOperations: [],
  providerAttempts: [],
  accountIdentities: [],
  accountCredentials: [],
  accountVerificationChallenges: [],
  accountRateLimits: [],
  promptLineage: createEmptyPromptLineageLocalState(),
  personalMemory: createEmptyPersonalMemoryLocalState(),
  nextIds: {
    user: 1,
    accessSession: 1,
    project: 1,
    reference: 1,
    shot: 1,
    analysisResult: 1,
    emotionAnalysisProfile: 1,
    emotionDailyLetter: 1,
    story: 1,
    editSnapshot: 1,
    semanticAnnotation: 1,
    generatedImage: 1,
    previewMaskedImageOperation: 1,
    timelineFrameExtractionOperation: 1,
    imageSignal: 1,
    videoTake: 1,
    videoTakeRange: 1,
    videoTimelineSelection: 1,
    storyTimeline: 1,
    storyAudioAsset: 1,
    storyAudioImportOperation: 1,
    shotDerivationDraft: 1,
    storyOperation: 1,
    inviteCode: 1,
    creditAccount: 1,
    creditLedgerEntry: 1,
    creditHold: 1,
    billingOperation: 1,
    providerAttempt: 1,
    accountIdentity: 1,
    accountCredential: 1,
    accountVerificationChallenge: 1,
    accountRateLimit: 1,
  },
};

function nextMemoryId(type: keyof MemoryState["nextIds"]): number {
  const id = memoryState.nextIds[type];
  memoryState.nextIds[type] += 1;
  return id;
}

function now(): Date {
  return new Date();
}

function localTempPath(targetPath: string): string {
  const suffix = `${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
  return `${targetPath}.${suffix}.tmp`;
}

function applyDefinedValues(
  target: Record<string, unknown>,
  patch: Record<string, unknown>
) {
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      target[key] = value;
    }
  }
}

// 默认真文件路径。测试 / 脚本只要没显式改 LOCAL_PERSIST_PATH，就会落在这里——
// 也正是 2026-06-01 被测试空状态原子覆盖掉的那一份。下面 persistMemoryStateToDisk
// 里的「测试防误写」会拒绝在测试环境往这个默认真文件写，哪怕有人忘了隔离。
const DEFAULT_LOCAL_PERSIST_PATH = path.join(
  process.cwd(),
  ".webdev",
  "local-persist.json"
);
const LOCAL_PERSIST_PATH =
  process.env.LOCAL_PERSIST_PATH?.trim() || DEFAULT_LOCAL_PERSIST_PATH;
const DEFAULT_LOCAL_PROMPT_LINEAGE_PATH =
  LOCAL_PERSIST_PATH === DEFAULT_LOCAL_PERSIST_PATH
    ? path.join(path.dirname(LOCAL_PERSIST_PATH), "prompt-lineage-local.json")
    : `${LOCAL_PERSIST_PATH}.prompt-lineage.json`;
const DEFAULT_LOCAL_EDIT_SNAPSHOTS_PATH =
  LOCAL_PERSIST_PATH === DEFAULT_LOCAL_PERSIST_PATH
    ? path.join(path.dirname(LOCAL_PERSIST_PATH), "edit-snapshots-local.json")
    : `${LOCAL_PERSIST_PATH}.edit-snapshots.json`;
const LOCAL_PROMPT_LINEAGE_PATH =
  process.env.LOCAL_PROMPT_LINEAGE_PATH?.trim() ||
  DEFAULT_LOCAL_PROMPT_LINEAGE_PATH;
const LOCAL_EDIT_SNAPSHOTS_PATH =
  process.env.LOCAL_EDIT_SNAPSHOTS_PATH?.trim() ||
  DEFAULT_LOCAL_EDIT_SNAPSHOTS_PATH;

// ── 本地持久化安全网（2026-06-01 数据事故后加）──
// 文件模式是「每次改动整体重写 + 原子替换」。原子只防「写一半崩了」，不防
// 「完整地写空 / 写错」——今天就是后者：一份合法但空的 state 把 308KB 真数据
// 干净地替换掉了。这里加两层网：① 写前滚动备份（一次坏写最多丢上次备份之后那点）；
// ② 体积骤减时强制备份 + 大声告警，方便人发现。
const LOCAL_PERSIST_BACKUP_DIR = path.join(
  path.dirname(LOCAL_PERSIST_PATH),
  "backups"
);
const BACKUP_THROTTLE_MS = 60_000; // 例行备份最密一分钟一次，避免高频写时刷屏
const BACKUP_KEEP = 50; // 备份目录只留最近 50 份
const SHRINK_MIN_BYTES = 4096; // 盘上原文件够大才判骤减，避免小→小误报
const SHRINK_RATIO = 0.4; // 新内容 < 原文件 40% 视为骤减
let lastBackupAt = 0;
let testWriteBlockedWarned = false;

// vitest 会自动设 VITEST=true；NODE_ENV=test 兜底。运行时读，避免模块加载快照过期。
const isTestEnv = () =>
  Boolean(process.env.VITEST) || process.env.NODE_ENV === "test";

let memoryLoaded = false;
let memoryLoadPromise: Promise<void> | null = null;
let memoryVideoTakeSubmissionClaimQueue: Promise<void> = Promise.resolve();
let memoryInviteClaimQueue: Promise<void> = Promise.resolve();
let memoryEmailOtps: EmailOtp[] = [];
let nextMemoryEmailOtpId = 1;
let promptLineageLoaded = false;
let promptLineageLoadFallback:
  | Partial<PromptLineageLocalState>
  | null
  | undefined;
let editSnapshotsLoaded = false;
let editSnapshotsLoadFallback: Partial<EditSnapshot>[] | undefined;

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return now();
}

function nextIdFromRows(rows: Array<{ id: number }>): number {
  return rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;
}

function normalizeLoadedEditSnapshots(
  raw: Partial<EditSnapshot>[] | undefined
): EditSnapshot[] {
  return (raw ?? []).map(item => ({
    ...item,
    timestamp: toDate(item.timestamp),
  })) as EditSnapshot[];
}

function normalizeLoadedState(raw: Partial<MemoryState>) {
  memoryState.users = (raw.users ?? []).map(item => ({
    ...item,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
    lastSignedIn: toDate(item.lastSignedIn),
  })) as User[];

  memoryState.accessSessions = (raw.accessSessions ?? []).map(item => ({
    ...item,
    startedAt: toDate(item.startedAt),
    lastSeenAt: toDate(item.lastSeenAt),
  })) as AccessSession[];

  memoryState.projects = (raw.projects ?? []).map(item => ({
    ...item,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as Project[];

  memoryState.references = (raw.references ?? []).map(item => ({
    ...item,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as Reference[];

  memoryState.shots = (raw.shots ?? []).map(item => ({
    ...item,
    // 存量镜头无 storyId → 显式置 null（而非 undefined），便于按 storyId 过滤（U1/U2）
    storyId: (item as { storyId?: number | null }).storyId ?? null,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as Shot[];

  memoryState.analysisResults = (raw.analysisResults ?? []).map(item => ({
    ...item,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as AnalysisResult[];

  memoryState.emotionAnalysisProfiles = (raw.emotionAnalysisProfiles ?? []).map(
    item => ({
      ...item,
      createdAt: toDate(item.createdAt),
      updatedAt: toDate(item.updatedAt),
    })
  ) as EmotionAnalysisProfile[];

  memoryState.emotionDailyLetters = (raw.emotionDailyLetters ?? []).map(
    item => ({
      ...item,
      userMessageSaidAt: item.userMessageSaidAt
        ? toDate(item.userMessageSaidAt)
        : null,
      userMessageEditedAt: item.userMessageEditedAt
        ? toDate(item.userMessageEditedAt)
        : null,
      createdAt: toDate(item.createdAt),
      updatedAt: toDate(item.updatedAt),
    })
  ) as EmotionDailyLetter[];

  memoryState.stories = (raw.stories ?? []).map(item => ({
    ...item,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as Story[];

  memoryState.editSnapshots = normalizeLoadedEditSnapshots(raw.editSnapshots);

  memoryState.semanticAnnotations = (raw.semanticAnnotations ?? []).map(
    item => ({
      ...item,
      timestamp: toDate(item.timestamp),
    })
  ) as SemanticAnnotation[];

  memoryState.generatedImages = (raw.generatedImages ?? []).map(item => ({
    ...item,
    shotIdentity:
      (item as { shotIdentity?: string | null }).shotIdentity ?? null,
    promptCompilationId:
      (item as { promptCompilationId?: number | null }).promptCompilationId ??
      null,
    createdAt: toDate(item.createdAt),
  })) as GeneratedImage[];
  memoryState.previewMaskedImageOperations = (
    raw.previewMaskedImageOperations ?? []
  ).map(item => ({
    ...item,
    quoteExpiresAt: toDate(item.quoteExpiresAt),
    leaseUntil: toDate(item.leaseUntil),
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as PreviewMaskedImageOperation[];
  memoryState.timelineFrameExtractionOperations = (
    raw.timelineFrameExtractionOperations ?? []
  ).map(item => ({
    ...item,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as TimelineFrameExtractionOperation[];

  memoryState.imageSignals = (raw.imageSignals ?? []).map(item => ({
    ...item,
    createdAt: toDate(item.createdAt),
  })) as ImageSignal[];

  memoryState.videoTakes = (raw.videoTakes ?? []).map(item => ({
    ...item,
    promptCompilationId:
      (item as { promptCompilationId?: number | null }).promptCompilationId ??
      null,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as VideoTake[];

  memoryState.videoTakeRanges = (raw.videoTakeRanges ?? []).map(item => ({
    ...item,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as VideoTakeRange[];

  memoryState.videoTimelineSelections = (raw.videoTimelineSelections ?? []).map(
    item => ({
      ...item,
      createdAt: toDate(item.createdAt),
      updatedAt: toDate(item.updatedAt),
    })
  ) as VideoTimelineSelection[];
  memoryState.storyTimelines = (raw.storyTimelines ?? []).map(item => ({
    ...item,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as StoryTimeline[];
  memoryState.storyAudioAssets = (raw.storyAudioAssets ?? []).map(item => ({
    ...item,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as StoryAudioAsset[];
  memoryState.storyAudioImportOperations = (
    raw.storyAudioImportOperations ?? []
  ).map(item => ({
    ...item,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as StoryAudioImportOperation[];
  memoryState.shotDerivationDrafts = (raw.shotDerivationDrafts ?? []).map(
    item => ({
      ...item,
      createdAt: toDate(item.createdAt),
      updatedAt: toDate(item.updatedAt),
    })
  ) as ShotDerivationDraft[];
  memoryState.storyOperations = (raw.storyOperations ?? []).map(item => ({
    ...item,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as StoryOperation[];
  memoryState.inviteCodes = (raw.inviteCodes ?? []).map(item => ({
    ...item,
    expiresAt: item.expiresAt ? toDate(item.expiresAt) : null,
    redeemedAt: item.redeemedAt ? toDate(item.redeemedAt) : null,
    createdAt: toDate(item.createdAt),
  })) as InviteCode[];
  memoryState.creditAccounts = (raw.creditAccounts ?? []).map(item => ({
    ...item,
    accessEnabledAt: item.accessEnabledAt ? toDate(item.accessEnabledAt) : null,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as CreditAccount[];
  memoryState.creditLedgerEntries = (raw.creditLedgerEntries ?? []).map(
    item => ({
      ...item,
      createdAt: toDate(item.createdAt),
    })
  ) as CreditLedgerEntry[];
  memoryState.creditHolds = (raw.creditHolds ?? []).map(item => ({
    ...item,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as CreditHold[];
  memoryState.billingOperations = (raw.billingOperations ?? []).map(item => ({
    ...item,
    quoteExpiresAt: item.quoteExpiresAt ? toDate(item.quoteExpiresAt) : null,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as BillingOperation[];
  memoryState.providerAttempts = (raw.providerAttempts ?? []).map(item => ({
    ...item,
    submittedAt: item.submittedAt ? toDate(item.submittedAt) : null,
    completedAt: item.completedAt ? toDate(item.completedAt) : null,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as ProviderAttempt[];
  memoryState.accountIdentities = (raw.accountIdentities ?? []).map(item => ({
    ...item,
    verifiedAt: item.verifiedAt ? toDate(item.verifiedAt) : null,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as AccountIdentity[];
  memoryState.accountCredentials = (raw.accountCredentials ?? []).map(item => ({
    ...item,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as AccountCredential[];
  memoryState.accountVerificationChallenges = (
    raw.accountVerificationChallenges ?? []
  ).map(item => ({
    ...item,
    sentAt: toDate(item.sentAt),
    expiresAt: toDate(item.expiresAt),
    consumedAt: item.consumedAt ? toDate(item.consumedAt) : null,
    invalidatedAt: item.invalidatedAt ? toDate(item.invalidatedAt) : null,
    createdAt: toDate(item.createdAt),
  })) as AccountVerificationChallenge[];
  memoryState.accountRateLimits = (raw.accountRateLimits ?? []).map(item => ({
    ...item,
    windowStartedAt: toDate(item.windowStartedAt),
    blockedUntil: item.blockedUntil ? toDate(item.blockedUntil) : null,
    updatedAt: toDate(item.updatedAt),
  })) as AccountRateLimit[];
  memoryState.promptLineage = normalizePromptLineageLocalState(
    raw.promptLineage
  );
  memoryState.personalMemory = normalizePersonalMemoryLocalState(
    (raw as { personalMemory?: unknown }).personalMemory
  );

  memoryState.nextIds = {
    user: Math.max(raw.nextIds?.user ?? 0, nextIdFromRows(memoryState.users)),
    accessSession: Math.max(
      raw.nextIds?.accessSession ?? 0,
      nextIdFromRows(memoryState.accessSessions)
    ),
    project: Math.max(
      raw.nextIds?.project ?? 0,
      nextIdFromRows(memoryState.projects)
    ),
    reference: Math.max(
      raw.nextIds?.reference ?? 0,
      nextIdFromRows(memoryState.references)
    ),
    shot: Math.max(raw.nextIds?.shot ?? 0, nextIdFromRows(memoryState.shots)),
    analysisResult: Math.max(
      raw.nextIds?.analysisResult ?? 0,
      nextIdFromRows(memoryState.analysisResults)
    ),
    emotionAnalysisProfile: Math.max(
      raw.nextIds?.emotionAnalysisProfile ?? 0,
      nextIdFromRows(memoryState.emotionAnalysisProfiles)
    ),
    emotionDailyLetter: Math.max(
      raw.nextIds?.emotionDailyLetter ?? 0,
      nextIdFromRows(memoryState.emotionDailyLetters)
    ),
    story: Math.max(
      raw.nextIds?.story ?? 0,
      nextIdFromRows(memoryState.stories)
    ),
    editSnapshot: Math.max(
      raw.nextIds?.editSnapshot ?? 0,
      nextIdFromRows(memoryState.editSnapshots)
    ),
    semanticAnnotation: Math.max(
      raw.nextIds?.semanticAnnotation ?? 0,
      nextIdFromRows(memoryState.semanticAnnotations)
    ),
    generatedImage: Math.max(
      raw.nextIds?.generatedImage ?? 0,
      nextIdFromRows(memoryState.generatedImages)
    ),
    previewMaskedImageOperation: Math.max(
      raw.nextIds?.previewMaskedImageOperation ?? 0,
      nextIdFromRows(memoryState.previewMaskedImageOperations)
    ),
    timelineFrameExtractionOperation: Math.max(
      raw.nextIds?.timelineFrameExtractionOperation ?? 0,
      nextIdFromRows(memoryState.timelineFrameExtractionOperations)
    ),
    imageSignal: Math.max(
      raw.nextIds?.imageSignal ?? 0,
      nextIdFromRows(memoryState.imageSignals)
    ),
    videoTake: Math.max(
      raw.nextIds?.videoTake ?? 0,
      nextIdFromRows(memoryState.videoTakes)
    ),
    videoTakeRange: Math.max(
      raw.nextIds?.videoTakeRange ?? 0,
      nextIdFromRows(memoryState.videoTakeRanges)
    ),
    videoTimelineSelection: Math.max(
      raw.nextIds?.videoTimelineSelection ?? 0,
      nextIdFromRows(memoryState.videoTimelineSelections)
    ),
    storyTimeline: Math.max(
      raw.nextIds?.storyTimeline ?? 0,
      nextIdFromRows(memoryState.storyTimelines)
    ),
    storyAudioAsset: Math.max(
      raw.nextIds?.storyAudioAsset ?? 0,
      nextIdFromRows(memoryState.storyAudioAssets)
    ),
    storyAudioImportOperation: Math.max(
      raw.nextIds?.storyAudioImportOperation ?? 0,
      nextIdFromRows(memoryState.storyAudioImportOperations)
    ),
    shotDerivationDraft: Math.max(
      raw.nextIds?.shotDerivationDraft ?? 0,
      nextIdFromRows(memoryState.shotDerivationDrafts)
    ),
    storyOperation: Math.max(
      raw.nextIds?.storyOperation ?? 0,
      nextIdFromRows(memoryState.storyOperations)
    ),
    inviteCode: Math.max(
      raw.nextIds?.inviteCode ?? 0,
      nextIdFromRows(memoryState.inviteCodes)
    ),
    creditAccount: Math.max(
      raw.nextIds?.creditAccount ?? 0,
      nextIdFromRows(memoryState.creditAccounts)
    ),
    creditLedgerEntry: Math.max(
      raw.nextIds?.creditLedgerEntry ?? 0,
      nextIdFromRows(memoryState.creditLedgerEntries)
    ),
    creditHold: Math.max(
      raw.nextIds?.creditHold ?? 0,
      nextIdFromRows(memoryState.creditHolds)
    ),
    billingOperation: Math.max(
      raw.nextIds?.billingOperation ?? 0,
      nextIdFromRows(memoryState.billingOperations)
    ),
    providerAttempt: Math.max(
      raw.nextIds?.providerAttempt ?? 0,
      nextIdFromRows(memoryState.providerAttempts)
    ),
    accountIdentity: Math.max(
      raw.nextIds?.accountIdentity ?? 0,
      nextIdFromRows(memoryState.accountIdentities)
    ),
    accountCredential: Math.max(
      raw.nextIds?.accountCredential ?? 0,
      nextIdFromRows(memoryState.accountCredentials)
    ),
    accountVerificationChallenge: Math.max(
      raw.nextIds?.accountVerificationChallenge ?? 0,
      nextIdFromRows(memoryState.accountVerificationChallenges)
    ),
    accountRateLimit: Math.max(
      raw.nextIds?.accountRateLimit ?? 0,
      nextIdFromRows(memoryState.accountRateLimits)
    ),
  };
}

async function loadLocalPromptLineageState(
  fallback: Partial<PromptLineageLocalState> | null | undefined
): Promise<PromptLineageLocalState> {
  try {
    const raw = await readFile(LOCAL_PROMPT_LINEAGE_PATH, "utf-8");
    return normalizePromptLineageLocalState(JSON.parse(raw));
  } catch (error) {
    const e = error as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") {
      console.warn(
        `[LocalPersist] Failed to load ${LOCAL_PROMPT_LINEAGE_PATH}:`,
        error
      );
    }
    const normalized = normalizePromptLineageLocalState(fallback);
    if (e.code === "ENOENT") {
      await persistLocalPromptLineageStateToDisk(normalized).catch(error => {
        console.warn(
          `[LocalPersist] Failed to initialize ${LOCAL_PROMPT_LINEAGE_PATH}:`,
          error
        );
      });
    }
    return normalized;
  }
}

async function loadLocalEditSnapshots(
  fallback: Partial<EditSnapshot>[] | undefined
): Promise<EditSnapshot[]> {
  try {
    const raw = await readFile(LOCAL_EDIT_SNAPSHOTS_PATH, "utf-8");
    return normalizeLoadedEditSnapshots(JSON.parse(raw));
  } catch (error) {
    const e = error as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") {
      console.warn(
        `[LocalPersist] Failed to load ${LOCAL_EDIT_SNAPSHOTS_PATH}:`,
        error
      );
    }
    const normalized = normalizeLoadedEditSnapshots(fallback);
    if (e.code === "ENOENT") {
      await persistLocalEditSnapshotsToDisk(normalized).catch(error => {
        console.warn(
          `[LocalPersist] Failed to initialize ${LOCAL_EDIT_SNAPSHOTS_PATH}:`,
          error
        );
      });
    }
    return normalized;
  }
}

async function persistLocalPromptLineageStateToDisk(
  next: PromptLineageLocalState
) {
  if (
    isTestEnv() &&
    LOCAL_PERSIST_PATH === DEFAULT_LOCAL_PERSIST_PATH &&
    LOCAL_PROMPT_LINEAGE_PATH === DEFAULT_LOCAL_PROMPT_LINEAGE_PATH
  ) {
    return;
  }
  const dir = path.dirname(LOCAL_PROMPT_LINEAGE_PATH);
  await mkdir(dir, { recursive: true });
  const payload = JSON.stringify(
    normalizePromptLineageLocalState(next),
    null,
    2
  );
  const tmpPath = localTempPath(LOCAL_PROMPT_LINEAGE_PATH);
  await writeFile(tmpPath, payload, "utf-8");
  await rename(tmpPath, LOCAL_PROMPT_LINEAGE_PATH);
}

async function persistLocalEditSnapshotsToDisk(next: EditSnapshot[]) {
  if (
    isTestEnv() &&
    LOCAL_PERSIST_PATH === DEFAULT_LOCAL_PERSIST_PATH &&
    LOCAL_EDIT_SNAPSHOTS_PATH === DEFAULT_LOCAL_EDIT_SNAPSHOTS_PATH
  ) {
    return;
  }
  const dir = path.dirname(LOCAL_EDIT_SNAPSHOTS_PATH);
  await mkdir(dir, { recursive: true });
  // 紧凑序列化：这份文件曾到 24MB+，缩进只服务于人眼但每次写都要多付 ~1/3 的
  // 序列化时间和磁盘 IO。要看内容用 `jq .` 即可。
  const payload = JSON.stringify(normalizeLoadedEditSnapshots(next));
  const tmpPath = localTempPath(LOCAL_EDIT_SNAPSHOTS_PATH);
  await writeFile(tmpPath, payload, "utf-8");
  await rename(tmpPath, LOCAL_EDIT_SNAPSHOTS_PATH);
}

async function ensureMemoryLoaded() {
  if (memoryLoaded) return;
  if (memoryLoadPromise) return memoryLoadPromise;

  memoryLoadPromise = (async () => {
    try {
      const raw = await readFile(LOCAL_PERSIST_PATH, "utf-8");
      const parsed = JSON.parse(raw) as Partial<MemoryState>;
      promptLineageLoadFallback = parsed.promptLineage;
      editSnapshotsLoadFallback = parsed.editSnapshots;
      parsed.promptLineage = createEmptyPromptLineageLocalState();
      parsed.editSnapshots = [];
      promptLineageLoaded = false;
      editSnapshotsLoaded = false;
      normalizeLoadedState(parsed);
      console.log(`[LocalPersist] Loaded data from ${LOCAL_PERSIST_PATH}`);
    } catch (error) {
      const e = error as NodeJS.ErrnoException;
      if (e.code !== "ENOENT") {
        console.warn(
          `[LocalPersist] Failed to load ${LOCAL_PERSIST_PATH}:`,
          error
        );
      }
    } finally {
      memoryLoaded = true;
      memoryLoadPromise = null;
    }
  })();

  return memoryLoadPromise;
}

async function ensureLocalPromptLineageLoaded() {
  await ensureMemoryLoaded();
  if (promptLineageLoaded) return;
  memoryState.promptLineage = await loadLocalPromptLineageState(
    promptLineageLoadFallback
  );
  promptLineageLoadFallback = undefined;
  promptLineageLoaded = true;
}

async function ensureLocalEditSnapshotsLoaded() {
  await ensureMemoryLoaded();
  if (editSnapshotsLoaded) return;
  memoryState.editSnapshots = await loadLocalEditSnapshots(
    editSnapshotsLoadFallback
  );
  editSnapshotsLoadFallback = undefined;
  editSnapshotsLoaded = true;
  memoryState.nextIds.editSnapshot = Math.max(
    memoryState.nextIds.editSnapshot,
    nextIdFromRows(memoryState.editSnapshots)
  );
}

// 写前备份：盘上已有文件时，按节流（≤1/分钟）或「体积骤减」拷一份到 backups/，
// 再修剪到最近 BACKUP_KEEP 份。任何失败都不影响主写入。
async function backupBeforeWrite(nextBytes: number): Promise<void> {
  if (isTestEnv()) return; // 测试不留备份，保持临时目录干净
  let existingBytes: number;
  try {
    existingBytes = (await stat(LOCAL_PERSIST_PATH)).size;
  } catch {
    // ENOENT = 还没有文件，无需备份；其它错误也别挡住主写入
    return;
  }
  const shrink =
    existingBytes > SHRINK_MIN_BYTES &&
    nextBytes < existingBytes * SHRINK_RATIO;
  const dueByTime = Date.now() - lastBackupAt > BACKUP_THROTTLE_MS;
  if (!shrink && !dueByTime) return;
  try {
    await mkdir(LOCAL_PERSIST_BACKUP_DIR, { recursive: true });
    const content = await readFile(LOCAL_PERSIST_PATH, "utf-8");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const name = `local-persist-${ts}${shrink ? "-SHRINK" : ""}.json`;
    await writeFile(
      path.join(LOCAL_PERSIST_BACKUP_DIR, name),
      content,
      "utf-8"
    );
    lastBackupAt = Date.now();
    if (shrink) {
      console.warn(
        `[LocalPersist] ⚠️ 数据疑似骤减（${existingBytes}B → ${nextBytes}B），已先备份到 ${LOCAL_PERSIST_BACKUP_DIR}。若非你主动清空，去 backups/ 里找回。`
      );
    }
    // 修剪：文件名含 ISO 时间戳，字典序≈时间序，删掉最旧的、只留最近 BACKUP_KEEP 份。
    const files = (await readdir(LOCAL_PERSIST_BACKUP_DIR))
      .filter(f => f.startsWith("local-persist-") && f.endsWith(".json"))
      .sort();
    for (const stale of files.slice(
      0,
      Math.max(0, files.length - BACKUP_KEEP)
    )) {
      await unlink(path.join(LOCAL_PERSIST_BACKUP_DIR, stale)).catch(() => {});
    }
  } catch (error) {
    console.warn("[LocalPersist] 备份失败（不影响主写入）：", error);
  }
}

/**
 * 用途：标记本地 JSON 持久化写盘失败——磁盘/文件系统层面出了问题（目录不可写、
 *   磁盘满、rename 失败等），区别于 `StoryBodyRevisionConflictError` 这类"业务上
 *   合理的拒绝"。`cause` 保留原始 Node fs 错误，便于日志排查。
 * 调用入口：`persistMemoryStateToDisk` 在 mkdir/writeFile/rename 任一步失败时抛出。
 * 下游调用：经 `persistMemoryState` 传播给 db.ts 全部本地模式写函数的调用方
 *   （tRPC procedure 会把它转成一次 500，调用方应当当作基础设施故障处理并可重试）。
 */
export class LocalPersistenceWriteError extends Error {
  constructor(path: string, cause: unknown) {
    super(`Failed to persist local state to ${path}: ${String(cause)}`);
    this.name = "LocalPersistenceWriteError";
    this.cause = cause;
  }
}

async function persistMemoryStateToDisk(state: MemoryState = memoryState) {
  // ① 测试防误写：测试环境下，绝不往默认真文件写——哪怕 vitest.setup.ts 被删/没生效。
  //    要在测试里持久化，必须在导入前显式设 LOCAL_PERSIST_PATH（指向临时文件）。
  if (isTestEnv() && LOCAL_PERSIST_PATH === DEFAULT_LOCAL_PERSIST_PATH) {
    if (!testWriteBlockedWarned) {
      console.warn(
        "[LocalPersist] 测试环境拒绝写入真文件（未设 LOCAL_PERSIST_PATH）。如需在测试里持久化，请在导入前设置该环境变量指向临时文件。"
      );
      testWriteBlockedWarned = true;
    }
    return;
  }
  // Capture this batch synchronously, before the first filesystem await. A
  // later caller may mutate memoryState while mkdir/backup/write is pending;
  // that mutation belongs to the next coalescer batch and must not hitchhike
  // into this batch's durable payload.
  const {
    promptLineage: _promptLineage,
    editSnapshots: _editSnapshots,
    ...mainState
  } = state;
  const payload = JSON.stringify(mainState);
  const nextBytes = Buffer.byteLength(payload, "utf-8");
  let tmpPathWritten: string | null = null;
  try {
    const dir = path.dirname(LOCAL_PERSIST_PATH);
    await mkdir(dir, { recursive: true });
    // ② 写前滚动备份 + 骤减告警（自身失败不影响主写入，backupBeforeWrite 内部已吞错误）
    await backupBeforeWrite(nextBytes);
    const tmpPath = localTempPath(LOCAL_PERSIST_PATH);
    await writeFile(tmpPath, payload, "utf-8");
    tmpPathWritten = tmpPath;
    await rename(tmpPath, LOCAL_PERSIST_PATH);
  } catch (error) {
    // rename 失败时 tmp 文件已经写完但没被消费掉，best-effort 清理一下，
    // 避免每次失败都在磁盘上留一个孤儿文件；清理本身失败不能盖过原始错误。
    if (tmpPathWritten) {
      await unlink(tmpPathWritten).catch(() => {});
    }
    const wrapped = new LocalPersistenceWriteError(LOCAL_PERSIST_PATH, error);
    console.error("[LocalPersist]", wrapped.message);
    throw wrapped;
  }
}

type PendingWrite = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason: unknown) => void;
  failureCleanups: Array<() => void>;
};

const createPendingWrite = (): PendingWrite => {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject, failureCleanups: [] };
};

/**
 * 用途：把「短时间内的多次写盘请求」合并成一次真正的磁盘写。
 *   文件模式下每次写盘都是「序列化整个 state + 原子替换」，几十到上百毫秒起步；
 *   而一次对话往往在同一瞬间触发十几次写。原来的串行队列会把它们排成十几次全量
 *   重写，接口延迟按队列长度线性累积——这正是"接外部 API 时很卡"的一部分成因。
 *
 * 正确性：调用方总是先把变更同步应用到内存态、再调用本函数，所以只要有一次
 *   **在本次调用之后才开始**的写盘成功，调用方的变更就一定落了盘。因此新请求只能
 *   合并进「下一批尚未开始的写」，绝不能搭正在跑的那次便车——后者可能在本次变更
 *   之前就已经序列化完了。合并只改变"写几次"，不改变"何时算落盘"。
 *
 * 失败语义与过去一致：某一批写盘失败，只有这一批的调用方拿到异常，不会卡死
 *   后面排队的写入。
 */
function createWriteCoalescer(
  write: () => Promise<void>
): (onFailureBeforeNextBatch?: () => void) => Promise<void> {
  let running = false;
  let pending: PendingWrite | null = null;

  async function pump(): Promise<void> {
    running = true;
    try {
      while (pending) {
        const batch = pending;
        pending = null;
        try {
          await write();
          batch.resolve();
        } catch (error) {
          for (const cleanup of batch.failureCleanups) cleanup();
          batch.reject(error);
        }
      }
    } finally {
      running = false;
    }
  }

  return function schedule(
    onFailureBeforeNextBatch?: () => void
  ): Promise<void> {
    pending ??= createPendingWrite();
    if (onFailureBeforeNextBatch)
      pending.failureCleanups.push(onFailureBeforeNextBatch);
    const joined = pending.promise;
    if (!running) void pump();
    return joined;
  };
}

/**
 * 用途：把本次写盘请求接入合并器，并如实把这次写盘的成功/失败反馈给调用方——
 *   不再像过去那样吞掉磁盘错误、让调用方误以为已经落盘。同一瞬间涌进来的多次
 *   请求会合并成一次全量重写（见 createWriteCoalescer），每个调用方拿到的仍是
 *   "覆盖了自己这次变更"的 promise，失败与否互不影响。
 *   注意：本函数只保证"失败会向调用方抛出"，不保证"调用方已经应用到
 *   memoryState 的内存态变更会自动回滚"——那是每个调用方自己的责任。目前
 *   `updateStoryBodyIfRevision` 与 `updateStoryTimeline` 在失败时做了按字段回滚；其余
 *   本地模式写函数（User、Shot 等约 50+ 处）在磁盘失败后会正确抛出异常，但它们
 *   已经生效的内存态变更不会被撤销，且可能被后续任意一次成功的写盘操作顺带落
 *   盘（因为 persistMemoryStateToDisk 每次都是序列化当前完整的 memoryState）。
 *   这是已知的、有意收窄的范围，不是遗漏。
 * 调用入口：db.ts 内所有本地模式写函数（Story、User、Shot 等约 50+ 处）。
 * 下游调用：persistMemoryStateToDisk。
 */
let localPersistenceWriteTail: Promise<void> = Promise.resolve();

function enqueueLocalPersistenceWrite<T>(action: () => Promise<T>): Promise<T> {
  const previous = localPersistenceWriteTail;
  const result = previous.catch(() => {}).then(action);
  localPersistenceWriteTail = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function frozenMemoryStateSnapshot(state: MemoryState): MemoryState {
  return structuredClone(state);
}

const persistMemoryState = createWriteCoalescer(() => {
  // Freeze at batch creation, before waiting for the disk queue. Otherwise a
  // later optimistic mutation could hitchhike into an earlier durable batch.
  const snapshot = frozenMemoryStateSnapshot(memoryState);
  return enqueueLocalPersistenceWrite(() => persistMemoryStateToDisk(snapshot));
});

let localAggregateMutationTail: Promise<void> = Promise.resolve();
let localAggregateMutationPending = 0;
let localBodyMutationCount = 0;
let localBodyMutationDrain: Promise<void> = Promise.resolve();
let resolveLocalBodyMutationDrain: (() => void) | null = null;

function beginLocalBodyMutation(): void {
  if (localBodyMutationCount === 0) {
    localBodyMutationDrain = new Promise<void>(resolve => {
      resolveLocalBodyMutationDrain = resolve;
    });
  }
  localBodyMutationCount += 1;
}

function endLocalBodyMutation(): void {
  localBodyMutationCount -= 1;
  if (localBodyMutationCount === 0) {
    resolveLocalBodyMutationDrain?.();
    resolveLocalBodyMutationDrain = null;
  }
}

async function withLocalBodyMutation<T>(action: () => Promise<T>): Promise<T> {
  while (localAggregateMutationPending > 0) {
    await localAggregateMutationTail.catch(() => {});
  }
  // No await may appear between the pending check and this registration:
  // aggregate writers mark themselves pending synchronously, so either this
  // body writer joins the current reader group or the aggregate waits for it.
  beginLocalBodyMutation();
  try {
    return await action();
  } finally {
    endLocalBodyMutation();
  }
}

async function withLocalAggregateMutationLock<T>(
  action: () => Promise<T>
): Promise<T> {
  localAggregateMutationPending += 1;
  const previous = localAggregateMutationTail;
  let release!: () => void;
  const current = new Promise<void>(resolve => {
    release = resolve;
  });
  localAggregateMutationTail = previous.catch(() => {}).then(() => current);
  await previous.catch(() => {});
  await localBodyMutationDrain;
  try {
    return await action();
  } finally {
    localAggregateMutationPending -= 1;
    release();
  }
}

const localTimelineLock = createKeyedSerialLock<string>();
const localStoryLock = createKeyedSerialLock<string>();

async function withLocalStoryLock<T>(
  storyId: number,
  userId: number,
  action: () => Promise<T>
): Promise<T> {
  const key = `${userId}:${storyId}`;
  return localStoryLock.run(key, action);
}

async function withLocalTimelineLock<T>(
  storyId: number,
  userId: number,
  action: () => Promise<T>
): Promise<T> {
  const key = `${userId}:${storyId}`;
  return localTimelineLock.run(key, action);
}

/**
 * 编辑快照走独立文件、独立合并器：它是三份本地文件里最大的一份（曾涨到 24MB+），
 * 和主 state 分开合并，避免一次大快照写把主 state 的写也拖住。
 */
const persistLocalEditSnapshots = createWriteCoalescer(() =>
  persistLocalEditSnapshotsToDisk(memoryState.editSnapshots)
);

// 防呆：强制连接用 utf8mb4。mysql2 默认连接字符集是 3 字节的 utf8，
// 中文存得下、但 emoji（4 字节）会乱码。已写了 charset 的连接串则原样保留。
function ensureUtf8mb4(databaseUrl: string): string {
  if (/[?&]charset=/i.test(databaseUrl)) return databaseUrl;
  return `${databaseUrl}${databaseUrl.includes("?") ? "&" : "?"}charset=utf8mb4`;
}

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!_db && databaseUrl) {
    try {
      _db = drizzle(ensureUtf8mb4(databaseUrl));
      if (!mysqlModeLogged) {
        console.log("[Database] 已连接 MySQL，故事走云端库");
        mysqlModeLogged = true;
      }
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  if (!_db) {
    if (!localPersistModeLogged && !databaseUrl) {
      console.log("[Database] 未配置 DATABASE_URL，降级到本地持久化");
      localPersistModeLogged = true;
    }
    await ensureMemoryLoaded();
  }
  return _db;
}

export async function getLocalPromptLineageState(): Promise<PromptLineageLocalState | null> {
  const db = await getDb();
  if (db) return null;
  await ensureLocalPromptLineageLoaded();
  return structuredClone(memoryState.promptLineage);
}

/**
 * 单 Story 窄读：先按 storyId 从内存态筛出这个 Story 的切片，只 clone 这份
 * 切片，不碰其它 Story 的记录。提示词仓库整份可能有几 MB～十几 MB，读一个
 * Story 不该先把全库 structuredClone 一遍。
 *
 * 全局共享、不属于任何单个 Story 的三张艺术素材库表（artLibraries /
 * artLibraryVersions / artLibraryItems）以及只在写入路径用得到的
 * operationReceipts 不在这里展开——调用方（loadStoryPromptAggregate 的
 * getStoryAggregate）不读这几个字段，展开了也是白拷贝。nextIds 是全局自增
 * 计数器，读路径不需要按 Story 切；直接透传引用即可，反正 structuredClone
 * 只会拷贝这几个数字，成本可以忽略。
 */
export async function getLocalPromptLineageStateForStory(
  storyId: number
): Promise<PromptLineageLocalState | null> {
  const db = await getDb();
  if (db) return null;
  await ensureLocalPromptLineageLoaded();
  const full = memoryState.promptLineage;
  const byStory = <T extends { storyId: number }>(rows: T[]) =>
    rows.filter(row => row.storyId === storyId);
  const compilations = byStory(full.compilations);
  const compilationIds = new Set(compilations.map(row => row.id));
  return structuredClone({
    storyStates: byStory(full.storyStates),
    nodes: byStory(full.nodes),
    revisions: byStory(full.revisions),
    bindings: byStory(full.bindings),
    compilations,
    compilationInputs: full.compilationInputs.filter(row =>
      compilationIds.has(row.compilationId)
    ),
    compilationHeads: byStory(full.compilationHeads),
    conversations: byStory(full.conversations),
    turns: byStory(full.turns),
    messages: byStory(full.messages),
    messageReferences: byStory(full.messageReferences),
    artLibraries: [],
    artLibraryVersions: [],
    artLibraryItems: [],
    storyArtBindings: byStory(full.storyArtBindings),
    operationReceipts: byStory(full.operationReceipts),
    // 这是只读切片，不是写入路径：outbox 属于整份聚合、按 seq 排队，
    // 按 Story 切开没有意义，展开了也是白拷贝。写入走
    // createPersistentLocalPromptLineageStore 那条持有全量的路径。
    personalMemoryOutbox: [],
    nextPersonalMemoryOutboxSeq: full.nextPersonalMemoryOutboxSeq,
    nextIds: full.nextIds,
  });
}

/**
 * 更窄的单 Story 读：只要 compilationHeads（stableShotId + modality +
 * currentCompilationId 的当前指针），不展开 nodes/revisions/messages 等
 * 大字段。storyMaterials 的时间线投影只用这一张表拼 lookup，见
 * server/services/storyMaterials.ts 的 getStoryMaterialState。
 */
export async function getLocalPromptCompilationHeadsForStory(
  storyId: number
): Promise<PromptCompilationHead[]> {
  const db = await getDb();
  if (db) return [];
  await ensureLocalPromptLineageLoaded();
  return structuredClone(
    memoryState.promptLineage.compilationHeads.filter(
      head => head.storyId === storyId
    )
  );
}

export async function replaceLocalPromptLineageState(
  next: PromptLineageLocalState
): Promise<void> {
  const db = await getDb();
  if (db) {
    throw new Error("Local prompt lineage state is unavailable in MySQL mode");
  }
  memoryState.promptLineage = normalizePromptLineageLocalState(
    structuredClone(next)
  );
  promptLineageLoaded = true;
  promptLineageLoadFallback = undefined;
  await persistLocalPromptLineageStateToDisk(memoryState.promptLineage);
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    const existing = memoryState.users.find(u => u.openId === user.openId);
    if (existing) {
      applyDefinedValues(
        existing as unknown as Record<string, unknown>,
        user as unknown as Record<string, unknown>
      );
      existing.updatedAt = now();
      if (user.lastSignedIn !== undefined) {
        existing.lastSignedIn = user.lastSignedIn as Date;
      }
      await persistMemoryState();
      return;
    }

    const current = now();
    memoryState.users.push({
      id: nextMemoryId("user"),
      openId: user.openId,
      name: user.name ?? null,
      email: user.email ?? null,
      loginMethod: user.loginMethod ?? null,
      role: (user.role ??
        (user.openId === ENV.ownerOpenId ? "admin" : "user")) as User["role"],
      sessionVersion: user.sessionVersion ?? 1,
      createdAt: current,
      updatedAt: current,
      lastSignedIn: (user.lastSignedIn as Date | undefined) ?? current,
    });
    await persistMemoryState();
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    return memoryState.users.find(user => user.openId === openId);
  }

  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) {
    return memoryState.users.find(user => user.id === id);
  }

  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0] ?? undefined;
}

const MAX_ACCESS_HEARTBEAT_GAP_SECONDS = 90;

export type AccessOverviewRow = {
  userId: number;
  name: string | null;
  email: string | null;
  role: User["role"];
  createdAt: Date;
  lastSignedIn: Date;
  firstSeenAt: Date;
  lastSeenAt: Date;
  hasAccessHistory: boolean;
  visitCount: number;
  durationSeconds: number;
  imageGenerations: number;
  videoGenerations: number;
  videoSeconds: number;
  recentSessions: Array<{
    startedAt: Date;
    lastSeenAt: Date;
    durationSeconds: number;
  }>;
};

function isMissingVideoTakesTable(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== "object") return false;
    const candidate = current as {
      code?: unknown;
      sqlMessage?: unknown;
      cause?: unknown;
    };
    if (
      candidate.code === "ER_NO_SUCH_TABLE" &&
      typeof candidate.sqlMessage === "string" &&
      candidate.sqlMessage.includes("video_takes")
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

export async function recordAccessHeartbeat(input: {
  userId: number;
  visitId: string;
  siteHost: string;
  occurredAt?: Date;
}): Promise<AccessSession> {
  const occurredAt = input.occurredAt ?? now();
  const db = await getDb();

  if (!db) {
    await ensureMemoryLoaded();
    const existing = memoryState.accessSessions.find(
      session =>
        session.userId === input.userId &&
        session.visitId === input.visitId &&
        session.siteHost === input.siteHost
    );
    if (existing) {
      const elapsedSeconds = Math.max(
        0,
        Math.floor(
          (occurredAt.getTime() - existing.lastSeenAt.getTime()) / 1000
        )
      );
      existing.durationSeconds += Math.min(
        elapsedSeconds,
        MAX_ACCESS_HEARTBEAT_GAP_SECONDS
      );
      existing.lastSeenAt = occurredAt;
      await persistMemoryState();
      return existing;
    }

    const row: AccessSession = {
      id: nextMemoryId("accessSession"),
      userId: input.userId,
      visitId: input.visitId,
      siteHost: input.siteHost,
      startedAt: occurredAt,
      lastSeenAt: occurredAt,
      durationSeconds: 0,
    };
    memoryState.accessSessions.push(row);
    await persistMemoryState();
    return row;
  }

  const [existing] = await db
    .select()
    .from(accessSessions)
    .where(
      and(
        eq(accessSessions.userId, input.userId),
        eq(accessSessions.visitId, input.visitId),
        eq(accessSessions.siteHost, input.siteHost)
      )
    )
    .limit(1);

  if (!existing) {
    await db.insert(accessSessions).values({
      userId: input.userId,
      visitId: input.visitId,
      siteHost: input.siteHost,
      startedAt: occurredAt,
      lastSeenAt: occurredAt,
      durationSeconds: 0,
    });
  } else {
    const elapsedSeconds = Math.max(
      0,
      Math.floor((occurredAt.getTime() - existing.lastSeenAt.getTime()) / 1000)
    );
    await db
      .update(accessSessions)
      .set({
        lastSeenAt: occurredAt,
        durationSeconds:
          existing.durationSeconds +
          Math.min(elapsedSeconds, MAX_ACCESS_HEARTBEAT_GAP_SECONDS),
      })
      .where(eq(accessSessions.id, existing.id));
  }

  const [saved] = await db
    .select()
    .from(accessSessions)
    .where(
      and(
        eq(accessSessions.userId, input.userId),
        eq(accessSessions.visitId, input.visitId),
        eq(accessSessions.siteHost, input.siteHost)
      )
    )
    .limit(1);
  if (!saved) {
    throw new Error("访问会话保存失败");
  }
  return saved;
}

export async function getAccessOverview(
  siteHost: string
): Promise<AccessOverviewRow[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
  }
  const sessions = !db
    ? memoryState.accessSessions.filter(
        session => session.siteHost === siteHost
      )
    : await db
        .select()
        .from(accessSessions)
        .where(eq(accessSessions.siteHost, siteHost));
  const allUsers = !db ? memoryState.users : await db.select().from(users);
  const imageUsage = !db
    ? Array.from(
        memoryState.generatedImages.reduce((counts, image) => {
          if (image.userId != null) {
            counts.set(image.userId, (counts.get(image.userId) ?? 0) + 1);
          }
          return counts;
        }, new Map<number, number>())
      ).map(([userId, count]) => ({ userId, count }))
    : await db
        .select({
          userId: generatedImages.userId,
          count: sql<number>`count(*)`,
        })
        .from(generatedImages)
        .where(isNotNull(generatedImages.userId))
        .groupBy(generatedImages.userId);
  let videoUsage: Array<{ userId: number; count: number; seconds: number }>;
  if (!db) {
    videoUsage = Array.from(
      memoryState.videoTakes.reduce((usage, video) => {
        if (video.status !== "available") return usage;
        const current = usage.get(video.userId) ?? { count: 0, seconds: 0 };
        current.count += 1;
        current.seconds += video.durationSec ?? 0;
        usage.set(video.userId, current);
        return usage;
      }, new Map<number, { count: number; seconds: number }>())
    ).map(([userId, value]) => ({ userId, ...value }));
  } else {
    try {
      videoUsage = await db
        .select({
          userId: videoTakes.userId,
          count: sql<number>`count(*)`,
          seconds: sql<number>`coalesce(sum(${videoTakes.durationSec}), 0)`,
        })
        .from(videoTakes)
        .where(eq(videoTakes.status, "available"))
        .groupBy(videoTakes.userId);
    } catch (error) {
      if (!isMissingVideoTakesTable(error)) throw error;
      console.warn(
        "[AccessAnalytics] video_takes table is not available; reporting zero video usage"
      );
      videoUsage = [];
    }
  }
  const emailUsers = allUsers.filter(user => Boolean(user.email));
  const usersById = new Map(emailUsers.map(user => [user.id, user]));
  const overview = new Map<number, AccessOverviewRow>();

  for (const user of emailUsers) {
    overview.set(user.id, {
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      lastSignedIn: user.lastSignedIn,
      firstSeenAt: user.createdAt,
      lastSeenAt: user.lastSignedIn,
      hasAccessHistory: false,
      visitCount: 0,
      durationSeconds: 0,
      imageGenerations: 0,
      videoGenerations: 0,
      videoSeconds: 0,
      recentSessions: [],
    });
  }

  for (const session of sessions) {
    const user = usersById.get(session.userId);
    if (!user) continue;
    const current = overview.get(session.userId)!;
    if (!current.hasAccessHistory) {
      current.firstSeenAt = session.startedAt;
      current.lastSeenAt = session.lastSeenAt;
      current.hasAccessHistory = true;
    }
    current.firstSeenAt =
      session.startedAt < current.firstSeenAt
        ? session.startedAt
        : current.firstSeenAt;
    current.lastSeenAt =
      session.lastSeenAt > current.lastSeenAt
        ? session.lastSeenAt
        : current.lastSeenAt;
    current.visitCount += 1;
    current.durationSeconds += session.durationSeconds;
    current.recentSessions.push({
      startedAt: session.startedAt,
      lastSeenAt: session.lastSeenAt,
      durationSeconds: session.durationSeconds,
    });
  }

  for (const image of imageUsage) {
    if (image.userId == null) continue;
    const current = overview.get(image.userId);
    if (current) current.imageGenerations = Number(image.count);
  }
  for (const video of videoUsage) {
    const current = overview.get(video.userId);
    if (!current) continue;
    current.videoGenerations = Number(video.count);
    current.videoSeconds = Number(video.seconds);
  }
  for (const current of Array.from(overview.values())) {
    current.recentSessions = current.recentSessions
      .sort(
        (left, right) => right.startedAt.getTime() - left.startedAt.getTime()
      )
      .slice(0, 3);
  }

  return Array.from(overview.values()).sort(
    (left, right) => right.lastSeenAt.getTime() - left.lastSeenAt.getTime()
  );
}

// ─── Project ─────────────────────────────────────────────────────────────

export async function createProject(data: InsertProject) {
  const db = await getDb();
  if (!db) {
    const current = now();
    const row: Project = {
      id: nextMemoryId("project"),
      userId: data.userId,
      name: data.name,
      deadline: data.deadline ?? null,
      autoRender: data.autoRender ?? false,
      createdAt: current,
      updatedAt: current,
    };
    memoryState.projects.push(row);
    await persistMemoryState();
    return { id: row.id };
  }
  const result = await db.insert(projects).values(data);
  return { id: result[0].insertId };
}

const defaultProjectLocks = new Map<number, Promise<Project>>();

async function findOrCreateUserDefaultProject(
  userId: number
): Promise<Project> {
  const existing = await getUserProjects(userId);
  if (existing[0]) return existing[0];

  const created = await createProject({
    userId,
    name: "默认分析项目",
  });
  const project = await getProjectById(created.id, userId);
  if (!project) {
    throw new Error("默认项目创建失败");
  }
  return project;
}

export async function getOrCreateUserDefaultProject(
  userId: number
): Promise<Project> {
  const currentLock = defaultProjectLocks.get(userId);
  if (currentLock) return currentLock;

  const nextLock = findOrCreateUserDefaultProject(userId).finally(() => {
    if (defaultProjectLocks.get(userId) === nextLock) {
      defaultProjectLocks.delete(userId);
    }
  });
  defaultProjectLocks.set(userId, nextLock);
  return nextLock;
}

export async function getUserProjects(userId: number) {
  const db = await getDb();
  if (!db) {
    return memoryState.projects
      .filter(project => project.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }
  return db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.updatedAt));
}

export async function getProjectById(projectId: number, userId: number) {
  const db = await getDb();
  if (!db) {
    const project = memoryState.projects.find(
      p => p.id === projectId && p.userId === userId
    );
    return project ?? null;
  }
  const result = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  return result[0] ?? null;
}

// ─── Reference ───────────────────────────────────────────────────────────

export async function createReference(data: InsertReference) {
  const db = await getDb();
  if (!db) {
    const current = now();
    const row: Reference = {
      id: nextMemoryId("reference"),
      projectId: data.projectId,
      userId: data.userId,
      title: data.title,
      sourceType: data.sourceType,
      fileUrl: data.fileUrl ?? null,
      fileKey: data.fileKey ?? null,
      mimeType: data.mimeType ?? null,
      fileSize: data.fileSize ?? null,
      dateBucket: data.dateBucket ?? null,
      importance: data.importance ?? 3,
      pinned: data.pinned ?? false,
      excluded: data.excluded ?? false,
      extractedText: data.extractedText ?? null,
      extractedTags: data.extractedTags ?? null,
      sortOrder: data.sortOrder ?? memoryState.references.length,
      createdAt: current,
      updatedAt: current,
    };
    memoryState.references.push(row);
    await persistMemoryState();
    return { id: row.id };
  }
  const result = await db.insert(references).values(data);
  return { id: result[0].insertId };
}

export async function getProjectReferences(projectId: number) {
  const db = await getDb();
  if (!db) {
    return memoryState.references
      .filter(
        reference => reference.projectId === projectId && !reference.excluded
      )
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }
  return db
    .select()
    .from(references)
    .where(
      and(eq(references.projectId, projectId), eq(references.excluded, false))
    )
    .orderBy(references.sortOrder);
}

export async function updateReference(
  id: number,
  userId: number,
  data: Partial<InsertReference>
) {
  const db = await getDb();
  if (!db) {
    const row = memoryState.references.find(
      reference => reference.id === id && reference.userId === userId
    );
    if (!row) return;
    applyDefinedValues(
      row as unknown as Record<string, unknown>,
      data as unknown as Record<string, unknown>
    );
    row.updatedAt = now();
    await persistMemoryState();
    return;
  }
  await db
    .update(references)
    .set(data)
    .where(and(eq(references.id, id), eq(references.userId, userId)));
}

// ─── Shot ────────────────────────────────────────────────────────────────

export async function createShots(data: InsertShot[]) {
  const db = await getDb();
  if (!db) {
    if (data.length === 0) return [];
    const current = now();
    const rows: Shot[] = data.map(item => ({
      id: nextMemoryId("shot"),
      projectId: item.projectId,
      storyId: item.storyId ?? null,
      userId: item.userId,
      sceneNo: item.sceneNo,
      shotNo: item.shotNo,
      sourceSummary: item.sourceSummary ?? null,
      intentType: item.intentType ?? "idea",
      status: item.status ?? "idea_pool",
      readinessScore: item.readinessScore ?? 0,
      deadline: item.deadline ?? null,
      priority: item.priority ?? "medium",
      autoRender: item.autoRender ?? false,
      blockingIssues: item.blockingIssues ?? null,
      nextAction: item.nextAction ?? null,
      sceneType: item.sceneType ?? null,
      timeOfDay: item.timeOfDay ?? null,
      weather: item.weather ?? null,
      lighting: item.lighting ?? null,
      cameraFocalLength: item.cameraFocalLength ?? null,
      cameraMovement: item.cameraMovement ?? null,
      spatialLayers: item.spatialLayers ?? null,
      mood: item.mood ?? null,
      colorPalette: item.colorPalette ?? null,
      promptDraft: item.promptDraft ?? null,
      negativePrompt: item.negativePrompt ?? null,
      createdAt: current,
      updatedAt: current,
    }));
    memoryState.shots.push(...rows);
    await persistMemoryState();
    return rows;
  }
  if (data.length === 0) return [];
  const result = await db.insert(shots).values(data);
  return result;
}

// 按 storyId 替换某故事的导演镜头（故事为唯一单位，U3）。
// 保留 intentType === "director_note" 过滤——只替换导演镜头，不误删其他来源镜头；
// 同时带 userId 条件，防跨用户写入。data 里每行的 storyId 应已是本 storyId。
export async function replaceDirectorShotsForStory(
  storyId: number,
  userId: number,
  data: InsertShot[]
) {
  const db = await getDb();
  if (!db) {
    memoryState.shots = memoryState.shots.filter(
      shot =>
        !(
          shot.storyId === storyId &&
          shot.userId === userId &&
          shot.intentType === "director_note"
        )
    );
    if (data.length > 0) {
      const current = now();
      const rows: Shot[] = data.map(item => ({
        id: nextMemoryId("shot"),
        projectId: item.projectId,
        storyId: item.storyId ?? null,
        userId: item.userId,
        sceneNo: item.sceneNo,
        shotNo: item.shotNo,
        sourceSummary: item.sourceSummary ?? null,
        intentType: item.intentType ?? "director_note",
        status: item.status ?? "idea_pool",
        readinessScore: item.readinessScore ?? 0,
        deadline: item.deadline ?? null,
        priority: item.priority ?? "medium",
        autoRender: item.autoRender ?? false,
        blockingIssues: item.blockingIssues ?? null,
        nextAction: item.nextAction ?? null,
        sceneType: item.sceneType ?? null,
        timeOfDay: item.timeOfDay ?? null,
        weather: item.weather ?? null,
        lighting: item.lighting ?? null,
        cameraFocalLength: item.cameraFocalLength ?? null,
        cameraMovement: item.cameraMovement ?? null,
        spatialLayers: item.spatialLayers ?? null,
        mood: item.mood ?? null,
        colorPalette: item.colorPalette ?? null,
        promptDraft: item.promptDraft ?? null,
        negativePrompt: item.negativePrompt ?? null,
        createdAt: current,
        updatedAt: current,
      }));
      memoryState.shots.push(...rows);
    }
    await persistMemoryState();
    return;
  }

  await db
    .delete(shots)
    .where(
      and(
        eq(shots.storyId, storyId),
        eq(shots.userId, userId),
        eq(shots.intentType, "director_note")
      )
    );

  if (data.length > 0) {
    await db.insert(shots).values(data);
  }
}

// 旧的按 projectId 取镜头——仅 server/archive 死代码仍在用，活跃路径已改用 getStoryShots。
// 保留以兼容 archive 编译；不要在活跃代码新增调用（无 userId 过滤）。
export async function getProjectShots(projectId: number) {
  const db = await getDb();
  if (!db) {
    return memoryState.shots
      .filter(shot => shot.projectId === projectId)
      .sort((a, b) => {
        if (a.sceneNo === b.sceneNo) {
          return a.shotNo.localeCompare(b.shotNo);
        }
        return a.sceneNo.localeCompare(b.sceneNo);
      });
  }
  return db
    .select()
    .from(shots)
    .where(eq(shots.projectId, projectId))
    .orderBy(shots.sceneNo, shots.shotNo);
}

// 按 storyId 取某故事的镜头（故事为唯一单位，U3）。
// 必须带 userId 过滤——防"猜 storyId 取他人镜头"（旧的 getProjectShots 无 userId 过滤）。
export async function getStoryShots(storyId: number, userId: number) {
  const db = await getDb();
  if (!db) {
    return memoryState.shots
      .filter(shot => shot.storyId === storyId && shot.userId === userId)
      .sort((a, b) => {
        if (a.sceneNo === b.sceneNo) {
          return a.shotNo.localeCompare(b.shotNo);
        }
        return a.sceneNo.localeCompare(b.sceneNo);
      });
  }
  return db
    .select()
    .from(shots)
    .where(and(eq(shots.storyId, storyId), eq(shots.userId, userId)))
    .orderBy(shots.sceneNo, shots.shotNo);
}

export async function updateShot(
  id: number,
  userId: number,
  data: Partial<InsertShot>
) {
  const db = await getDb();
  if (!db) {
    const row = memoryState.shots.find(
      shot => shot.id === id && shot.userId === userId
    );
    if (!row) return;
    applyDefinedValues(
      row as unknown as Record<string, unknown>,
      data as unknown as Record<string, unknown>
    );
    row.updatedAt = now();
    await persistMemoryState();
    return;
  }
  await db
    .update(shots)
    .set(data)
    .where(and(eq(shots.id, id), eq(shots.userId, userId)));
}

export async function batchUpdateShots(
  ids: number[],
  userId: number,
  data: Partial<InsertShot>
) {
  const db = await getDb();
  if (!db) {
    let changed = false;
    for (const id of ids) {
      const row = memoryState.shots.find(
        shot => shot.id === id && shot.userId === userId
      );
      if (!row) continue;
      applyDefinedValues(
        row as unknown as Record<string, unknown>,
        data as unknown as Record<string, unknown>
      );
      row.updatedAt = now();
      changed = true;
    }
    if (changed) {
      await persistMemoryState();
    }
    return;
  }
  for (const id of ids) {
    await db
      .update(shots)
      .set(data)
      .where(and(eq(shots.id, id), eq(shots.userId, userId)));
  }
}

// ─── Analysis Result ─────────────────────────────────────────────────────

export async function createAnalysisResult(data: InsertAnalysisResult) {
  const db = await getDb();
  if (!db) {
    const current = now();
    const row: AnalysisResult = {
      id: nextMemoryId("analysisResult"),
      projectId: data.projectId,
      userId: data.userId,
      mood: data.mood ?? null,
      lighting: data.lighting ?? null,
      spatialStructure: data.spatialStructure ?? null,
      cameraLanguage: data.cameraLanguage ?? null,
      colorPalette: data.colorPalette ?? null,
      atmosphereKeywords: data.atmosphereKeywords ?? null,
      promptDraft: data.promptDraft ?? null,
      negativePrompt: data.negativePrompt ?? null,
      parameterSuggestions: data.parameterSuggestions ?? null,
      summary: data.summary ?? null,
      createdAt: current,
      updatedAt: current,
    };
    memoryState.analysisResults.push(row);
    await persistMemoryState();
    return { id: row.id };
  }
  const result = await db.insert(analysisResults).values(data);
  return { id: result[0].insertId };
}

export async function getProjectAnalysis(projectId: number) {
  const db = await getDb();
  if (!db) {
    const rows = memoryState.analysisResults
      .filter(item => item.projectId === projectId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return rows[0] ?? null;
  }
  const result = await db
    .select()
    .from(analysisResults)
    .where(eq(analysisResults.projectId, projectId))
    .orderBy(desc(analysisResults.createdAt))
    .limit(1);
  return result[0] ?? null;
}

// ─── Emotion Analysis Profile ────────────────────────────────────────────

export async function getEmotionAnalysisProfile(
  userId: number
): Promise<EmotionAnalysisProfile | null> {
  const db = await getDb();
  if (!db) {
    const rows = memoryState.emotionAnalysisProfiles
      .filter(item => item.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return rows[0] ?? null;
  }
  const result = await db
    .select()
    .from(emotionAnalysisProfiles)
    .where(eq(emotionAnalysisProfiles.userId, userId))
    .orderBy(desc(emotionAnalysisProfiles.updatedAt))
    .limit(1);
  return result[0] ?? null;
}

export async function upsertEmotionAnalysisProfile(
  data: InsertEmotionAnalysisProfile
): Promise<EmotionAnalysisProfile> {
  const db = await getDb();
  if (!db) {
    const current = now();
    const existing = memoryState.emotionAnalysisProfiles
      .filter(item => item.userId === data.userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];

    if (existing) {
      applyDefinedValues(
        existing as unknown as Record<string, unknown>,
        data as unknown as Record<string, unknown>
      );
      existing.updatedAt = current;
      await persistMemoryState();
      return existing;
    }

    const row: EmotionAnalysisProfile = {
      id: nextMemoryId("emotionAnalysisProfile"),
      userId: data.userId,
      projectId: data.projectId ?? null,
      birthDate: data.birthDate,
      consentVersion: data.consentVersion,
      consentText: data.consentText ?? null,
      dailyReference: data.dailyReference ?? null,
      analysisSeed: data.analysisSeed ?? null,
      createdAt: current,
      updatedAt: current,
    };
    memoryState.emotionAnalysisProfiles.push(row);
    await persistMemoryState();
    return row;
  }

  const existing = await getEmotionAnalysisProfile(data.userId);
  if (existing) {
    await db
      .update(emotionAnalysisProfiles)
      .set(data)
      .where(
        and(
          eq(emotionAnalysisProfiles.id, existing.id),
          eq(emotionAnalysisProfiles.userId, data.userId)
        )
      );
    return (await getEmotionAnalysisProfile(data.userId))!;
  }

  const result = await db.insert(emotionAnalysisProfiles).values(data);
  const inserted = await db
    .select()
    .from(emotionAnalysisProfiles)
    .where(eq(emotionAnalysisProfiles.id, result[0].insertId))
    .limit(1);
  return inserted[0];
}

// ─── Emotion Daily Letters ─────────────────────────────────────────────

export async function getEmotionDailyLetter(
  userId: number,
  letterDate: string
): Promise<EmotionDailyLetter | null> {
  const db = await getDb();
  if (!db) {
    return (
      memoryState.emotionDailyLetters.find(
        item => item.userId === userId && item.letterDate === letterDate
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(emotionDailyLetters)
    .where(
      and(
        eq(emotionDailyLetters.userId, userId),
        eq(emotionDailyLetters.letterDate, letterDate)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function listEmotionDailyLetters(
  userId: number,
  limit = 90
): Promise<EmotionDailyLetter[]> {
  const safeLimit = Math.max(1, Math.min(365, Math.floor(limit)));
  const db = await getDb();
  if (!db) {
    return memoryState.emotionDailyLetters
      .filter(item => item.userId === userId)
      .sort((a, b) => b.letterDate.localeCompare(a.letterDate))
      .slice(0, safeLimit);
  }
  return db
    .select()
    .from(emotionDailyLetters)
    .where(eq(emotionDailyLetters.userId, userId))
    .orderBy(desc(emotionDailyLetters.letterDate))
    .limit(safeLimit);
}

export async function ensureEmotionDailyLetter(
  data: InsertEmotionDailyLetter
): Promise<EmotionDailyLetter> {
  const existing = await getEmotionDailyLetter(data.userId, data.letterDate);
  if (existing) return existing;

  const db = await getDb();
  if (!db) {
    return upsertEmotionDailyLetter(data);
  }
  await db
    .insert(emotionDailyLetters)
    .values(data)
    .onDuplicateKeyUpdate({
      set: { letterDate: data.letterDate },
    });
  return (await getEmotionDailyLetter(data.userId, data.letterDate))!;
}

export async function upsertEmotionDailyLetter(
  data: InsertEmotionDailyLetter
): Promise<EmotionDailyLetter> {
  const db = await getDb();
  if (!db) {
    const current = now();
    const existing = memoryState.emotionDailyLetters.find(
      item => item.userId === data.userId && item.letterDate === data.letterDate
    );
    if (existing) {
      applyDefinedValues(
        existing as unknown as Record<string, unknown>,
        data as unknown as Record<string, unknown>
      );
      existing.updatedAt = current;
      await persistMemoryState();
      return existing;
    }

    const row: EmotionDailyLetter = {
      id: nextMemoryId("emotionDailyLetter"),
      userId: data.userId,
      letterDate: data.letterDate,
      userMessage: data.userMessage ?? null,
      userMessageSaidAt: data.userMessageSaidAt ?? null,
      userMessageEditedAt: data.userMessageEditedAt ?? null,
      dailyReference: data.dailyReference,
      analysisSeed: data.analysisSeed,
      revision: data.revision ?? 1,
      currentVersionId: data.currentVersionId ?? null,
      createdAt: current,
      updatedAt: current,
    };
    memoryState.emotionDailyLetters.push(row);
    await persistMemoryState();
    return row;
  }

  await db
    .insert(emotionDailyLetters)
    .values(data)
    .onDuplicateKeyUpdate({
      set: {
        userMessage: data.userMessage ?? null,
        userMessageSaidAt: data.userMessageSaidAt ?? null,
        userMessageEditedAt: data.userMessageEditedAt ?? null,
        dailyReference: data.dailyReference,
        analysisSeed: data.analysisSeed,
        revision: data.revision ?? 1,
        updatedAt: new Date(),
      },
    });
  return (await getEmotionDailyLetter(data.userId, data.letterDate))!;
}

export async function updateEmotionDailyLetterIfRevision(
  data: InsertEmotionDailyLetter,
  expectedRevision: number
): Promise<EmotionDailyLetter | null> {
  const db = await getDb();
  if (!db) {
    const existing = memoryState.emotionDailyLetters.find(
      item => item.userId === data.userId && item.letterDate === data.letterDate
    );
    if (!existing || existing.revision !== expectedRevision) return null;
    applyDefinedValues(
      existing as unknown as Record<string, unknown>,
      data as unknown as Record<string, unknown>
    );
    existing.revision = expectedRevision + 1;
    existing.updatedAt = now();
    await persistMemoryState();
    return existing;
  }

  const result = await db
    .update(emotionDailyLetters)
    .set({
      userMessage: data.userMessage ?? null,
      userMessageSaidAt: data.userMessageSaidAt ?? null,
      userMessageEditedAt: data.userMessageEditedAt ?? null,
      dailyReference: data.dailyReference,
      analysisSeed: data.analysisSeed,
      revision: expectedRevision + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(emotionDailyLetters.userId, data.userId),
        eq(emotionDailyLetters.letterDate, data.letterDate),
        eq(emotionDailyLetters.revision, expectedRevision)
      )
    );
  if (result[0].affectedRows !== 1) return null;
  return getEmotionDailyLetter(data.userId, data.letterDate);
}

// ─── Story ──────────────────────────────────────────────────────────────
//
// drinking-time 工坊的故事/镜头表持久化。当前归属语义：
// - 每条 story 属于一个 user（owner）
// - projectId 可空，未来 host page 真接上项目时再绑
// Phase 3 加共享时，会再加一张 storyMembers 表用 storyId 反查可读用户

export type StoryListItem = Pick<
  Story,
  | "id"
  | "userId"
  | "projectId"
  | "title"
  | "logline"
  | "theme"
  | "arc"
  | "summary"
  | "createdAt"
  | "updatedAt"
> & { cardCount: number; shotCount: number; activityDates: string[] };

function chinaDateKey(value: Date | number | string): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(item => item.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function storyActivityDates(body: unknown, createdAt: Date): string[] {
  const dates = new Set<string>();
  if (body && typeof body === "object") {
    const messages = (body as { messages?: unknown }).messages;
    if (Array.isArray(messages)) {
      for (const message of messages) {
        if (!message || typeof message !== "object") continue;
        const record = message as { role?: unknown; timestamp?: unknown };
        if (record.role !== "user") continue;
        if (
          typeof record.timestamp !== "number" &&
          typeof record.timestamp !== "string"
        ) {
          continue;
        }
        const date = chinaDateKey(record.timestamp);
        if (date) dates.add(date);
      }
    }
  }
  if (dates.size === 0) {
    const fallback = chinaDateKey(createdAt);
    if (fallback) dates.add(fallback);
  }
  return Array.from(dates).sort();
}

function emptyBody(): StoryBody {
  return { cards: [], characters: [], shots: [] };
}

function bodyCardCount(body: unknown): number {
  if (!body || typeof body !== "object") return 0;
  const cards = (body as { cards?: unknown }).cards;
  return Array.isArray(cards) ? cards.length : 0;
}

function bodyShotCount(body: unknown): number {
  if (!body || typeof body !== "object") return 0;
  const shots = (body as { shots?: unknown }).shots;
  return Array.isArray(shots) ? shots.length : 0;
}

function toListItem(row: Story): StoryListItem {
  return {
    id: row.id,
    userId: row.userId,
    projectId: row.projectId,
    title: row.title,
    logline: row.logline,
    theme: row.theme,
    arc: row.arc,
    summary: row.summary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    cardCount: bodyCardCount(row.body),
    shotCount: bodyShotCount(row.body),
    activityDates: storyActivityDates(row.body, row.createdAt),
  };
}

export async function listUserStories(
  userId: number
): Promise<StoryListItem[]> {
  const db = await getDb();
  if (!db) {
    return memoryState.stories
      .filter(s => s.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map(toListItem);
  }
  const rows = await db
    .select()
    .from(stories)
    .where(eq(stories.userId, userId))
    .orderBy(desc(stories.updatedAt));
  return rows.map(toListItem);
}

export async function getStoryById(
  id: number,
  userId: number
): Promise<Story | null> {
  const db = await getDb();
  if (!db) {
    const row = memoryState.stories.find(
      s => s.id === id && s.userId === userId
    );
    return row ?? null;
  }
  const result = await db
    .select()
    .from(stories)
    .where(and(eq(stories.id, id), eq(stories.userId, userId)))
    .limit(1);
  return result[0] ?? null;
}

// getLatestStoryForProject 已移除（U6）：故事是唯一单位后，Creation 侧改为
// 跟随传入的当前故事 storyId，不再"取项目里最新的故事"。如需按项目列故事用 listUserStories。

export async function createStory(data: InsertStory): Promise<{ id: number }> {
  const db = await getDb();
  if (!db) {
    const current = now();
    const row: Story = {
      id: nextMemoryId("story"),
      userId: data.userId,
      projectId: data.projectId ?? null,
      title: data.title,
      logline: data.logline ?? null,
      theme: data.theme ?? null,
      arc: data.arc ?? null,
      summary: data.summary ?? null,
      // Drizzle 把 json 列推成 unknown；写盘走 JSON.stringify 没问题
      body: (data.body ?? emptyBody()) as unknown,
      createdAt: current,
      updatedAt: current,
    };
    memoryState.stories.push(row);
    await persistMemoryState();
    return { id: row.id };
  }
  const result = await db.insert(stories).values(data);
  return { id: result[0].insertId };
}

/**
 * 整故事覆盖式更新。前端的存储模型就是「整 blob 写盘」，所以这里照着做。
 * 校验所有权：传错 userId 的写不进来。
 */
export async function updateStory(
  id: number,
  userId: number,
  data: Partial<InsertStory>
): Promise<void> {
  const db = await getDb();
  if (!db) {
    const row = memoryState.stories.find(
      s => s.id === id && s.userId === userId
    );
    if (!row) return;
    applyDefinedValues(
      row as unknown as Record<string, unknown>,
      data as unknown as Record<string, unknown>
    );
    row.updatedAt = now();
    await persistMemoryState();
    return;
  }
  await db
    .update(stories)
    .set(data)
    .where(and(eq(stories.id, id), eq(stories.userId, userId)));
}

/**
 * 用途：Story 标题的唯一直写入口——只改 title 列，不碰 body，因此不参与 body 的
 *   CAS（`updateStoryBodyIfRevision` 才是 body 的写入口）。`onlyIfUntitled` 为
 *   true 时只在盘上标题仍是占位名的情况下才写入，用来兜住"自动命名不得覆盖用户
 *   手工改过的名字"这条不变量；判定放在存储写入本身（内存分支查 row.title、
 *   数据库分支进 WHERE），不依赖调用方先读一次再写。
 *   这里合并了原先的 `updateStoryTitle` 与 `updateStoryTitleIfUntitled`：两者只差
 *   这一个谓词，却各自复制了一遍所有权校验、内存/数据库双分支和返回值语义。
 * 调用入口：server/routers/storyAgent.ts 的 `storyRename`（onlyIfUntitled 省略）
 *   与 `storyAutoRename`（onlyIfUntitled: true）。
 * 下游调用：persistMemoryState（内存模式）；drizzle UPDATE（数据库模式）。
 * @returns 是否真的写入了一行——false 表示故事不存在、不属于该用户，或
 *   （onlyIfUntitled 时）标题已被人工命名过。
 */
export async function writeStoryTitle(input: {
  id: number;
  userId: number;
  title: string;
  onlyIfUntitled?: boolean;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    const row = memoryState.stories.find(
      story => story.id === input.id && story.userId === input.userId
    );
    if (!row) return false;
    if (input.onlyIfUntitled && !isUntitledStoryTitle(row.title)) return false;
    row.title = input.title;
    row.updatedAt = now();
    await persistMemoryState();
    return true;
  }
  const result = await db
    .update(stories)
    .set({ title: input.title })
    .where(
      and(
        eq(stories.id, input.id),
        eq(stories.userId, input.userId),
        ...(input.onlyIfUntitled
          ? [sql`TRIM(${stories.title}) IN ('', '未命名', '未命名故事')`]
          : [])
      )
    );
  return result[0].affectedRows === 1;
}

function persistedStoryBodyRevision(body: unknown): number {
  if (!body || typeof body !== "object" || Array.isArray(body)) return 0;
  const revision = (body as Record<string, unknown>)._revision;
  return typeof revision === "number" &&
    Number.isInteger(revision) &&
    revision >= 0
    ? revision
    : 0;
}

/**
 * Owner-scoped Story-body compare-and-swap. The revision predicate is checked
 * by the storage write itself; callers must not treat an earlier read or an
 * in-process mutex as the correctness boundary.
 *
 * 用途：Story body 唯一的资源级 CAS 写入口——目标资源（这个 Story 的 body）
 *   当前 revision 是唯一的写入冲突判定依据；owner 由 `id`+`userId` 同时校验
 *   （对应 U2 合同里的 story ScopeKey + OwnerScope 概念，这里先不引入类型，
 *   概念对齐即可）。内存模式下写盘失败会按字段把 `row` 恢复到调用前的值——
 *   只回滚仍然等于本次调用写入结果的字段，绝不用整行快照覆盖，因为并发的
 *   另一次写入（哪怕是完全不同的函数，比如 `writeStoryTitle`）可能已经在
 *   本次调用等待磁盘落盘期间，合法地改动了同一行对象上的其它字段。
 * 调用入口：server/services/storyBodyPersistence.ts 的 `persistPreparedStoryBody`
 *   （Story 文本字段与 publishing 写入都经此唯一入口）。
 * 下游调用：persistMemoryState（内存模式）；drizzle CAS UPDATE（数据库模式）。
 */
export async function updateStoryBodyIfRevision(input: {
  id: number;
  userId: number;
  expectedRevision: number;
  body: unknown;
  data?: Omit<Partial<InsertStory>, "body">;
  /**
   * 明确采用的经历（U3）。与这次 CAS 共享事务边界：CAS 输了不写，赢了才写。
   * 见 persistPreparedStoryBody 的说明——不允许 CAS 之后 best-effort 补。
   */
  personalMemoryCapture?: PersonalMemoryCapture;
}): Promise<boolean> {
  const nextRevision = persistedStoryBodyRevision(input.body);
  if (nextRevision !== input.expectedRevision + 1) {
    throw new Error(
      `Story CAS body revision ${nextRevision} must follow expected revision ${input.expectedRevision}`
    );
  }
  const db = await getDb();
  if (!db) {
    return withLocalBodyMutation(async () => {
      const row = memoryState.stories.find(
        story => story.id === input.id && story.userId === input.userId
      );
      if (
        !row ||
        persistedStoryBodyRevision(row.body) !== input.expectedRevision
      ) {
        return false;
      }
      // Copy-on-write snapshot: mutate optimistically, but if the disk flush
      // fails, restore this row to what it was before this call so a failed
      // write never leaves memoryState in a "succeeded in RAM, lost on disk"
      // state. This restore must be per-field, not a blanket
      // `Object.assign(row, previousRow)`: `row` is a live, shared object, and
      // between our mutation and the disk flush settling, a concurrent writer
      // (another CAS call once this call's optimistic revision makes it look
      // like a legal base, or an unrelated writer like writeStoryTitle
      // touching only `title`) can legitimately mutate a *different* field on
      // the same object and already succeed. A blanket restore would silently
      // erase that already-committed change. So: only roll back a field if it
      // still holds exactly the value *this call* set — if something else has
      // since changed it, that's a newer write we must not clobber.
      const previousRow = { ...row };
      // 经历与 body 进同一次 copy-on-write。落盘失败时下面会把它整份还原——
      // Story 与足迹索引同属 local-persist 聚合，所以不需要 outbox。
      const previousPersonalMemory = input.personalMemoryCapture
        ? structuredClone(memoryState.personalMemory)
        : null;
      if (input.personalMemoryCapture) {
        applyPersonalMemoryCapture(
          memoryState.personalMemory,
          input.personalMemoryCapture
        );
      }
      const writtenFields: Record<string, unknown> = { body: input.body };
      if (input.data) {
        applyDefinedValues(
          row as unknown as Record<string, unknown>,
          input.data as unknown as Record<string, unknown>
        );
        Object.assign(writtenFields, input.data);
      }
      row.body = input.body;
      row.updatedAt = now();
      writtenFields.updatedAt = row.updatedAt;
      try {
        await persistMemoryState();
      } catch (error) {
        if (previousPersonalMemory) {
          memoryState.personalMemory = previousPersonalMemory;
        }
        const rowRecord = row as unknown as Record<string, unknown>;
        const previousRecord = previousRow as unknown as Record<
          string,
          unknown
        >;
        // Known narrow limitation: for primitive `data` fields this compares by
        // value, so a concurrent writer that legitimately set the same field to
        // an identical value would still be rolled back here. `body` and
        // `updatedAt` are immune (always freshly constructed per call, so this
        // is a reference comparison). Accepted for now — closing it needs
        // per-field write tokens, which is out of scope for this unit.
        for (const key of Object.keys(writtenFields)) {
          if (rowRecord[key] === writtenFields[key]) {
            rowRecord[key] = previousRecord[key];
          }
        }
        throw error;
      }
      return true;
    });
  }
  // 包进事务是为了让采用经历和这次 CAS 同生共死。没有捕获时它只是一条
  // 单语句事务，行为与过去等价。
  return db.transaction(async tx => {
    const result = await tx
      .update(stories)
      .set({ ...(input.data ?? {}), body: input.body })
      .where(
        and(
          eq(stories.id, input.id),
          eq(stories.userId, input.userId),
          sql`CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${stories.body}, '$._revision')), '0') AS UNSIGNED) = ${input.expectedRevision}`
        )
      );
    if (result[0].affectedRows !== 1) return false;
    if (input.personalMemoryCapture) {
      await capturePersonalMemoryEvent(
        { mode: "mysql", tx },
        input.personalMemoryCapture
      );
    }
    return true;
  });
}

export async function deleteStory(id: number, userId: number): Promise<void> {
  const db = await getDb();
  // Managed audio bytes live on local disk in every mode; capture the storage
  // keys before the rows go so the files can be removed after (best effort —
  // an FK cascade only takes the metadata).
  const audioStorageKeys = await listStoryAudioStorageKeysForStory({
    storyId: id,
    userId,
  });
  if (!db) {
    const idx = memoryState.stories.findIndex(
      s => s.id === id && s.userId === userId
    );
    if (idx >= 0) {
      memoryState.stories.splice(idx, 1);
      memoryState.storyAudioAssets = memoryState.storyAudioAssets.filter(
        asset => !(asset.storyId === id && asset.userId === userId)
      );
      memoryState.storyAudioImportOperations =
        memoryState.storyAudioImportOperations.filter(
          op => !(op.storyId === id && op.userId === userId)
        );
      // 级联删除该故事的镜头（评审 P1）：故事是唯一单位，删故事后其镜头按
      // storyId 再也取不到、永不清理，会成孤儿。同删避免悬挂数据。
      memoryState.shots = memoryState.shots.filter(
        s => !(s.storyId === id && s.userId === userId)
      );
      memoryState.generatedImages = memoryState.generatedImages.filter(
        image => !(image.storyId === id && image.userId === userId)
      );
      memoryState.imageSignals = memoryState.imageSignals.filter(
        signal => !(signal.storyId === id && signal.userId === userId)
      );
      memoryState.videoTakes = memoryState.videoTakes.filter(
        take => !(take.storyId === id && take.userId === userId)
      );
      memoryState.videoTakeRanges = memoryState.videoTakeRanges.filter(
        range => !(range.storyId === id && range.userId === userId)
      );
      memoryState.videoTimelineSelections =
        memoryState.videoTimelineSelections.filter(
          selection =>
            !(selection.storyId === id && selection.userId === userId)
        );
      memoryState.storyTimelines = memoryState.storyTimelines.filter(
        timeline => !(timeline.storyId === id && timeline.userId === userId)
      );
      memoryState.shotDerivationDrafts =
        memoryState.shotDerivationDrafts.filter(
          draft => !(draft.storyId === id && draft.userId === userId)
        );
      memoryState.storyOperations = memoryState.storyOperations.filter(
        operation => !(operation.storyId === id && operation.userId === userId)
      );
      await ensureLocalPromptLineageLoaded();
      const promptLineage = memoryState.promptLineage;
      const owned = <T extends { storyId: number; userId: number }>(item: T) =>
        item.storyId === id && item.userId === userId;
      const removedCompilationIds = new Set(
        promptLineage.compilations
          .filter(owned)
          .map(compilation => compilation.id)
      );
      const removedMessageIds = new Set(
        promptLineage.messages.filter(owned).map(message => message.id)
      );
      promptLineage.storyStates = promptLineage.storyStates.filter(
        item => !owned(item)
      );
      promptLineage.nodes = promptLineage.nodes.filter(item => !owned(item));
      promptLineage.revisions = promptLineage.revisions.filter(
        item => !owned(item)
      );
      promptLineage.bindings = promptLineage.bindings.filter(
        item => !owned(item)
      );
      promptLineage.compilations = promptLineage.compilations.filter(
        item => !owned(item)
      );
      promptLineage.compilationInputs = promptLineage.compilationInputs.filter(
        item => !removedCompilationIds.has(item.compilationId)
      );
      promptLineage.compilationHeads = promptLineage.compilationHeads.filter(
        item => !owned(item)
      );
      promptLineage.conversations = promptLineage.conversations.filter(
        item => !owned(item)
      );
      promptLineage.messages = promptLineage.messages.filter(
        item => !owned(item)
      );
      promptLineage.messageReferences = promptLineage.messageReferences.filter(
        item => !owned(item) && !removedMessageIds.has(item.messageId)
      );
      promptLineage.storyArtBindings = promptLineage.storyArtBindings.filter(
        item => !owned(item)
      );
      promptLineage.operationReceipts = promptLineage.operationReceipts.filter(
        item => !owned(item)
      );
      await persistLocalPromptLineageStateToDisk(promptLineage);
      await persistMemoryState();
    }
    await removeManagedAudioFiles(audioStorageKeys);
    return;
  }
  await db
    .delete(storyOperations)
    .where(
      and(eq(storyOperations.storyId, id), eq(storyOperations.userId, userId))
    );
  await db
    .delete(shotDerivationDrafts)
    .where(
      and(
        eq(shotDerivationDrafts.storyId, id),
        eq(shotDerivationDrafts.userId, userId)
      )
    );
  await db
    .delete(storyTimelines)
    .where(
      and(eq(storyTimelines.storyId, id), eq(storyTimelines.userId, userId))
    );
  await db
    .delete(videoTimelineSelections)
    .where(
      and(
        eq(videoTimelineSelections.storyId, id),
        eq(videoTimelineSelections.userId, userId)
      )
    );
  await db
    .delete(videoTakeRanges)
    .where(
      and(eq(videoTakeRanges.storyId, id), eq(videoTakeRanges.userId, userId))
    );
  await db
    .delete(videoTakes)
    .where(and(eq(videoTakes.storyId, id), eq(videoTakes.userId, userId)));
  await db
    .delete(imageSignals)
    .where(and(eq(imageSignals.storyId, id), eq(imageSignals.userId, userId)));
  await db
    .delete(generatedImages)
    .where(
      and(eq(generatedImages.storyId, id), eq(generatedImages.userId, userId))
    );
  await db
    .delete(shots)
    .where(and(eq(shots.storyId, id), eq(shots.userId, userId)));
  await db
    .delete(storyAudioAssets)
    .where(
      and(eq(storyAudioAssets.storyId, id), eq(storyAudioAssets.userId, userId))
    );
  await db
    .delete(storyAudioImportOperations)
    .where(
      and(
        eq(storyAudioImportOperations.storyId, id),
        eq(storyAudioImportOperations.userId, userId)
      )
    );
  await db
    .delete(stories)
    .where(and(eq(stories.id, id), eq(stories.userId, userId)));
  await removeManagedAudioFiles(audioStorageKeys);
}

export type LegacyGuestClaimResult = {
  sourceUserId: number | null;
  targetUserId: number;
  targetProjectId: number | null;
  migratedStoryIds: number[];
  migratedStoryCount: number;
  reason: "claimed" | "no_legacy_user" | "same_user" | "no_stories";
};

export async function claimLegacyGuestStories(
  targetUserId: number,
  sourceUserId?: number
): Promise<LegacyGuestClaimResult> {
  const sourceUser =
    sourceUserId == null
      ? await getUserByOpenId(LEGACY_GUEST_OPEN_ID)
      : await getUserById(sourceUserId);
  if (!sourceUser) {
    return {
      sourceUserId: null,
      targetUserId,
      targetProjectId: null,
      migratedStoryIds: [],
      migratedStoryCount: 0,
      reason: "no_legacy_user",
    };
  }
  if (sourceUser.id === targetUserId) {
    return {
      sourceUserId: sourceUser.id,
      targetUserId,
      targetProjectId: null,
      migratedStoryIds: [],
      migratedStoryCount: 0,
      reason: "same_user",
    };
  }

  const targetProject = await getOrCreateUserDefaultProject(targetUserId);
  const db = await getDb();

  if (!db) {
    await ensureMemoryLoaded();
    const sourceStories = memoryState.stories.filter(
      story => story.userId === sourceUser.id
    );
    if (sourceStories.length === 0) {
      return {
        sourceUserId: sourceUser.id,
        targetUserId,
        targetProjectId: targetProject.id,
        migratedStoryIds: [],
        migratedStoryCount: 0,
        reason: "no_stories",
      };
    }

    const storyIds = new Set(sourceStories.map(story => story.id));
    const current = now();

    for (const story of sourceStories) {
      story.userId = targetUserId;
      story.projectId = targetProject.id;
      story.updatedAt = current;
    }
    for (const shot of memoryState.shots) {
      if (shot.userId !== sourceUser.id) continue;
      if (!shot.storyId || !storyIds.has(shot.storyId)) continue;
      shot.userId = targetUserId;
      shot.projectId = targetProject.id;
      shot.updatedAt = current;
    }
    for (const image of memoryState.generatedImages) {
      const belongsToStory =
        image.storyId != null && storyIds.has(image.storyId);
      const belongsToLegacyUser =
        image.userId === sourceUser.id || image.userId == null;
      if (!belongsToStory || !belongsToLegacyUser) continue;
      image.userId = targetUserId;
      image.projectId = targetProject.id;
    }
    for (const signal of memoryState.imageSignals) {
      if (signal.userId !== sourceUser.id) continue;
      if (!storyIds.has(signal.storyId)) continue;
      signal.userId = targetUserId;
    }
    for (const take of memoryState.videoTakes) {
      if (take.userId !== sourceUser.id) continue;
      if (!storyIds.has(take.storyId)) continue;
      take.userId = targetUserId;
      take.updatedAt = current;
    }
    for (const range of memoryState.videoTakeRanges) {
      if (range.userId !== sourceUser.id) continue;
      if (!storyIds.has(range.storyId)) continue;
      range.userId = targetUserId;
      range.updatedAt = current;
    }
    for (const selection of memoryState.videoTimelineSelections) {
      if (selection.userId !== sourceUser.id) continue;
      if (!storyIds.has(selection.storyId)) continue;
      selection.userId = targetUserId;
      selection.updatedAt = current;
    }
    for (const timeline of memoryState.storyTimelines) {
      if (timeline.userId !== sourceUser.id) continue;
      if (!storyIds.has(timeline.storyId)) continue;
      timeline.userId = targetUserId;
      timeline.updatedAt = current;
    }
    for (const draft of memoryState.shotDerivationDrafts) {
      if (draft.userId !== sourceUser.id) continue;
      if (!storyIds.has(draft.storyId)) continue;
      draft.userId = targetUserId;
      draft.updatedAt = current;
    }
    for (const operation of memoryState.storyOperations) {
      if (operation.userId !== sourceUser.id) continue;
      if (!storyIds.has(operation.storyId)) continue;
      operation.userId = targetUserId;
      operation.updatedAt = current;
    }
    for (const operation of memoryState.previewMaskedImageOperations) {
      if (operation.userId !== sourceUser.id) continue;
      if (!storyIds.has(operation.storyId)) continue;
      operation.userId = targetUserId;
      operation.updatedAt = current;
    }

    await ensureLocalPromptLineageLoaded();
    const promptLineage = memoryState.promptLineage;
    const reassignOwnedStoryRows = <
      T extends { storyId: number; userId: number },
    >(
      rows: T[]
    ) => {
      for (const row of rows) {
        if (row.userId !== sourceUser.id) continue;
        if (!storyIds.has(row.storyId)) continue;
        row.userId = targetUserId;
      }
    };
    reassignOwnedStoryRows(promptLineage.storyStates);
    reassignOwnedStoryRows(promptLineage.nodes);
    for (const revision of promptLineage.revisions) {
      if (revision.userId === sourceUser.id && storyIds.has(revision.storyId)) {
        revision.userId = targetUserId;
      }
      if (revision.authorUserId === sourceUser.id) {
        revision.authorUserId = targetUserId;
      }
    }
    reassignOwnedStoryRows(promptLineage.bindings);
    reassignOwnedStoryRows(promptLineage.compilations);
    reassignOwnedStoryRows(promptLineage.compilationHeads);
    reassignOwnedStoryRows(promptLineage.conversations);
    reassignOwnedStoryRows(promptLineage.messages);
    reassignOwnedStoryRows(promptLineage.messageReferences);
    reassignOwnedStoryRows(promptLineage.storyArtBindings);
    reassignOwnedStoryRows(promptLineage.operationReceipts);

    await persistLocalPromptLineageStateToDisk(promptLineage);
    await persistMemoryState();
    return {
      sourceUserId: sourceUser.id,
      targetUserId,
      targetProjectId: targetProject.id,
      migratedStoryIds: Array.from(storyIds),
      migratedStoryCount: storyIds.size,
      reason: "claimed",
    };
  }

  const sourceStories = await db
    .select({ id: stories.id })
    .from(stories)
    .where(eq(stories.userId, sourceUser.id));
  if (sourceStories.length === 0) {
    return {
      sourceUserId: sourceUser.id,
      targetUserId,
      targetProjectId: targetProject.id,
      migratedStoryIds: [],
      migratedStoryCount: 0,
      reason: "no_stories",
    };
  }

  const storyIds = sourceStories.map(story => story.id);

  await db.transaction(async tx => {
    const storyScope = (
      storyIdColumn: { name: string },
      userIdColumn: { name: string }
    ) =>
      and(
        eq(userIdColumn as any, sourceUser.id),
        inArray(storyIdColumn as any, storyIds)
      );

    await tx
      .update(shots)
      .set({ userId: targetUserId, projectId: targetProject.id })
      .where(storyScope(shots.storyId, shots.userId));
    await tx
      .update(generatedImages)
      .set({ userId: targetUserId, projectId: targetProject.id })
      .where(
        and(
          inArray(generatedImages.storyId, storyIds),
          or(
            eq(generatedImages.userId, sourceUser.id),
            isNull(generatedImages.userId)
          )
        )
      );
    await tx
      .update(previewMaskedImageOperations)
      .set({ userId: targetUserId })
      .where(
        storyScope(
          previewMaskedImageOperations.storyId,
          previewMaskedImageOperations.userId
        )
      );
    await tx
      .update(imageSignals)
      .set({ userId: targetUserId })
      .where(storyScope(imageSignals.storyId, imageSignals.userId));
    await tx
      .update(videoTakes)
      .set({ userId: targetUserId })
      .where(storyScope(videoTakes.storyId, videoTakes.userId));
    await tx
      .update(videoTakeRanges)
      .set({ userId: targetUserId })
      .where(storyScope(videoTakeRanges.storyId, videoTakeRanges.userId));
    await tx
      .update(videoTimelineSelections)
      .set({ userId: targetUserId })
      .where(
        storyScope(
          videoTimelineSelections.storyId,
          videoTimelineSelections.userId
        )
      );
    await tx
      .update(storyTimelines)
      .set({ userId: targetUserId })
      .where(storyScope(storyTimelines.storyId, storyTimelines.userId));
    await tx
      .update(shotDerivationDrafts)
      .set({ userId: targetUserId })
      .where(
        storyScope(shotDerivationDrafts.storyId, shotDerivationDrafts.userId)
      );
    await tx
      .update(storyOperations)
      .set({ userId: targetUserId })
      .where(storyScope(storyOperations.storyId, storyOperations.userId));
    await tx
      .update(storyPromptStates)
      .set({ userId: targetUserId })
      .where(storyScope(storyPromptStates.storyId, storyPromptStates.userId));
    await tx
      .update(promptNodes)
      .set({ userId: targetUserId })
      .where(storyScope(promptNodes.storyId, promptNodes.userId));
    await tx
      .update(promptRevisions)
      .set({
        userId: targetUserId,
        authorUserId: sql`CASE WHEN ${promptRevisions.authorUserId} = ${sourceUser.id} THEN ${targetUserId} ELSE ${promptRevisions.authorUserId} END`,
      })
      .where(storyScope(promptRevisions.storyId, promptRevisions.userId));
    await tx
      .update(promptNodeBindings)
      .set({ userId: targetUserId })
      .where(storyScope(promptNodeBindings.storyId, promptNodeBindings.userId));
    await tx
      .update(promptCompilations)
      .set({ userId: targetUserId })
      .where(storyScope(promptCompilations.storyId, promptCompilations.userId));
    await tx
      .update(promptCompilationHeads)
      .set({ userId: targetUserId })
      .where(
        storyScope(
          promptCompilationHeads.storyId,
          promptCompilationHeads.userId
        )
      );
    await tx
      .update(storyConversations)
      .set({ userId: targetUserId })
      .where(storyScope(storyConversations.storyId, storyConversations.userId));
    await tx
      .update(storyConversationMessages)
      .set({ userId: targetUserId })
      .where(
        storyScope(
          storyConversationMessages.storyId,
          storyConversationMessages.userId
        )
      );
    await tx
      .update(storyMessageReferences)
      .set({ userId: targetUserId })
      .where(
        storyScope(
          storyMessageReferences.storyId,
          storyMessageReferences.userId
        )
      );
    await tx
      .update(storyArtPromptBindings)
      .set({ userId: targetUserId })
      .where(
        storyScope(
          storyArtPromptBindings.storyId,
          storyArtPromptBindings.userId
        )
      );
    await tx
      .update(promptOperationReceipts)
      .set({ userId: targetUserId })
      .where(
        storyScope(
          promptOperationReceipts.storyId,
          promptOperationReceipts.userId
        )
      );
    await tx
      .update(stories)
      .set({ userId: targetUserId, projectId: targetProject.id })
      .where(
        and(eq(stories.userId, sourceUser.id), inArray(stories.id, storyIds))
      );
  });

  return {
    sourceUserId: sourceUser.id,
    targetUserId,
    targetProjectId: targetProject.id,
    migratedStoryIds: storyIds,
    migratedStoryCount: storyIds.length,
    reason: "claimed",
  };
}

export async function claimGuestStories(
  sourceUserId: number,
  targetUserId: number
): Promise<LegacyGuestClaimResult> {
  return claimLegacyGuestStories(targetUserId, sourceUserId);
}

// ─── Generated Images（手机端） ─────────────────────────────────────────
// 手机端聊天出图的图片记录查询。createGeneratedImage 统一定义在下方桌面端部分。

export async function getGeneratedImageById(
  id: number
): Promise<GeneratedImage | null> {
  const db = await getDb();
  if (!db) {
    return memoryState.generatedImages.find(img => img.id === id) ?? null;
  }
  const [row] = await db
    .select()
    .from(generatedImages)
    .where(eq(generatedImages.id, id));
  return row ?? null;
}

export async function getStoryImages(
  storyId: number
): Promise<GeneratedImage[]> {
  const db = await getDb();
  if (!db) {
    return memoryState.generatedImages
      .filter(img => img.storyId === storyId && img.isCurrent)
      .sort((a, b) => (a.shotNo ?? "").localeCompare(b.shotNo ?? ""));
  }
  return db
    .select()
    .from(generatedImages)
    .where(
      and(
        eq(generatedImages.storyId, storyId),
        eq(generatedImages.isCurrent, true)
      )
    )
    .orderBy(generatedImages.shotNo);
}

export async function getProjectGeneratedImages(
  projectId: number,
  userId: number
): Promise<GeneratedImage[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const storyIds = new Set(
      memoryState.stories
        .filter(
          story => story.projectId === projectId && story.userId === userId
        )
        .map(story => story.id)
    );
    return memoryState.generatedImages
      .filter(
        image =>
          (image.userId === userId || image.userId == null) &&
          (image.projectId === projectId ||
            (image.storyId != null && storyIds.has(image.storyId)))
      )
      .sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
      );
  }

  const projectStories = await db
    .select({ id: stories.id })
    .from(stories)
    .where(and(eq(stories.projectId, projectId), eq(stories.userId, userId)));
  const storyIds = projectStories.map(story => story.id);
  const ownership =
    storyIds.length > 0
      ? or(
          eq(generatedImages.projectId, projectId),
          inArray(generatedImages.storyId, storyIds)
        )
      : eq(generatedImages.projectId, projectId);

  return db
    .select()
    .from(generatedImages)
    .where(
      and(
        or(eq(generatedImages.userId, userId), isNull(generatedImages.userId)),
        ownership
      )
    )
    .orderBy(desc(generatedImages.createdAt));
}

// 按 storyId 取生成图片（故事为唯一单位）：每个故事的图片独立，故事间不共享。
// 带 userId 防越权。
export async function getStoryGeneratedImages(
  storyId: number,
  userId: number
): Promise<GeneratedImage[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return memoryState.generatedImages
      .filter(
        image =>
          image.storyId === storyId &&
          (image.userId === userId || image.userId == null)
      )
      .sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
      );
  }
  return db
    .select()
    .from(generatedImages)
    .where(
      and(
        eq(generatedImages.storyId, storyId),
        or(eq(generatedImages.userId, userId), isNull(generatedImages.userId))
      )
    )
    .orderBy(desc(generatedImages.createdAt));
}

export async function getGeneratedImageByStoryAndImageKey(
  storyId: number,
  userId: number,
  imageKey: string
): Promise<GeneratedImage | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return (
      memoryState.generatedImages.find(
        image =>
          image.storyId === storyId &&
          (image.userId === userId || image.userId == null) &&
          image.imageKey === imageKey
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(generatedImages)
    .where(
      and(
        eq(generatedImages.storyId, storyId),
        or(eq(generatedImages.userId, userId), isNull(generatedImages.userId)),
        eq(generatedImages.imageKey, imageKey)
      )
    )
    .limit(1);
  return row ?? null;
}

// ─── Image Signals ──────────────────────────────────────────────────────
// 用户交互信号（左划/右划/编辑等），时序事件流。

export async function createImageSignal(
  data: InsertImageSignal
): Promise<ImageSignal> {
  const db = await getDb();
  if (!db) {
    const current = now();
    const row: ImageSignal = {
      id: nextMemoryId("imageSignal"),
      userId: data.userId,
      storyId: data.storyId,
      imageId: data.imageId ?? null,
      action: data.action,
      metadata: data.metadata ?? null,
      createdAt: current,
    };
    memoryState.imageSignals.push(row);
    await persistMemoryState();
    return row;
  }
  const [result] = await db.insert(imageSignals).values(data);
  const [row] = await db
    .select()
    .from(imageSignals)
    .where(eq(imageSignals.id, result.insertId));
  return row;
}

/**
 * Promote a story image and persist the explicit selection as one operation.
 * Image and video selections are independent layers.
 */
export async function promoteStoryImageToCurrent(data: {
  imageId: number;
  storyId: number;
  userId: number;
  expectedCurrentImageId?: number;
  metadata?: InsertImageSignal["metadata"];
  /**
   * 明确采用上下文（U3）。**只能由 router 边界显式传入。**
   *
   * 这个函数同时被用户点击和内部派生路径（生成后自动置为当前、恢复、
   * 批量迁移）调用，所以不传就是不记采用。特别注意：不要从 `metadata.source`
   * 反推——那字段是给排查用的，把它当采用凭据就是把自动行为伪造成用户选择。
   *
   * 回调形式是因为采用经历要用权威 `imageSignals` 行 ID 做身份，
   * 而那个 ID 得等 signal 在同一事务里插出来才知道。
   */
  adoption?: (signalId: number) => PersonalMemoryCapture | null;
}): Promise<{ image: GeneratedImage; signal: ImageSignal } | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const image = memoryState.generatedImages.find(
      candidate =>
        candidate.id === data.imageId &&
        candidate.storyId === data.storyId &&
        (candidate.userId === data.userId || candidate.userId == null)
    );
    if (!image) return null;
    if (data.expectedCurrentImageId != null) {
      const expected = memoryState.generatedImages.find(
        candidate =>
          candidate.id === data.expectedCurrentImageId &&
          candidate.storyId === data.storyId &&
          (candidate.userId === data.userId || candidate.userId == null)
      );
      const sameIdentity =
        image.shotIdentity != null &&
        expected?.shotIdentity === image.shotIdentity;
      const sameLegacyShot =
        image.shotNo != null &&
        expected?.shotNo === image.shotNo &&
        (image.shotIdentity == null || expected?.shotIdentity == null);
      if (!expected?.isCurrent || (!sameIdentity && !sameLegacyShot))
        return null;
    }

    for (const candidate of memoryState.generatedImages) {
      if (candidate.storyId !== data.storyId || !candidate.isCurrent) continue;
      const sameIdentity =
        image.shotIdentity != null &&
        candidate.shotIdentity === image.shotIdentity;
      const sameLegacyShot =
        image.shotNo != null &&
        candidate.shotNo === image.shotNo &&
        (image.shotIdentity == null || candidate.shotIdentity == null);
      if (sameIdentity || sameLegacyShot) candidate.isCurrent = false;
    }
    image.isCurrent = true;

    const signal: ImageSignal = {
      id: nextMemoryId("imageSignal"),
      userId: data.userId,
      storyId: data.storyId,
      imageId: image.id,
      action: "swipe_right",
      metadata: data.metadata ?? null,
      createdAt: now(),
    };
    memoryState.imageSignals.push(signal);
    // 采用经历与 isCurrent 翻转、signal 一起进这一次 copy-on-write。
    // 图片与足迹索引同属 local-persist 聚合，所以不需要 outbox。
    const localAdoption = data.adoption?.(signal.id) ?? null;
    const previousPersonalMemory = localAdoption
      ? structuredClone(memoryState.personalMemory)
      : null;
    if (localAdoption) {
      applyPersonalMemoryCapture(memoryState.personalMemory, localAdoption);
    }
    try {
      await persistMemoryState();
    } catch (error) {
      // 落盘失败必须撤回这条采用经历。本函数其余内存态变更（isCurrent 翻转、
      // signal）沿用 db.ts 顶部记录的既有取舍——它们不回滚。但记忆层不能例外：
      // 留下一条「用户采用过」而实际没落盘的记录，会让来信去引用一个根本不存在
      // 的选择，事后也无从分辨真假。
      if (previousPersonalMemory) {
        memoryState.personalMemory = previousPersonalMemory;
      }
      throw error;
    }
    return { image, signal };
  }

  return db.transaction(async tx => {
    const [image] = await tx
      .select()
      .from(generatedImages)
      .where(
        and(
          eq(generatedImages.id, data.imageId),
          eq(generatedImages.storyId, data.storyId),
          or(
            eq(generatedImages.userId, data.userId),
            isNull(generatedImages.userId)
          )
        )
      )
      .limit(1);
    if (!image) return null;

    const shotGroup =
      image.shotIdentity != null
        ? image.shotNo != null
          ? or(
              eq(generatedImages.shotIdentity, image.shotIdentity),
              and(
                eq(generatedImages.shotNo, image.shotNo),
                isNull(generatedImages.shotIdentity)
              )
            )
          : eq(generatedImages.shotIdentity, image.shotIdentity)
        : image.shotNo != null
          ? eq(generatedImages.shotNo, image.shotNo)
          : eq(generatedImages.id, image.id);

    const lockedShotImages = await tx
      .select({ id: generatedImages.id })
      .from(generatedImages)
      .where(and(eq(generatedImages.storyId, data.storyId), shotGroup))
      .for("update");
    if (
      data.expectedCurrentImageId != null &&
      !lockedShotImages.some(row => row.id === data.expectedCurrentImageId)
    ) {
      return null;
    }
    if (data.expectedCurrentImageId != null) {
      const [expectedCurrent] = await tx
        .select({ id: generatedImages.id })
        .from(generatedImages)
        .where(
          and(
            eq(generatedImages.id, data.expectedCurrentImageId),
            eq(generatedImages.storyId, data.storyId),
            eq(generatedImages.isCurrent, true),
            shotGroup
          )
        )
        .limit(1);
      if (!expectedCurrent) return null;
    }
    await tx
      .update(generatedImages)
      .set({ isCurrent: false })
      .where(
        and(
          eq(generatedImages.storyId, data.storyId),
          shotGroup,
          eq(generatedImages.isCurrent, true)
        )
      );
    await tx
      .update(generatedImages)
      .set({ isCurrent: true })
      .where(eq(generatedImages.id, image.id));

    const [result] = await tx.insert(imageSignals).values({
      userId: data.userId,
      storyId: data.storyId,
      imageId: image.id,
      action: "swipe_right",
      metadata: data.metadata ?? null,
    });
    const [signal] = await tx
      .select()
      .from(imageSignals)
      .where(eq(imageSignals.id, result.insertId));
    // 采用经历与 isCurrent 翻转、signal 在同一个 SQL 事务里成立。
    const adoption = data.adoption?.(signal.id) ?? null;
    if (adoption) {
      await capturePersonalMemoryEvent({ mode: "mysql", tx }, adoption);
    }
    return { image: { ...image, isCurrent: true }, signal };
  });
}

export async function assignStoryImageToShot(data: {
  imageId: number;
  storyId: number;
  userId: number;
  shotNo: string;
  shotIdentity: string;
  metadata?: InsertImageSignal["metadata"];
}): Promise<{ image: GeneratedImage; signal: ImageSignal } | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const image = memoryState.generatedImages.find(
      candidate =>
        candidate.id === data.imageId &&
        candidate.storyId === data.storyId &&
        (candidate.userId === data.userId || candidate.userId == null)
    );
    if (!image) return null;

    for (const candidate of memoryState.generatedImages) {
      if (candidate.storyId !== data.storyId || !candidate.isCurrent) continue;
      const sameIdentity = candidate.shotIdentity === data.shotIdentity;
      const sameLegacyShot =
        candidate.shotNo === data.shotNo && candidate.shotIdentity == null;
      if (sameIdentity || sameLegacyShot) candidate.isCurrent = false;
    }
    image.shotNo = data.shotNo;
    image.shotIdentity = data.shotIdentity;
    image.isCurrent = true;

    const signal: ImageSignal = {
      id: nextMemoryId("imageSignal"),
      userId: data.userId,
      storyId: data.storyId,
      imageId: image.id,
      action: "swipe_right",
      metadata: data.metadata ?? null,
      createdAt: now(),
    };
    memoryState.imageSignals.push(signal);
    await persistMemoryState();
    return { image, signal };
  }

  return db.transaction(async tx => {
    const [image] = await tx
      .select()
      .from(generatedImages)
      .where(
        and(
          eq(generatedImages.id, data.imageId),
          eq(generatedImages.storyId, data.storyId),
          or(
            eq(generatedImages.userId, data.userId),
            isNull(generatedImages.userId)
          )
        )
      )
      .limit(1);
    if (!image) return null;

    const shotGroup = or(
      eq(generatedImages.shotIdentity, data.shotIdentity),
      and(
        eq(generatedImages.shotNo, data.shotNo),
        isNull(generatedImages.shotIdentity)
      )
    );
    await tx
      .select({ id: generatedImages.id })
      .from(generatedImages)
      .where(and(eq(generatedImages.storyId, data.storyId), shotGroup))
      .for("update");
    await tx
      .update(generatedImages)
      .set({ isCurrent: false })
      .where(
        and(
          eq(generatedImages.storyId, data.storyId),
          shotGroup,
          eq(generatedImages.isCurrent, true)
        )
      );
    await tx
      .update(generatedImages)
      .set({
        shotNo: data.shotNo,
        shotIdentity: data.shotIdentity,
        isCurrent: true,
      })
      .where(eq(generatedImages.id, image.id));

    const [result] = await tx.insert(imageSignals).values({
      userId: data.userId,
      storyId: data.storyId,
      imageId: image.id,
      action: "swipe_right",
      metadata: data.metadata ?? null,
    });
    const [signal] = await tx
      .select()
      .from(imageSignals)
      .where(eq(imageSignals.id, result.insertId));
    return {
      image: {
        ...image,
        shotNo: data.shotNo,
        shotIdentity: data.shotIdentity,
        isCurrent: true,
      },
      signal,
    };
  });
}

export async function getImageSignalsForImages(
  imageIds: number[]
): Promise<ImageSignal[]> {
  if (imageIds.length === 0) return [];
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const targetIds = new Set(imageIds);
    return memoryState.imageSignals
      .filter(signal => signal.imageId != null && targetIds.has(signal.imageId))
      .sort(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime()
      );
  }
  return db
    .select()
    .from(imageSignals)
    .where(inArray(imageSignals.imageId, imageIds))
    .orderBy(imageSignals.createdAt);
}

/**
 * 查询某个故事最近的 swipe_left 信号（用于矫正循环：拒绝的风格回流到 prompt）。
 * 返回最近 limit 条，按时间倒序。
 */
export async function getRecentRejectionSignals(
  storyId: number,
  limit = 10
): Promise<ImageSignal[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return memoryState.imageSignals
      .filter(s => s.storyId === storyId && s.action === "swipe_left")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
  return db
    .select()
    .from(imageSignals)
    .where(
      and(
        eq(imageSignals.storyId, storyId),
        eq(imageSignals.action, "swipe_left")
      )
    )
    .orderBy(desc(imageSignals.createdAt))
    .limit(limit);
}

export async function getRecentChatCorrections(
  projectId: number,
  limit = 10
): Promise<ImageSignal[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return memoryState.imageSignals
      .filter(s => {
        if (s.action !== "chat_correction") return false;
        const meta = s.metadata as Record<string, unknown> | null;
        return meta?.projectId === projectId;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
  // MySQL: chat_correction 信号的 projectId 存在 metadata JSON 里，用 JSON_EXTRACT 查询
  return db
    .select()
    .from(imageSignals)
    .where(
      and(
        eq(imageSignals.action, "chat_correction"),
        // @ts-explode — drizzle 不支持 JSON_EXTRACT，用 sql 模板
        sql`JSON_EXTRACT(${imageSignals.metadata}, '$.projectId') = ${projectId}`
      )
    )
    .orderBy(desc(imageSignals.createdAt))
    .limit(limit);
}

// ─── Edit Snapshots ──────────────────────────────────────────────────────

export async function createEditSnapshot(
  data: Omit<InsertEditSnapshot, "id" | "timestamp">
): Promise<EditSnapshot> {
  const db = await getDb();
  if (!db) {
    await ensureLocalEditSnapshotsLoaded();
    const id = nextMemoryId("editSnapshot");
    const snapshot: EditSnapshot = {
      id,
      projectId: data.projectId,
      sessionId: data.sessionId,
      state: data.state,
      previousSnapshotId: data.previousSnapshotId ?? null,
      diff: data.diff ?? null,
      timestamp: now(),
    };
    memoryState.editSnapshots.push(snapshot);
    // 每条快照都带完整 state，旧快照没有链式依赖（previousSnapshotId 只在写入时
    // 算 diff 用）。不修剪的话文件无限增长——2026-07-08 曾涨到 126MB，每次保存
    // 整体重写一遍，最终把进程写到 OOM。这里按项目只留最近 50 条。
    const KEEP_PER_PROJECT = 50;
    const projectSnapshots = memoryState.editSnapshots
      .filter(s => s.projectId === snapshot.projectId)
      .sort(
        (a, b) => b.timestamp.getTime() - a.timestamp.getTime() || b.id - a.id
      );
    if (projectSnapshots.length > KEEP_PER_PROJECT) {
      const dropIds = new Set(
        projectSnapshots.slice(KEEP_PER_PROJECT).map(s => s.id)
      );
      memoryState.editSnapshots = memoryState.editSnapshots.filter(
        s => !dropIds.has(s.id)
      );
    }
    await persistLocalEditSnapshots();
    return snapshot;
  }
  const [result] = await db.insert(editSnapshots).values(data);
  const [snapshot] = await db
    .select()
    .from(editSnapshots)
    .where(eq(editSnapshots.id, result.insertId));
  return snapshot;
}

export async function getLatestEditSnapshot(
  projectId: number
): Promise<EditSnapshot | null> {
  const db = await getDb();
  if (!db) {
    await ensureLocalEditSnapshotsLoaded();
    const projectSnapshots = memoryState.editSnapshots
      .filter(s => s.projectId === projectId)
      .sort((a, b) => {
        const tDiff = b.timestamp.getTime() - a.timestamp.getTime();
        return tDiff !== 0 ? tDiff : b.id - a.id; // id as tiebreaker for same-ms inserts
      });
    return projectSnapshots[0] ?? null;
  }
  const [snapshot] = await db
    .select()
    .from(editSnapshots)
    .where(eq(editSnapshots.projectId, projectId))
    .orderBy(desc(editSnapshots.timestamp))
    .limit(1);
  return snapshot ?? null;
}

/**
 * 按项目取最近 N 条快照（含 diff），供 `recurringEditSignal` 检测「反复修正」用。
 * 单条快照的 diff 只看得到相邻两次的变化，要判断「这个维度改了不止一次」
 * 必须看一段历史，不能只取最新一条。
 */
export async function getRecentEditSnapshots(
  projectId: number,
  limit = 50
): Promise<EditSnapshot[]> {
  const db = await getDb();
  if (!db) {
    await ensureLocalEditSnapshotsLoaded();
    return memoryState.editSnapshots
      .filter(s => s.projectId === projectId)
      .sort((a, b) => {
        const tDiff = b.timestamp.getTime() - a.timestamp.getTime();
        return tDiff !== 0 ? tDiff : b.id - a.id;
      })
      .slice(0, limit);
  }
  return db
    .select()
    .from(editSnapshots)
    .where(eq(editSnapshots.projectId, projectId))
    .orderBy(desc(editSnapshots.timestamp))
    .limit(limit);
}

export async function getEditSnapshotById(
  id: number
): Promise<EditSnapshot | null> {
  const db = await getDb();
  if (!db) {
    await ensureLocalEditSnapshotsLoaded();
    return memoryState.editSnapshots.find(s => s.id === id) ?? null;
  }
  const [snapshot] = await db
    .select()
    .from(editSnapshots)
    .where(eq(editSnapshots.id, id));
  return snapshot ?? null;
}

// ─── Semantic Annotations ────────────────────────────────────────────────

export async function createSemanticAnnotation(
  data: Omit<InsertSemanticAnnotation, "id" | "timestamp">
): Promise<SemanticAnnotation> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const id = nextMemoryId("semanticAnnotation");
    const annotation: SemanticAnnotation = {
      id,
      snapshotId: data.snapshotId,
      previousSnapshotId: data.previousSnapshotId ?? null,
      factualChanges: data.factualChanges,
      inferredPreferences: data.inferredPreferences,
      timestamp: now(),
      status: data.status ?? "active",
    };
    memoryState.semanticAnnotations.push(annotation);
    await persistMemoryState();
    return annotation;
  }
  const [result] = await db.insert(semanticAnnotations).values(data);
  const [annotation] = await db
    .select()
    .from(semanticAnnotations)
    .where(eq(semanticAnnotations.id, result.insertId));
  return annotation;
}

export async function getAnnotationsBySnapshotId(
  snapshotId: number
): Promise<SemanticAnnotation[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return memoryState.semanticAnnotations
      .filter(a => a.snapshotId === snapshotId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }
  return db
    .select()
    .from(semanticAnnotations)
    .where(eq(semanticAnnotations.snapshotId, snapshotId))
    .orderBy(desc(semanticAnnotations.timestamp));
}

export async function getRecentSemanticAnnotations(
  projectId: number,
  limit = 10
): Promise<SemanticAnnotation[]> {
  const db = await getDb();
  if (!db) {
    await ensureLocalEditSnapshotsLoaded();
    // Join with editSnapshots to filter by projectId
    const projectSnapshotIds = new Set(
      memoryState.editSnapshots
        .filter(s => s.projectId === projectId)
        .map(s => s.id)
    );
    return memoryState.semanticAnnotations
      .filter(a => projectSnapshotIds.has(a.snapshotId))
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }
  // Join with editSnapshots to filter by projectId
  return db
    .select({
      id: semanticAnnotations.id,
      snapshotId: semanticAnnotations.snapshotId,
      previousSnapshotId: semanticAnnotations.previousSnapshotId,
      factualChanges: semanticAnnotations.factualChanges,
      inferredPreferences: semanticAnnotations.inferredPreferences,
      timestamp: semanticAnnotations.timestamp,
      status: semanticAnnotations.status,
    })
    .from(semanticAnnotations)
    .innerJoin(
      editSnapshots,
      eq(semanticAnnotations.snapshotId, editSnapshots.id)
    )
    .where(eq(editSnapshots.projectId, projectId))
    .orderBy(desc(semanticAnnotations.timestamp))
    .limit(limit);
}

/**
 * 获取项目最近的编辑偏好注解（供 renderGate 使用）。
 * 直接用 getRecentSemanticAnnotations，这里只是按 projectId 过滤后的便捷封装。
 */
export async function getRecentEditPreferences(
  projectId: number,
  limit = 5
): Promise<SemanticAnnotation[]> {
  return getRecentSemanticAnnotations(projectId, limit);
}

type PromptAssetModality = "image" | "video";

async function resolvePromptCompilationIdForAsset(
  db: ReturnType<typeof drizzle> | null,
  input: {
    explicitPromptCompilationId?: number | null;
    storyId?: number | null;
    userId?: number | null;
    stableShotId?: string | null;
    modality: PromptAssetModality;
  }
): Promise<number | null> {
  if (input.explicitPromptCompilationId != null) {
    return input.explicitPromptCompilationId;
  }
  if (
    input.storyId == null ||
    input.userId == null ||
    input.stableShotId == null ||
    input.stableShotId.trim() === ""
  ) {
    return null;
  }
  if (!db) {
    await ensureLocalPromptLineageLoaded();
    return (
      memoryState.promptLineage.compilationHeads.find(
        head =>
          head.storyId === input.storyId &&
          head.userId === input.userId &&
          head.stableShotId === input.stableShotId &&
          head.modality === input.modality
      )?.currentCompilationId ?? null
    );
  }
  const [head] = await db
    .select({
      currentCompilationId: promptCompilationHeads.currentCompilationId,
    })
    .from(promptCompilationHeads)
    .where(
      and(
        eq(promptCompilationHeads.storyId, input.storyId),
        eq(promptCompilationHeads.userId, input.userId),
        eq(promptCompilationHeads.stableShotId, input.stableShotId),
        eq(promptCompilationHeads.modality, input.modality)
      )
    )
    .limit(1);
  return head?.currentCompilationId ?? null;
}

type TimelineFrameExtractionOwner = {
  storyId: number;
  userId: number;
  requestId: string;
};

type PreviewMaskedImageOperationOwner = {
  storyId: number;
  userId: number;
  operationToken: string;
};

const PREVIEW_MASKED_IMAGE_LEASE_MS = 15 * 60 * 1000;
const previewMaskedImageMemoryLock = createKeyedSerialLock<string>();
const PREVIEW_MASKED_IMAGE_PROTECTED_STATUSES: PreviewMaskedImageOperation["status"][] =
  ["claimed", "provider_accepted", "unknown", "succeeded"];

function memoryPreviewMaskedImageOperation(
  owner: PreviewMaskedImageOperationOwner
): PreviewMaskedImageOperation | null {
  return (
    memoryState.previewMaskedImageOperations.find(
      row =>
        row.storyId === owner.storyId &&
        row.userId === owner.userId &&
        row.operationToken === owner.operationToken
    ) ?? null
  );
}

function assertMatchingPreviewMaskedImageOperation(
  existing: PreviewMaskedImageOperation,
  input: {
    inputHash: string;
    sourceImageId: number;
    maskKey: string;
    targetKind: "shot-primary" | "timeline-image-clip";
    stableShotId: string;
    clipId?: string | null;
    quoteId: string;
  }
) {
  if (
    existing.inputHash !== input.inputHash ||
    existing.sourceImageId !== input.sourceImageId ||
    existing.maskKey !== input.maskKey ||
    existing.targetKind !== input.targetKind ||
    existing.stableShotId !== input.stableShotId ||
    existing.clipId !== (input.clipId ?? null) ||
    existing.quoteId !== input.quoteId
  ) {
    throw new Error("operationToken 已绑定另一组局部图片修改参数");
  }
}

export async function getPreviewMaskedImageOperation(
  owner: PreviewMaskedImageOperationOwner
): Promise<PreviewMaskedImageOperation | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return memoryPreviewMaskedImageOperation(owner);
  }
  const [row] = await db
    .select()
    .from(previewMaskedImageOperations)
    .where(
      and(
        eq(previewMaskedImageOperations.storyId, owner.storyId),
        eq(previewMaskedImageOperations.userId, owner.userId),
        eq(previewMaskedImageOperations.operationToken, owner.operationToken)
      )
    )
    .limit(1);
  return row ?? null;
}

/** The receipt is the authoritative binding between a generated candidate and
 * the exact Preview target it was paid to edit. */
export async function getSucceededPreviewMaskedImageOperationForCandidate(input: {
  storyId: number;
  userId: number;
  candidateImageId: number;
}): Promise<PreviewMaskedImageOperation | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return (
      memoryState.previewMaskedImageOperations.find(
        row =>
          row.storyId === input.storyId &&
          row.userId === input.userId &&
          row.candidateImageId === input.candidateImageId &&
          row.status === "succeeded"
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(previewMaskedImageOperations)
    .where(
      and(
        eq(previewMaskedImageOperations.storyId, input.storyId),
        eq(previewMaskedImageOperations.userId, input.userId),
        eq(
          previewMaskedImageOperations.candidateImageId,
          input.candidateImageId
        ),
        eq(previewMaskedImageOperations.status, "succeeded")
      )
    )
    .limit(1);
  return row ?? null;
}

/** Recover the newest paid result for an unchanged Preview target. This keeps
 * succeeded, unadopted candidates available across reloads without granting
 * them any automatic adoption authority. */
export async function getLatestSucceededPreviewMaskedImageOperationForTarget(input: {
  storyId: number;
  userId: number;
  sourceImageId: number;
  targetKind: "shot-primary" | "timeline-image-clip";
  stableShotId: string;
  clipId?: string | null;
}): Promise<PreviewMaskedImageOperation | null> {
  const matches = (row: PreviewMaskedImageOperation) =>
    row.storyId === input.storyId &&
    row.userId === input.userId &&
    row.sourceImageId === input.sourceImageId &&
    row.targetKind === input.targetKind &&
    row.stableShotId === input.stableShotId &&
    row.clipId === (input.clipId ?? null) &&
    row.status === "succeeded" &&
    row.candidateImageId != null;
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return (
      memoryState.previewMaskedImageOperations
        .filter(matches)
        .sort(
          (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()
        )[0] ?? null
    );
  }
  const conditions = [
    eq(previewMaskedImageOperations.storyId, input.storyId),
    eq(previewMaskedImageOperations.userId, input.userId),
    eq(previewMaskedImageOperations.sourceImageId, input.sourceImageId),
    eq(previewMaskedImageOperations.targetKind, input.targetKind),
    eq(previewMaskedImageOperations.stableShotId, input.stableShotId),
    eq(previewMaskedImageOperations.status, "succeeded"),
    isNotNull(previewMaskedImageOperations.candidateImageId),
    input.clipId == null
      ? isNull(previewMaskedImageOperations.clipId)
      : eq(previewMaskedImageOperations.clipId, input.clipId),
  ];
  const [row] = await db
    .select()
    .from(previewMaskedImageOperations)
    .where(and(...conditions))
    .orderBy(desc(previewMaskedImageOperations.updatedAt))
    .limit(1);
  return row ?? null;
}

/**
 * Durably fences one paid masked-edit submission. Existing receipts are never
 * automatically reacquired: a worker may have crossed the provider's billing
 * boundary before it crashed, even when no provider task id was returned.
 */
export async function claimPreviewMaskedImageOperation(
  input: PreviewMaskedImageOperationOwner & {
    inputHash: string;
    sourceImageId: number;
    maskKey: string;
    targetKind: "shot-primary" | "timeline-image-clip";
    stableShotId: string;
    clipId?: string | null;
    quoteId: string;
    currency: string;
    estimatedCny: number;
    quoteExpiresAt: Date;
  }
): Promise<{
  created: boolean;
  acquired: boolean;
  operation: PreviewMaskedImageOperation;
}> {
  const operationToken = input.operationToken.trim();
  if (!operationToken || operationToken.length > 160) {
    throw new Error("局部图片修改 operationToken 不合法");
  }
  const owner = { ...input, operationToken };
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return previewMaskedImageMemoryLock.run(String(input.userId), async () => {
      const existing = memoryPreviewMaskedImageOperation(owner);
      if (existing) {
        assertMatchingPreviewMaskedImageOperation(existing, input);
        return { created: false, acquired: false, operation: existing };
      }
      const protectedReplay = memoryState.previewMaskedImageOperations.find(
        row =>
          row.storyId === input.storyId &&
          row.userId === input.userId &&
          row.inputHash === input.inputHash &&
          PREVIEW_MASKED_IMAGE_PROTECTED_STATUSES.includes(row.status)
      );
      if (protectedReplay) {
        return { created: false, acquired: false, operation: protectedReplay };
      }
      const story = memoryState.stories.find(
        row => row.id === input.storyId && row.userId === input.userId
      );
      const source = memoryState.generatedImages.find(
        row =>
          row.id === input.sourceImageId &&
          row.storyId === input.storyId &&
          row.userId === input.userId
      );
      if (!story || !source) throw new Error("底图不存在或无权操作");
      const current = now();
      const operation: PreviewMaskedImageOperation = {
        id: nextMemoryId("previewMaskedImageOperation"),
        storyId: input.storyId,
        userId: input.userId,
        operationToken,
        inputHash: input.inputHash,
        sourceImageId: input.sourceImageId,
        maskKey: input.maskKey,
        targetKind: input.targetKind,
        stableShotId: input.stableShotId,
        clipId: input.clipId ?? null,
        quoteId: input.quoteId,
        currency: input.currency,
        estimatedCny: input.estimatedCny,
        quoteExpiresAt: input.quoteExpiresAt,
        claimToken: randomUUID(),
        leaseUntil: new Date(current.getTime() + PREVIEW_MASKED_IMAGE_LEASE_MS),
        attempt: 1,
        status: "claimed",
        providerTaskId: null,
        candidateImageId: null,
        errorCode: null,
        createdAt: current,
        updatedAt: current,
      };
      memoryState.previewMaskedImageOperations.push(operation);
      try {
        await persistMemoryState();
      } catch (error) {
        memoryState.previewMaskedImageOperations =
          memoryState.previewMaskedImageOperations.filter(
            row => row !== operation
          );
        throw error;
      }
      return { created: true, acquired: true, operation };
    });
  }
  return db.transaction(async tx => {
    const [story] = await tx
      .select({ id: stories.id })
      .from(stories)
      .where(
        and(eq(stories.id, input.storyId), eq(stories.userId, input.userId))
      )
      .for("update")
      .limit(1);
    if (!story) throw new Error("底图不存在或无权操作");
    const [existing] = await tx
      .select()
      .from(previewMaskedImageOperations)
      .where(
        and(
          eq(previewMaskedImageOperations.storyId, input.storyId),
          eq(previewMaskedImageOperations.userId, input.userId),
          eq(previewMaskedImageOperations.operationToken, operationToken)
        )
      )
      .for("update")
      .limit(1);
    if (existing) {
      assertMatchingPreviewMaskedImageOperation(existing, input);
      return { created: false, acquired: false, operation: existing };
    }
    const [protectedReplay] = await tx
      .select()
      .from(previewMaskedImageOperations)
      .where(
        and(
          eq(previewMaskedImageOperations.storyId, input.storyId),
          eq(previewMaskedImageOperations.userId, input.userId),
          eq(previewMaskedImageOperations.inputHash, input.inputHash),
          inArray(
            previewMaskedImageOperations.status,
            PREVIEW_MASKED_IMAGE_PROTECTED_STATUSES
          )
        )
      )
      .for("update")
      .limit(1);
    if (protectedReplay) {
      return { created: false, acquired: false, operation: protectedReplay };
    }
    const [source] = await tx
      .select({ id: generatedImages.id })
      .from(generatedImages)
      .where(
        and(
          eq(generatedImages.id, input.sourceImageId),
          eq(generatedImages.storyId, input.storyId),
          eq(generatedImages.userId, input.userId)
        )
      )
      .limit(1);
    if (!source) throw new Error("底图不存在或无权操作");
    const claimToken = randomUUID();
    await tx.insert(previewMaskedImageOperations).values({
      storyId: input.storyId,
      userId: input.userId,
      operationToken,
      inputHash: input.inputHash,
      sourceImageId: input.sourceImageId,
      maskKey: input.maskKey,
      targetKind: input.targetKind,
      stableShotId: input.stableShotId,
      clipId: input.clipId ?? null,
      quoteId: input.quoteId,
      currency: input.currency,
      estimatedCny: input.estimatedCny,
      quoteExpiresAt: input.quoteExpiresAt,
      claimToken,
      leaseUntil: new Date(Date.now() + PREVIEW_MASKED_IMAGE_LEASE_MS),
      attempt: 1,
      status: "claimed",
    });
    const [operation] = await tx
      .select()
      .from(previewMaskedImageOperations)
      .where(
        and(
          eq(previewMaskedImageOperations.storyId, input.storyId),
          eq(previewMaskedImageOperations.userId, input.userId),
          eq(previewMaskedImageOperations.operationToken, operationToken)
        )
      )
      .limit(1);
    if (!operation) throw new Error("局部图片修改 claim 后无法读取");
    return { created: true, acquired: true, operation };
  });
}

export async function markPreviewMaskedImageOperationAccepted(
  input: PreviewMaskedImageOperationOwner & {
    claimToken: string;
    providerTaskId: string;
  }
): Promise<PreviewMaskedImageOperation | null> {
  const apply = async (
    current: PreviewMaskedImageOperation,
    persist: () => Promise<void>
  ) => {
    if (
      current.claimToken !== input.claimToken ||
      current.status !== "claimed"
    ) {
      throw new Error("局部图片修改 claim 已失效");
    }
    current.status = "provider_accepted";
    current.providerTaskId = input.providerTaskId;
    current.updatedAt = now();
    await persist();
    return current;
  };
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return previewMaskedImageMemoryLock.run(String(input.userId), async () => {
      const current = memoryPreviewMaskedImageOperation(input);
      if (!current) return null;
      const before = { ...current };
      try {
        return await apply(current, persistMemoryState);
      } catch (error) {
        Object.assign(current, before);
        throw error;
      }
    });
  }
  return db.transaction(async tx => {
    const [current] = await tx
      .select()
      .from(previewMaskedImageOperations)
      .where(
        and(
          eq(previewMaskedImageOperations.storyId, input.storyId),
          eq(previewMaskedImageOperations.userId, input.userId),
          eq(previewMaskedImageOperations.operationToken, input.operationToken)
        )
      )
      .for("update")
      .limit(1);
    if (!current) return null;
    return apply(current, async () => {
      await tx
        .update(previewMaskedImageOperations)
        .set({
          status: "provider_accepted",
          providerTaskId: input.providerTaskId,
        })
        .where(eq(previewMaskedImageOperations.id, current.id));
    });
  });
}

export async function failPreviewMaskedImageOperation(
  input: PreviewMaskedImageOperationOwner & {
    claimToken: string;
    errorCode: string;
    providerTaskId?: string;
    submissionUncertain?: boolean;
  }
): Promise<PreviewMaskedImageOperation | null> {
  const status =
    input.submissionUncertain || input.providerTaskId ? "unknown" : "failed";
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return previewMaskedImageMemoryLock.run(String(input.userId), async () => {
      const current = memoryPreviewMaskedImageOperation(input);
      if (!current) return null;
      if (
        current.claimToken !== input.claimToken ||
        current.status === "succeeded"
      ) {
        throw new Error("局部图片修改 claim 已失效");
      }
      const before = { ...current };
      current.status = status;
      current.providerTaskId = input.providerTaskId ?? current.providerTaskId;
      current.errorCode = input.errorCode.slice(0, 128);
      current.updatedAt = now();
      try {
        await persistMemoryState();
      } catch (error) {
        Object.assign(current, before);
        throw error;
      }
      return current;
    });
  }
  return db.transaction(async tx => {
    const [current] = await tx
      .select()
      .from(previewMaskedImageOperations)
      .where(
        and(
          eq(previewMaskedImageOperations.storyId, input.storyId),
          eq(previewMaskedImageOperations.userId, input.userId),
          eq(previewMaskedImageOperations.operationToken, input.operationToken)
        )
      )
      .for("update")
      .limit(1);
    if (!current) return null;
    if (
      current.claimToken !== input.claimToken ||
      current.status === "succeeded"
    ) {
      throw new Error("局部图片修改 claim 已失效");
    }
    await tx
      .update(previewMaskedImageOperations)
      .set({
        status,
        providerTaskId: input.providerTaskId ?? current.providerTaskId,
        errorCode: input.errorCode.slice(0, 128),
      })
      .where(eq(previewMaskedImageOperations.id, current.id));
    return { ...current, status, errorCode: input.errorCode.slice(0, 128) };
  });
}

export async function settlePreviewMaskedImageOperationSuccess(
  input: PreviewMaskedImageOperationOwner & {
    claimToken: string;
    image: Omit<InsertGeneratedImage, "id" | "createdAt">;
  }
): Promise<{
  operation: PreviewMaskedImageOperation;
  image: GeneratedImage;
}> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return previewMaskedImageMemoryLock.run(String(input.userId), async () => {
      const operation = memoryPreviewMaskedImageOperation(input);
      if (!operation) throw new Error("局部图片修改操作不存在");
      if (operation.candidateImageId != null) {
        const replay = memoryState.generatedImages.find(
          image => image.id === operation.candidateImageId
        );
        if (!replay) throw new Error("局部图片修改候选不存在");
        return { operation, image: replay };
      }
      if (
        operation.claimToken !== input.claimToken ||
        !["claimed", "provider_accepted"].includes(operation.status)
      ) {
        throw new Error("局部图片修改 claim 已失效");
      }
      if (
        input.image.storyId !== input.storyId ||
        input.image.userId !== input.userId ||
        input.image.parentImageId !== operation.sourceImageId ||
        input.image.maskKey !== operation.maskKey ||
        input.image.isCurrent !== false
      ) {
        throw new Error("局部图片修改候选归属不一致");
      }
      const image: GeneratedImage = {
        id: nextMemoryId("generatedImage"),
        projectId: input.image.projectId ?? null,
        storyId: input.image.storyId ?? null,
        userId: input.image.userId ?? null,
        shotNo: input.image.shotNo ?? null,
        shotIdentity: input.image.shotIdentity ?? null,
        imageKey: input.image.imageKey ?? null,
        imageUrl: input.image.imageUrl,
        prompt: input.image.prompt ?? null,
        promptCompilationId: input.image.promptCompilationId ?? null,
        parentImageId: input.image.parentImageId ?? null,
        isCurrent: false,
        generationType: input.image.generationType ?? "inpaint",
        maskKey: input.image.maskKey ?? null,
        createdAt: now(),
      };
      const beforeOperation = { ...operation };
      memoryState.generatedImages.push(image);
      operation.status = "succeeded";
      operation.candidateImageId = image.id;
      operation.errorCode = null;
      operation.updatedAt = now();
      try {
        await persistMemoryState();
      } catch (error) {
        memoryState.generatedImages = memoryState.generatedImages.filter(
          row => row !== image
        );
        Object.assign(operation, beforeOperation);
        throw error;
      }
      return { operation, image };
    });
  }
  return db.transaction(async tx => {
    const [operation] = await tx
      .select()
      .from(previewMaskedImageOperations)
      .where(
        and(
          eq(previewMaskedImageOperations.storyId, input.storyId),
          eq(previewMaskedImageOperations.userId, input.userId),
          eq(previewMaskedImageOperations.operationToken, input.operationToken)
        )
      )
      .for("update")
      .limit(1);
    if (!operation) throw new Error("局部图片修改操作不存在");
    if (operation.candidateImageId != null) {
      const [replay] = await tx
        .select()
        .from(generatedImages)
        .where(eq(generatedImages.id, operation.candidateImageId))
        .limit(1);
      if (!replay) throw new Error("局部图片修改候选不存在");
      return { operation, image: replay };
    }
    if (
      operation.claimToken !== input.claimToken ||
      !["claimed", "provider_accepted"].includes(operation.status) ||
      input.image.storyId !== input.storyId ||
      input.image.userId !== input.userId ||
      input.image.parentImageId !== operation.sourceImageId ||
      input.image.maskKey !== operation.maskKey ||
      input.image.isCurrent !== false
    ) {
      throw new Error("局部图片修改候选归属不一致或 claim 已失效");
    }
    const [result] = await tx.insert(generatedImages).values(input.image);
    await tx
      .update(previewMaskedImageOperations)
      .set({
        status: "succeeded",
        candidateImageId: result.insertId,
        errorCode: null,
      })
      .where(eq(previewMaskedImageOperations.id, operation.id));
    const [image] = await tx
      .select()
      .from(generatedImages)
      .where(eq(generatedImages.id, result.insertId))
      .limit(1);
    if (!image) throw new Error("局部图片修改候选保存后无法读取");
    return {
      operation: {
        ...operation,
        status: "succeeded",
        candidateImageId: image.id,
      },
      image,
    };
  });
}

const TIMELINE_FRAME_EXTRACTION_LEASE_MS = 10 * 60 * 1000;

function normalizedExtractionCoordinates(input: {
  timelineFrame: number;
  operationLayer: number;
}) {
  return {
    timelineFrame: Math.max(0, Math.round(input.timelineFrame)),
    operationLayer: Math.max(0, Math.round(input.operationLayer)),
  };
}

function assertMatchingExtractionClaim(
  existing: TimelineFrameExtractionOperation,
  input: { inputHash: string; timelineFrame: number; operationLayer: number }
) {
  const normalized = normalizedExtractionCoordinates(input);
  if (
    existing.inputHash !== input.inputHash ||
    existing.timelineFrame !== normalized.timelineFrame ||
    existing.operationLayer !== normalized.operationLayer
  ) {
    throw new Error("抽帧 requestId 已用于不同输入（claim conflict）");
  }
}

function assertActiveExtractionClaim(
  current: TimelineFrameExtractionOperation,
  claimToken: string
) {
  if (
    current.claimToken !== claimToken ||
    current.leaseUntil.getTime() <= Date.now()
  ) {
    throw new Error("抽帧 claim 已失效");
  }
}

function extractionResultMatches(
  current: TimelineFrameExtractionOperation,
  result: { clipId: string; timelineVersion: number }
) {
  return (
    current.clipId === result.clipId &&
    current.timelineVersion === result.timelineVersion
  );
}

function extractionDescriptorMatches(
  current: TimelineFrameExtractionOperation,
  value: { winnerIdentity: string; descriptor: unknown }
) {
  return (
    current.winnerIdentity === value.winnerIdentity &&
    canonicalJsonStringify(current.descriptor) ===
      canonicalJsonStringify(value.descriptor)
  );
}

const timelineFrameExtractionMemoryLock = createKeyedSerialLock<string>();

export const TIMELINE_FRAME_EXTRACTION_DAILY_RECEIPT_LIMIT = 240;
export const TIMELINE_FRAME_EXTRACTION_USER_RECEIPT_LIMIT = 5_000;
export const TIMELINE_FRAME_EXTRACTION_STORY_RECEIPT_LIMIT = 2_000;
export function assertTimelineFrameExtractionReceiptQuota(input: {
  last24Hours: number;
  userTotal: number;
  storyTotal: number;
}): void {
  if (
    input.last24Hours >= TIMELINE_FRAME_EXTRACTION_DAILY_RECEIPT_LIMIT ||
    input.userTotal >= TIMELINE_FRAME_EXTRACTION_USER_RECEIPT_LIMIT ||
    input.storyTotal >= TIMELINE_FRAME_EXTRACTION_STORY_RECEIPT_LIMIT
  ) {
    throw new Error(TIMELINE_FRAME_EXTRACTION_QUOTA_ERROR);
  }
}

async function withTimelineFrameExtractionMemoryLock<T>(
  owner: TimelineFrameExtractionOwner,
  run: () => Promise<T>
): Promise<T> {
  // All extraction writes for one user share a lock. Besides making receipt
  // quota checks atomic, this makes imageKey lookup+insert mutually exclusive
  // across different request ids and Stories in local-persist mode.
  const key = String(owner.userId);
  return timelineFrameExtractionMemoryLock.run(key, run);
}

function memoryTimelineFrameExtractionOperation(
  owner: TimelineFrameExtractionOwner
): TimelineFrameExtractionOperation | null {
  return (
    memoryState.timelineFrameExtractionOperations.find(
      row =>
        row.storyId === owner.storyId &&
        row.userId === owner.userId &&
        row.requestId === owner.requestId
    ) ?? null
  );
}

export async function getTimelineFrameExtractionOperation(
  owner: TimelineFrameExtractionOwner
): Promise<TimelineFrameExtractionOperation | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return memoryTimelineFrameExtractionOperation(owner);
  }
  const [row] = await db
    .select()
    .from(timelineFrameExtractionOperations)
    .where(
      and(
        eq(timelineFrameExtractionOperations.storyId, owner.storyId),
        eq(timelineFrameExtractionOperations.userId, owner.userId),
        eq(timelineFrameExtractionOperations.requestId, owner.requestId)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function claimTimelineFrameExtractionOperation(
  input: TimelineFrameExtractionOwner & {
    inputHash: string;
    timelineFrame: number;
    operationLayer: number;
  }
): Promise<{
  created: boolean;
  acquired: boolean;
  operation: TimelineFrameExtractionOperation;
}> {
  const requestId = input.requestId.trim();
  if (!requestId || requestId.length > 160)
    throw new Error("抽帧 requestId 不合法");
  const owner = { ...input, requestId };
  const coordinates = normalizedExtractionCoordinates(input);
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return withTimelineFrameExtractionMemoryLock(owner, async () => {
      const existing = memoryTimelineFrameExtractionOperation(owner);
      if (existing) {
        assertMatchingExtractionClaim(existing, input);
        if (
          existing.status !== "claimed" ||
          existing.leaseUntil.getTime() > Date.now()
        ) {
          return { created: false, acquired: false, operation: existing };
        }
        const before = { ...existing };
        existing.claimToken = randomUUID();
        existing.leaseUntil = new Date(
          Date.now() + TIMELINE_FRAME_EXTRACTION_LEASE_MS
        );
        existing.attempt += 1;
        existing.updatedAt = now();
        try {
          await persistMemoryState();
        } catch (error) {
          Object.assign(existing, before);
          throw error;
        }
        return { created: false, acquired: true, operation: existing };
      }
      const story = memoryState.stories.find(
        row => row.id === input.storyId && row.userId === input.userId
      );
      if (!story) throw new Error("Story 不存在或不属于当前用户");
      const current = now();
      const receiptRows = memoryState.timelineFrameExtractionOperations.filter(
        row => row.userId === input.userId
      );
      assertTimelineFrameExtractionReceiptQuota({
        last24Hours: receiptRows.filter(
          row => row.createdAt.getTime() >= current.getTime() - 86_400_000
        ).length,
        userTotal: receiptRows.length,
        storyTotal: receiptRows.filter(row => row.storyId === input.storyId)
          .length,
      });
      const operation: TimelineFrameExtractionOperation = {
        id: nextMemoryId("timelineFrameExtractionOperation"),
        storyId: input.storyId,
        userId: input.userId,
        requestId,
        inputHash: input.inputHash,
        ...coordinates,
        claimToken: randomUUID(),
        leaseUntil: new Date(
          current.getTime() + TIMELINE_FRAME_EXTRACTION_LEASE_MS
        ),
        attempt: 1,
        status: "claimed",
        winnerIdentity: null,
        descriptor: null,
        imageId: null,
        clipId: null,
        timelineVersion: null,
        errorCode: null,
        createdAt: current,
        updatedAt: current,
      };
      memoryState.timelineFrameExtractionOperations.push(operation);
      try {
        await persistMemoryState();
      } catch (error) {
        memoryState.timelineFrameExtractionOperations =
          memoryState.timelineFrameExtractionOperations.filter(
            row => row !== operation
          );
        throw error;
      }
      return { created: true, acquired: true, operation };
    });
  }
  return db.transaction(async tx => {
    // Fixed lock order for every claim/asset transaction: user -> Story ->
    // receipt. The user row serializes quota checks and cross-request asset
    // deduplication without requiring a schema migration.
    const [lockedUser] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, input.userId))
      .for("update")
      .limit(1);
    if (!lockedUser) throw new Error("Story 不存在或不属于当前用户");
    const [story] = await tx
      .select({ id: stories.id })
      .from(stories)
      .where(
        and(eq(stories.id, input.storyId), eq(stories.userId, input.userId))
      )
      .for("update")
      .limit(1);
    if (!story) throw new Error("Story 不存在或不属于当前用户");
    const [existing] = await tx
      .select()
      .from(timelineFrameExtractionOperations)
      .where(
        and(
          eq(timelineFrameExtractionOperations.storyId, input.storyId),
          eq(timelineFrameExtractionOperations.userId, input.userId),
          eq(timelineFrameExtractionOperations.requestId, requestId)
        )
      )
      .for("update")
      .limit(1);
    const claimToken = randomUUID();
    const leaseUntil = new Date(
      Date.now() + TIMELINE_FRAME_EXTRACTION_LEASE_MS
    );
    if (existing) {
      assertMatchingExtractionClaim(existing, input);
      if (
        existing.status !== "claimed" ||
        existing.leaseUntil.getTime() > Date.now()
      ) {
        return { created: false, acquired: false, operation: existing };
      }
      await tx
        .update(timelineFrameExtractionOperations)
        .set({
          claimToken,
          leaseUntil,
          attempt: existing.attempt + 1,
        })
        .where(eq(timelineFrameExtractionOperations.id, existing.id));
      const [reclaimed] = await tx
        .select()
        .from(timelineFrameExtractionOperations)
        .where(eq(timelineFrameExtractionOperations.id, existing.id))
        .limit(1);
      return { created: false, acquired: true, operation: reclaimed };
    }

    const cutoff = new Date(Date.now() - 86_400_000);
    const [dailyCount] = await tx
      .select({ value: sql<number>`count(*)` })
      .from(timelineFrameExtractionOperations)
      .where(
        and(
          eq(timelineFrameExtractionOperations.userId, input.userId),
          gte(timelineFrameExtractionOperations.createdAt, cutoff)
        )
      );
    const [userCount] = await tx
      .select({ value: sql<number>`count(*)` })
      .from(timelineFrameExtractionOperations)
      .where(eq(timelineFrameExtractionOperations.userId, input.userId));
    const [storyCount] = await tx
      .select({ value: sql<number>`count(*)` })
      .from(timelineFrameExtractionOperations)
      .where(
        and(
          eq(timelineFrameExtractionOperations.userId, input.userId),
          eq(timelineFrameExtractionOperations.storyId, input.storyId)
        )
      );
    assertTimelineFrameExtractionReceiptQuota({
      last24Hours: Number(dailyCount?.value ?? 0),
      userTotal: Number(userCount?.value ?? 0),
      storyTotal: Number(storyCount?.value ?? 0),
    });

    await tx.insert(timelineFrameExtractionOperations).values({
      storyId: input.storyId,
      userId: input.userId,
      requestId,
      inputHash: input.inputHash,
      ...coordinates,
      claimToken,
      leaseUntil,
      attempt: 1,
      status: "claimed",
    });
    const [operation] = await tx
      .select()
      .from(timelineFrameExtractionOperations)
      .where(
        and(
          eq(timelineFrameExtractionOperations.storyId, input.storyId),
          eq(timelineFrameExtractionOperations.userId, input.userId),
          eq(timelineFrameExtractionOperations.requestId, requestId)
        )
      )
      .for("update")
      .limit(1);
    if (!operation) throw new Error("抽帧操作 claim 后无法读取");
    return { created: true, acquired: true, operation };
  });
}

export async function renewTimelineFrameExtractionClaim(
  input: TimelineFrameExtractionOwner & { claimToken: string }
): Promise<TimelineFrameExtractionOperation | null> {
  const renew = async (
    current: TimelineFrameExtractionOperation,
    persist: (leaseUntil: Date) => Promise<void>
  ) => {
    if (current.status !== "claimed" || current.claimToken !== input.claimToken)
      return null;
    const previousLeaseUntil = current.leaseUntil;
    const leaseUntil = new Date(
      Date.now() + TIMELINE_FRAME_EXTRACTION_LEASE_MS
    );
    current.leaseUntil = leaseUntil;
    try {
      await persist(leaseUntil);
    } catch (error) {
      current.leaseUntil = previousLeaseUntil;
      throw error;
    }
    return current;
  };
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return withTimelineFrameExtractionMemoryLock(input, async () => {
      const current = memoryTimelineFrameExtractionOperation(input);
      if (!current) return null;
      return renew(current, async () => {
        current.updatedAt = now();
        await persistMemoryState();
      });
    });
  }
  return db.transaction(async tx => {
    const [current] = await tx
      .select()
      .from(timelineFrameExtractionOperations)
      .where(
        and(
          eq(timelineFrameExtractionOperations.storyId, input.storyId),
          eq(timelineFrameExtractionOperations.userId, input.userId),
          eq(timelineFrameExtractionOperations.requestId, input.requestId)
        )
      )
      .for("update")
      .limit(1);
    if (!current) return null;
    return renew(current, leaseUntil =>
      tx
        .update(timelineFrameExtractionOperations)
        .set({ leaseUntil })
        .where(
          and(
            eq(timelineFrameExtractionOperations.id, current.id),
            eq(timelineFrameExtractionOperations.claimToken, input.claimToken),
            eq(timelineFrameExtractionOperations.status, "claimed")
          )
        )
        .then(() => undefined)
    );
  });
}

export async function recordTimelineFrameExtractionDescriptor(
  input: TimelineFrameExtractionOwner & {
    claimToken: string;
    winnerIdentity: string;
    descriptor: unknown;
  }
): Promise<TimelineFrameExtractionOperation | null> {
  const apply = async (
    current: TimelineFrameExtractionOperation,
    persist: () => Promise<void>
  ) => {
    if (current.status !== "claimed")
      throw new Error("只有 claimed 操作可以记录 descriptor");
    assertActiveExtractionClaim(current, input.claimToken);
    if (current.descriptor != null) {
      if (!extractionDescriptorMatches(current, input))
        throw new Error("抽帧 descriptor conflict");
      return current;
    }
    current.winnerIdentity = input.winnerIdentity;
    current.descriptor = input.descriptor;
    await persist();
    return current;
  };
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return withTimelineFrameExtractionMemoryLock(input, async () => {
      const current = memoryTimelineFrameExtractionOperation(input);
      if (!current) return null;
      const before = { ...current };
      return apply(current, async () => {
        current.updatedAt = now();
        try {
          await persistMemoryState();
        } catch (error) {
          Object.assign(current, before);
          throw error;
        }
      });
    });
  }
  return db.transaction(async tx => {
    const [current] = await tx
      .select()
      .from(timelineFrameExtractionOperations)
      .where(
        and(
          eq(timelineFrameExtractionOperations.storyId, input.storyId),
          eq(timelineFrameExtractionOperations.userId, input.userId),
          eq(timelineFrameExtractionOperations.requestId, input.requestId)
        )
      )
      .for("update")
      .limit(1);
    if (!current) return null;
    return apply(current, async () => {
      await tx
        .update(timelineFrameExtractionOperations)
        .set({
          winnerIdentity: input.winnerIdentity,
          descriptor: input.descriptor,
        })
        .where(eq(timelineFrameExtractionOperations.id, current.id));
    });
  });
}

export async function releaseTimelineFrameExtractionClaim(
  input: TimelineFrameExtractionOwner & { claimToken: string }
): Promise<TimelineFrameExtractionOperation | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return withTimelineFrameExtractionMemoryLock(input, async () => {
      const current = memoryTimelineFrameExtractionOperation(input);
      if (!current) return null;
      if (current.status !== "claimed") return current;
      if (current.claimToken !== input.claimToken)
        throw new Error("抽帧 claim 已失效");
      const before = { ...current };
      const releasedAt = now();
      current.leaseUntil = releasedAt;
      current.updatedAt = releasedAt;
      try {
        await persistMemoryState();
      } catch (error) {
        Object.assign(current, before);
        throw error;
      }
      return current;
    });
  }
  return db.transaction(async tx => {
    const [current] = await tx
      .select()
      .from(timelineFrameExtractionOperations)
      .where(
        and(
          eq(timelineFrameExtractionOperations.storyId, input.storyId),
          eq(timelineFrameExtractionOperations.userId, input.userId),
          eq(timelineFrameExtractionOperations.requestId, input.requestId)
        )
      )
      .for("update")
      .limit(1);
    if (!current) return null;
    if (current.status !== "claimed") return current;
    if (current.claimToken !== input.claimToken)
      throw new Error("抽帧 claim 已失效");
    const releasedAt = now();
    await tx
      .update(timelineFrameExtractionOperations)
      .set({ leaseUntil: releasedAt })
      .where(eq(timelineFrameExtractionOperations.id, current.id));
    const [released] = await tx
      .select()
      .from(timelineFrameExtractionOperations)
      .where(eq(timelineFrameExtractionOperations.id, current.id))
      .limit(1);
    return released;
  });
}

export async function failTimelineFrameExtractionOperation(
  input: TimelineFrameExtractionOwner & {
    claimToken: string;
    errorCode: string;
  }
): Promise<TimelineFrameExtractionOperation | null> {
  const errorCode = input.errorCode.slice(0, 128);
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return withTimelineFrameExtractionMemoryLock(input, async () => {
      const current = memoryTimelineFrameExtractionOperation(input);
      if (!current) return null;
      if (current.status !== "claimed")
        throw new Error("只有 claimed 操作可以标记失败");
      assertActiveExtractionClaim(current, input.claimToken);
      const before = { ...current };
      current.status = "failed";
      current.errorCode = errorCode;
      current.updatedAt = now();
      try {
        await persistMemoryState();
      } catch (error) {
        Object.assign(current, before);
        throw error;
      }
      return current;
    });
  }
  return db.transaction(async tx => {
    const [current] = await tx
      .select()
      .from(timelineFrameExtractionOperations)
      .where(
        and(
          eq(timelineFrameExtractionOperations.storyId, input.storyId),
          eq(timelineFrameExtractionOperations.userId, input.userId),
          eq(timelineFrameExtractionOperations.requestId, input.requestId)
        )
      )
      .for("update")
      .limit(1);
    if (!current) return null;
    if (current.status !== "claimed")
      throw new Error("只有 claimed 操作可以标记失败");
    assertActiveExtractionClaim(current, input.claimToken);
    await tx
      .update(timelineFrameExtractionOperations)
      .set({ status: "failed", errorCode })
      .where(eq(timelineFrameExtractionOperations.id, current.id));
    return { ...current, status: "failed", errorCode };
  });
}

export async function settleTimelineFrameExtractionAsset(
  input: TimelineFrameExtractionOwner & {
    claimToken: string;
    existingImageId?: number;
    image?: Omit<InsertGeneratedImage, "id" | "createdAt" | "isCurrent">;
  }
): Promise<{
  operation: TimelineFrameExtractionOperation;
  image: GeneratedImage;
}> {
  if ((input.existingImageId == null) === (input.image == null)) {
    throw new Error("抽帧资产必须且只能提供 existingImageId 或 image");
  }
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return withTimelineFrameExtractionMemoryLock(input, async () => {
      const operation = memoryTimelineFrameExtractionOperation(input);
      if (!operation) throw new Error("抽帧操作不存在");
      if (operation.imageId != null) {
        if (operation.status !== "asset_ready")
          throw new Error("抽帧资产状态不一致");
        const replay = memoryState.generatedImages.find(
          row =>
            row.id === operation.imageId &&
            row.storyId === input.storyId &&
            (row.userId === input.userId || row.userId == null)
        );
        if (!replay) throw new Error("抽帧操作引用的图片不存在");
        return { operation, image: replay };
      }
      if (operation.status !== "claimed")
        throw new Error("只有 claimed 操作可以登记资产");
      assertActiveExtractionClaim(operation, input.claimToken);
      const beforeOperation = { ...operation };
      let image: GeneratedImage;
      let created = false;
      if (input.existingImageId != null) {
        const existing = memoryState.generatedImages.find(
          row =>
            row.id === input.existingImageId &&
            row.storyId === input.storyId &&
            (row.userId === input.userId || row.userId == null)
        );
        if (!existing) throw new Error("复用图片不存在或不属于当前 Story");
        image = existing;
      } else {
        const data = input.image!;
        if (data.storyId !== input.storyId || data.userId !== input.userId) {
          throw new Error("新图片归属与抽帧操作不一致");
        }
        const reusable =
          data.imageKey == null
            ? undefined
            : memoryState.generatedImages.find(
                row =>
                  row.storyId === input.storyId &&
                  (row.userId === input.userId || row.userId == null) &&
                  row.imageKey === data.imageKey
              );
        image = reusable ?? {
          id: nextMemoryId("generatedImage"),
          projectId: data.projectId ?? null,
          storyId: data.storyId ?? null,
          userId: data.userId ?? null,
          shotNo: data.shotNo ?? null,
          shotIdentity: data.shotIdentity ?? null,
          imageKey: data.imageKey ?? null,
          imageUrl: data.imageUrl,
          prompt: data.prompt ?? null,
          promptCompilationId: data.promptCompilationId ?? null,
          parentImageId: data.parentImageId ?? null,
          isCurrent: false,
          generationType: data.generationType ?? "initial",
          maskKey: data.maskKey ?? null,
          createdAt: now(),
        };
        if (!reusable) {
          memoryState.generatedImages.push(image);
          created = true;
        }
      }
      operation.imageId = image.id;
      operation.status = "asset_ready";
      operation.updatedAt = now();
      try {
        // Extracted warehouse registration is authoritative in generatedImages;
        // no imageSignal is emitted here because it cannot share this local atomic write safely.
        await persistMemoryState();
      } catch (error) {
        Object.assign(operation, beforeOperation);
        if (created)
          memoryState.generatedImages = memoryState.generatedImages.filter(
            row => row !== image
          );
        throw error;
      }
      return { operation, image };
    });
  }
  return db.transaction(async tx => {
    const [lockedUser] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, input.userId))
      .for("update")
      .limit(1);
    if (!lockedUser) throw new Error("抽帧操作不存在");
    const [lockedStory] = await tx
      .select({ id: stories.id })
      .from(stories)
      .where(
        and(eq(stories.id, input.storyId), eq(stories.userId, input.userId))
      )
      .for("update")
      .limit(1);
    if (!lockedStory) throw new Error("抽帧操作不存在");
    const [operation] = await tx
      .select()
      .from(timelineFrameExtractionOperations)
      .where(
        and(
          eq(timelineFrameExtractionOperations.storyId, input.storyId),
          eq(timelineFrameExtractionOperations.userId, input.userId),
          eq(timelineFrameExtractionOperations.requestId, input.requestId)
        )
      )
      .for("update")
      .limit(1);
    if (!operation) throw new Error("抽帧操作不存在");
    if (operation.imageId != null) {
      if (operation.status !== "asset_ready")
        throw new Error("抽帧资产状态不一致");
      const [replay] = await tx
        .select()
        .from(generatedImages)
        .where(
          and(
            eq(generatedImages.id, operation.imageId),
            eq(generatedImages.storyId, input.storyId),
            or(
              eq(generatedImages.userId, input.userId),
              isNull(generatedImages.userId)
            )
          )
        )
        .limit(1);
      if (!replay) throw new Error("抽帧操作引用的图片不存在");
      return { operation, image: replay };
    }
    if (operation.status !== "claimed")
      throw new Error("只有 claimed 操作可以登记资产");
    assertActiveExtractionClaim(operation, input.claimToken);
    let image: GeneratedImage | undefined;
    if (input.existingImageId != null) {
      [image] = await tx
        .select()
        .from(generatedImages)
        .where(
          and(
            eq(generatedImages.id, input.existingImageId),
            eq(generatedImages.storyId, input.storyId),
            or(
              eq(generatedImages.userId, input.userId),
              isNull(generatedImages.userId)
            )
          )
        )
        .limit(1);
      if (!image) throw new Error("复用图片不存在或不属于当前 Story");
    } else {
      const data = input.image!;
      if (data.storyId !== input.storyId || data.userId !== input.userId)
        throw new Error("新图片归属与抽帧操作不一致");
      if (data.imageKey != null) {
        [image] = await tx
          .select()
          .from(generatedImages)
          .where(
            and(
              eq(generatedImages.storyId, input.storyId),
              or(
                eq(generatedImages.userId, input.userId),
                isNull(generatedImages.userId)
              ),
              eq(generatedImages.imageKey, data.imageKey)
            )
          )
          .limit(1);
      }
      if (!image) {
        const [inserted] = await tx
          .insert(generatedImages)
          .values({ ...data, isCurrent: false });
        [image] = await tx
          .select()
          .from(generatedImages)
          .where(eq(generatedImages.id, inserted.insertId))
          .limit(1);
      }
      if (!image) throw new Error("抽帧图片创建后无法读取");
      // Do not call createGeneratedImage: its imageSignal is a second write outside this receipt transaction.
    }
    await tx
      .update(timelineFrameExtractionOperations)
      .set({
        imageId: image.id,
        status: "asset_ready",
        errorCode: null,
      })
      .where(eq(timelineFrameExtractionOperations.id, operation.id));
    const [settled] = await tx
      .select()
      .from(timelineFrameExtractionOperations)
      .where(eq(timelineFrameExtractionOperations.id, operation.id))
      .limit(1);
    return { operation: settled, image };
  });
}

export async function markTimelineFrameExtractionSucceeded(
  input: TimelineFrameExtractionOwner & {
    clipId: string;
    timelineVersion: number;
  }
): Promise<TimelineFrameExtractionOperation | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return withTimelineFrameExtractionMemoryLock(input, async () => {
      const current = memoryTimelineFrameExtractionOperation(input);
      if (!current) return null;
      if (current.status === "succeeded") {
        if (!extractionResultMatches(current, input))
          throw new Error("抽帧成功结果 conflict");
        return current;
      }
      if (current.status !== "asset_ready" || current.imageId == null)
        throw new Error("只有 asset_ready 操作可以标记成功");
      const before = { ...current };
      current.status = "succeeded";
      current.clipId = input.clipId;
      current.timelineVersion = input.timelineVersion;
      current.errorCode = null;
      current.updatedAt = now();
      try {
        await persistMemoryState();
      } catch (error) {
        Object.assign(current, before);
        throw error;
      }
      return current;
    });
  }
  return db.transaction(async tx => {
    const [current] = await tx
      .select()
      .from(timelineFrameExtractionOperations)
      .where(
        and(
          eq(timelineFrameExtractionOperations.storyId, input.storyId),
          eq(timelineFrameExtractionOperations.userId, input.userId),
          eq(timelineFrameExtractionOperations.requestId, input.requestId)
        )
      )
      .for("update")
      .limit(1);
    if (!current) return null;
    if (current.status === "succeeded") {
      if (!extractionResultMatches(current, input))
        throw new Error("抽帧成功结果 conflict");
      return current;
    }
    if (current.status !== "asset_ready" || current.imageId == null)
      throw new Error("只有 asset_ready 操作可以标记成功");
    await tx
      .update(timelineFrameExtractionOperations)
      .set({
        status: "succeeded",
        clipId: input.clipId,
        timelineVersion: input.timelineVersion,
        errorCode: null,
      })
      .where(eq(timelineFrameExtractionOperations.id, current.id));
    const [settled] = await tx
      .select()
      .from(timelineFrameExtractionOperations)
      .where(eq(timelineFrameExtractionOperations.id, current.id))
      .limit(1);
    return settled;
  });
}

// ─── Generated Images（统一） ────────────────────────────────────────────
// 桌面端通过 projectId+shotNo 关联，手机端通过 storyId+userId 关联。

export async function createGeneratedImage(
  data: Omit<InsertGeneratedImage, "id" | "createdAt">
): Promise<GeneratedImage> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const promptCompilationId = await resolvePromptCompilationIdForAsset(null, {
      explicitPromptCompilationId: data.promptCompilationId,
      storyId: data.storyId,
      userId: data.userId,
      stableShotId: data.shotIdentity,
      modality: "image",
    });
    // 把同一镜头的旧图标记为非当前；优先按稳定镜头身份，旧数据用 shotNo 兜底。
    if (
      data.isCurrent !== false &&
      (data.shotNo != null || data.shotIdentity != null)
    ) {
      for (const img of memoryState.generatedImages) {
        if (!img.isCurrent) continue;
        const sameDesktop = data.projectId && img.projectId === data.projectId;
        const sameMobile = data.storyId && img.storyId === data.storyId;
        const sameIdentity =
          data.shotIdentity != null && img.shotIdentity === data.shotIdentity;
        const sameLegacyShot =
          data.shotNo != null &&
          img.shotNo === data.shotNo &&
          (data.shotIdentity == null || img.shotIdentity == null);
        if ((sameDesktop || sameMobile) && (sameIdentity || sameLegacyShot)) {
          img.isCurrent = false;
        }
      }
    }
    const id = nextMemoryId("generatedImage");
    const image: GeneratedImage = {
      id,
      projectId: data.projectId ?? null,
      storyId: data.storyId ?? null,
      userId: data.userId ?? null,
      shotNo: data.shotNo ?? null,
      shotIdentity: data.shotIdentity ?? null,
      imageKey: data.imageKey ?? null,
      imageUrl: data.imageUrl,
      prompt: data.prompt ?? null,
      promptCompilationId,
      parentImageId: data.parentImageId ?? null,
      isCurrent: data.isCurrent ?? true,
      generationType: data.generationType ?? "generate",
      maskKey: data.maskKey ?? null,
      createdAt: now(),
    };
    memoryState.generatedImages.push(image);
    await persistMemoryState();
    if (image.userId != null) {
      await createImageSignal({
        userId: image.userId,
        storyId: image.storyId ?? 0,
        imageId: image.id,
        action: "edit_complete",
        metadata: {
          source: "generation",
          state: "pending",
          projectId: image.projectId,
        },
      });
    }
    return image;
  }
  // 把同一镜头的旧图标记为非当前；优先按稳定镜头身份，旧数据用 shotNo 兜底。
  if (
    data.isCurrent !== false &&
    (data.shotNo != null || data.shotIdentity != null)
  ) {
    const shotGroup =
      data.shotIdentity != null
        ? data.shotNo != null
          ? or(
              eq(generatedImages.shotIdentity, data.shotIdentity),
              and(
                eq(generatedImages.shotNo, data.shotNo),
                isNull(generatedImages.shotIdentity)
              )
            )
          : eq(generatedImages.shotIdentity, data.shotIdentity)
        : data.shotNo != null
          ? eq(generatedImages.shotNo, data.shotNo)
          : undefined;
    if (data.projectId) {
      await db
        .update(generatedImages)
        .set({ isCurrent: false })
        .where(
          and(
            eq(generatedImages.projectId, data.projectId),
            shotGroup,
            eq(generatedImages.isCurrent, true)
          )
        );
    } else if (data.storyId) {
      await db
        .update(generatedImages)
        .set({ isCurrent: false })
        .where(
          and(
            eq(generatedImages.storyId, data.storyId),
            shotGroup,
            eq(generatedImages.isCurrent, true)
          )
        );
    }
  }
  const promptCompilationId = await resolvePromptCompilationIdForAsset(db, {
    explicitPromptCompilationId: data.promptCompilationId,
    storyId: data.storyId,
    userId: data.userId,
    stableShotId: data.shotIdentity,
    modality: "image",
  });
  const [result] = await db.insert(generatedImages).values({
    ...data,
    promptCompilationId,
  });
  const [image] = await db
    .select()
    .from(generatedImages)
    .where(eq(generatedImages.id, result.insertId));
  if (image.userId != null) {
    await createImageSignal({
      userId: image.userId,
      storyId: image.storyId ?? 0,
      imageId: image.id,
      action: "edit_complete",
      metadata: {
        source: "generation",
        state: "pending",
        projectId: image.projectId,
      },
    });
  }
  return image;
}

export async function deleteGeneratedImage(
  imageId: number,
  userId: number
): Promise<void> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    if (
      memoryState.stories.some(
        story =>
          story.userId === userId &&
          finishedProductReferencesImage(story.body, imageId)
      )
    ) {
      throw new Error("该图片已被成品版本引用，不能删除");
    }
    memoryState.generatedImages = memoryState.generatedImages.filter(
      img => !(img.id === imageId && img.userId === userId)
    );
    memoryState.imageSignals = memoryState.imageSignals.filter(
      sig => sig.imageId !== imageId
    );
    await persistMemoryState();
    return;
  }
  const ownedStories = await db
    .select({ body: stories.body })
    .from(stories)
    .where(eq(stories.userId, userId));
  if (
    ownedStories.some(story =>
      finishedProductReferencesImage(story.body, imageId)
    )
  ) {
    throw new Error("该图片已被成品版本引用，不能删除");
  }
  await db.delete(imageSignals).where(eq(imageSignals.imageId, imageId));
  await db
    .delete(generatedImages)
    .where(
      and(eq(generatedImages.id, imageId), eq(generatedImages.userId, userId))
    );
}

function finishedProductReferencesImage(
  body: unknown,
  imageId: number
): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const finishedProduct = (body as Record<string, unknown>).finishedProduct;
  if (
    !finishedProduct ||
    typeof finishedProduct !== "object" ||
    Array.isArray(finishedProduct)
  ) {
    return false;
  }
  const versions = (finishedProduct as Record<string, unknown>).versions;
  if (!Array.isArray(versions)) return false;
  return versions.some(version => {
    if (!version || typeof version !== "object" || Array.isArray(version)) {
      return false;
    }
    const images = (version as Record<string, unknown>).images;
    return (
      Array.isArray(images) &&
      images.some(
        image =>
          image != null &&
          typeof image === "object" &&
          !Array.isArray(image) &&
          (image as Record<string, unknown>).imageId === imageId
      )
    );
  });
}

export async function updateImageCurrent(
  imageId: number,
  isCurrent: boolean
): Promise<void> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const img = memoryState.generatedImages.find(i => i.id === imageId);
    if (img) {
      img.isCurrent = isCurrent;
      await persistMemoryState();
    }
    return;
  }
  await db
    .update(generatedImages)
    .set({ isCurrent })
    .where(eq(generatedImages.id, imageId));
}

export async function reassignImage(
  imageId: number,
  newShotNo: string
): Promise<void> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const img = memoryState.generatedImages.find(i => i.id === imageId);
    if (!img) return;

    const oldShotNo = img.shotNo;
    const projectId = img.projectId;

    // Mark existing current images on the target shot as non-current
    for (const other of memoryState.generatedImages) {
      if (
        other.projectId === projectId &&
        other.shotNo === newShotNo &&
        other.isCurrent
      ) {
        other.isCurrent = false;
      }
    }

    // Move the image and make it current on the new shot
    img.shotNo = newShotNo;
    img.isCurrent = true;

    // Promote the most recent remaining image on the old shot
    const oldShotImages = memoryState.generatedImages
      .filter(
        i =>
          i.projectId === projectId &&
          i.shotNo === oldShotNo &&
          i.id !== imageId
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    if (oldShotImages.length > 0) {
      oldShotImages[0].isCurrent = true;
    }

    await persistMemoryState();
    return;
  }

  const [img] = await db
    .select()
    .from(generatedImages)
    .where(eq(generatedImages.id, imageId))
    .limit(1);
  if (!img) return;

  const oldShotNo = img.shotNo;
  const projectId = img.projectId;
  if (projectId == null || oldShotNo == null) return; // 没有 projectId/shotNo 的图片不支持重分配

  // 将目标镜号上的当前图片标记为非当前
  await db
    .update(generatedImages)
    .set({ isCurrent: false })
    .where(
      and(
        eq(generatedImages.projectId, projectId),
        eq(generatedImages.shotNo, newShotNo),
        eq(generatedImages.isCurrent, true)
      )
    );

  // 移动图片到新镜号并设为当前
  await db
    .update(generatedImages)
    .set({ shotNo: newShotNo, isCurrent: true })
    .where(eq(generatedImages.id, imageId));

  // 在旧镜号上提升最新的图片为当前
  const remaining = await db
    .select()
    .from(generatedImages)
    .where(
      and(
        eq(generatedImages.projectId, projectId),
        eq(generatedImages.shotNo, oldShotNo)
      )
    )
    .orderBy(desc(generatedImages.createdAt))
    .limit(1);
  if (remaining.length > 0) {
    await db
      .update(generatedImages)
      .set({ isCurrent: true })
      .where(eq(generatedImages.id, remaining[0].id));
  }
}

// ─── Video Takes（图生视频素材）────────────────────────────────────────

export async function createVideoTake(
  data: Omit<InsertVideoTake, "id" | "createdAt" | "updatedAt">
): Promise<VideoTake> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const promptCompilationId = await resolvePromptCompilationIdForAsset(null, {
      explicitPromptCompilationId: data.promptCompilationId,
      storyId: data.storyId,
      userId: data.userId,
      stableShotId: data.stableShotId,
      modality: "video",
    });
    const current = now();
    const row: VideoTake = {
      id: nextMemoryId("videoTake"),
      storyId: data.storyId,
      userId: data.userId,
      stableShotId: data.stableShotId,
      sourceImageId: data.sourceImageId ?? null,
      promptCompilationId,
      status: data.status ?? "submitted",
      taskId: data.taskId ?? null,
      provider: data.provider ?? "302",
      model: data.model,
      prompt: data.prompt,
      subtitle: data.subtitle ?? null,
      durationSec: data.durationSec ?? null,
      aspectRatio: data.aspectRatio ?? "16:9",
      videoKey: data.videoKey ?? null,
      videoUrl: data.videoUrl ?? null,
      errorMessage: data.errorMessage ?? null,
      parameterSnapshot: data.parameterSnapshot ?? null,
      idempotencyKey: data.idempotencyKey ?? null,
      extractionCapability: data.extractionCapability ?? "unavailable",
      createdAt: current,
      updatedAt: current,
    };
    memoryState.videoTakes.push(row);
    await persistMemoryState();
    return row;
  }
  const promptCompilationId = await resolvePromptCompilationIdForAsset(db, {
    explicitPromptCompilationId: data.promptCompilationId,
    storyId: data.storyId,
    userId: data.userId,
    stableShotId: data.stableShotId,
    modality: "video",
  });
  const [result] = await db.insert(videoTakes).values({
    ...data,
    promptCompilationId,
  });
  const [row] = await db
    .select()
    .from(videoTakes)
    .where(eq(videoTakes.id, result.insertId));
  return row;
}

export async function updateVideoTake(
  id: number,
  userId: number,
  data: Partial<Omit<InsertVideoTake, "id" | "createdAt" | "updatedAt">>
): Promise<VideoTake | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const row = memoryState.videoTakes.find(
      take => take.id === id && take.userId === userId
    );
    if (!row) return null;
    applyDefinedValues(
      row as unknown as Record<string, unknown>,
      data as unknown as Record<string, unknown>
    );
    row.updatedAt = now();
    await persistMemoryState();
    return row;
  }
  await db
    .update(videoTakes)
    .set(data)
    .where(and(eq(videoTakes.id, id), eq(videoTakes.userId, userId)));
  const [row] = await db
    .select()
    .from(videoTakes)
    .where(and(eq(videoTakes.id, id), eq(videoTakes.userId, userId)));
  return row ?? null;
}

export async function updateVideoTakeRangesShotIdentity(input: {
  takeId: number;
  storyId: number;
  userId: number;
  stableShotId: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    for (const range of memoryState.videoTakeRanges) {
      if (
        range.takeId === input.takeId &&
        range.storyId === input.storyId &&
        range.userId === input.userId
      ) {
        range.stableShotId = input.stableShotId;
        range.updatedAt = now();
      }
    }
    await persistMemoryState();
    return;
  }
  await db
    .update(videoTakeRanges)
    .set({ stableShotId: input.stableShotId })
    .where(
      and(
        eq(videoTakeRanges.takeId, input.takeId),
        eq(videoTakeRanges.storyId, input.storyId),
        eq(videoTakeRanges.userId, input.userId)
      )
    );
}

export async function getVideoTakeById(
  id: number,
  userId: number
): Promise<VideoTake | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return (
      memoryState.videoTakes.find(
        take => take.id === id && take.userId === userId
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(videoTakes)
    .where(and(eq(videoTakes.id, id), eq(videoTakes.userId, userId)));
  return row ?? null;
}

export async function getStoryVideoTakes(
  storyId: number,
  userId: number
): Promise<VideoTake[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return memoryState.videoTakes
      .filter(take => take.storyId === storyId && take.userId === userId)
      .sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
      );
  }
  return db
    .select()
    .from(videoTakes)
    .where(and(eq(videoTakes.storyId, storyId), eq(videoTakes.userId, userId)))
    .orderBy(desc(videoTakes.createdAt));
}

export async function getReusableVideoTakesForStory(
  storyId: number,
  userId: number
): Promise<VideoTake[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return memoryState.videoTakes
      .filter(
        take =>
          take.userId === userId &&
          take.storyId !== storyId &&
          take.status === "available" &&
          Boolean(take.videoUrl)
      )
      .sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
      );
  }
  return db
    .select()
    .from(videoTakes)
    .where(
      and(
        eq(videoTakes.userId, userId),
        ne(videoTakes.storyId, storyId),
        eq(videoTakes.status, "available"),
        isNotNull(videoTakes.videoUrl)
      )
    )
    .orderBy(desc(videoTakes.createdAt));
}

export async function findVideoTakeByIdempotencyKey(
  storyId: number,
  userId: number,
  idempotencyKey: string
): Promise<VideoTake | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return (
      memoryState.videoTakes
        .filter(
          take =>
            take.storyId === storyId &&
            take.userId === userId &&
            take.idempotencyKey === idempotencyKey
        )
        .sort((a, b) => b.id - a.id)[0] ?? null
    );
  }
  const [row] = await db
    .select()
    .from(videoTakes)
    .where(
      and(
        eq(videoTakes.storyId, storyId),
        eq(videoTakes.userId, userId),
        eq(videoTakes.idempotencyKey, idempotencyKey)
      )
    )
    .orderBy(desc(videoTakes.id))
    .limit(1);
  return row ?? null;
}

/**
 * 为付费任务预占幂等记录。MySQL 下先锁所属故事行，再查后插；这样即使是
 * 多个服务实例同时确认同一 candidate，也只能有一个调用方拿到 created=true。
 * 该入口只给已经锁定 promptCompilationId 的系统任务使用。
 */
export async function createVideoTakeIdempotently(
  data: Omit<InsertVideoTake, "id" | "createdAt" | "updatedAt"> & {
    idempotencyKey: string;
  }
): Promise<{ take: VideoTake; created: boolean }> {
  const db = await getDb();
  if (!db) {
    const existing = await findVideoTakeByIdempotencyKey(
      data.storyId,
      data.userId,
      data.idempotencyKey
    );
    if (existing) return { take: existing, created: false };
    return { take: await createVideoTake(data), created: true };
  }

  return db.transaction(async tx => {
    const [story] = await tx
      .select({ id: stories.id })
      .from(stories)
      .where(and(eq(stories.id, data.storyId), eq(stories.userId, data.userId)))
      .for("update")
      .limit(1);
    if (!story) throw new Error("故事不存在或无权操作");
    const [existing] = await tx
      .select()
      .from(videoTakes)
      .where(
        and(
          eq(videoTakes.storyId, data.storyId),
          eq(videoTakes.userId, data.userId),
          eq(videoTakes.idempotencyKey, data.idempotencyKey)
        )
      )
      .orderBy(desc(videoTakes.id))
      .limit(1);
    if (existing) return { take: existing, created: false };

    const [result] = await tx.insert(videoTakes).values({
      ...data,
      promptCompilationId: data.promptCompilationId ?? null,
    });
    const [take] = await tx
      .select()
      .from(videoTakes)
      .where(eq(videoTakes.id, result.insertId))
      .limit(1);
    if (!take) throw new Error("视频任务预占失败");
    return { take, created: true };
  });
}

type EditingTransitionSubmissionSlot = {
  candidateId: string;
  expectedTimelineVersion: number;
  sourceStableShotId: string;
  targetStableShotId: string;
  placementKey?: string;
};

export type EditingTransitionSubmissionClaim =
  | { claimed: true; take: VideoTake }
  | {
      claimed: false;
      take: VideoTake;
      reason: "already_claimed" | "slot_occupied";
      blockingTakeId?: number;
    };

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function editingTransitionSubmissionSlot(
  take: VideoTake
): EditingTransitionSubmissionSlot | null {
  const snapshot = jsonRecord(take.parameterSnapshot);
  if (snapshot.kind !== "editing-transition") return null;
  const candidate = jsonRecord(snapshot.candidate);
  const source = jsonRecord(candidate.source);
  const target = jsonRecord(candidate.target);
  const placement = jsonRecord(candidate.placement);
  if (
    typeof candidate.candidateId !== "string" ||
    candidate.storyId !== take.storyId ||
    typeof candidate.expectedTimelineVersion !== "number" ||
    typeof source.stableShotId !== "string" ||
    typeof target.stableShotId !== "string"
  ) {
    return null;
  }
  return {
    candidateId: candidate.candidateId,
    expectedTimelineVersion: candidate.expectedTimelineVersion,
    sourceStableShotId: source.stableShotId,
    targetStableShotId: target.stableShotId,
    ...(placement.kind === "timeline-overlay" &&
    typeof placement.startFrame === "number" &&
    typeof placement.targetEndFrame === "number" &&
    typeof placement.leftImageId === "number" &&
    typeof placement.rightImageId === "number"
      ? {
          placementKey: [
            placement.startFrame,
            placement.targetEndFrame,
            placement.leftImageId,
            placement.rightImageId,
          ].join(":"),
        }
      : {}),
  };
}

function sameEditingTransitionSlot(
  left: EditingTransitionSubmissionSlot,
  right: EditingTransitionSubmissionSlot
): boolean {
  if (left.placementKey || right.placementKey) {
    return Boolean(
      left.placementKey &&
        right.placementKey &&
        left.placementKey === right.placementKey
    );
  }
  return (
    left.expectedTimelineVersion === right.expectedTimelineVersion &&
    left.sourceStableShotId === right.sourceStableShotId &&
    left.targetStableShotId === right.targetStableShotId
  );
}

function hasEditingTransitionSubmissionClaim(take: VideoTake): boolean {
  const state = jsonRecord(take.parameterSnapshot).submissionState;
  return state !== "not_started" && state !== "not_submitted";
}

function claimedEditingTransitionTake(take: VideoTake): VideoTake {
  return {
    ...take,
    status: "submitted",
    errorMessage: null,
    parameterSnapshot: {
      ...jsonRecord(take.parameterSnapshot),
      submissionState: "submitting",
      submissionClaimedAt: new Date().toISOString(),
    },
    updatedAt: now(),
  };
}

async function withMemoryVideoTakeSubmissionClaim<T>(
  operation: () => Promise<T>
): Promise<T> {
  const previous = memoryVideoTakeSubmissionClaimQueue;
  let release: () => void = () => undefined;
  memoryVideoTakeSubmissionClaimQueue = new Promise<void>(resolve => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

/**
 * 原子取得一次付费提交权。MySQL 通过故事行锁把同故事的所有候选串行化，
 * 因而同 candidate 以及同 timeline/source/target 槽位都只能有一个 claimant。
 * 内存模式用同进程互斥执行相同的 compare-and-set。
 */
export async function claimEditingTransitionSubmission(input: {
  takeId: number;
  storyId: number;
  userId: number;
}): Promise<EditingTransitionSubmissionClaim> {
  const decide = (takes: VideoTake[]) => {
    const take = takes.find(item => item.id === input.takeId);
    if (!take) throw new Error("衔接视频任务不存在或无权操作");
    const slot = editingTransitionSubmissionSlot(take);
    if (!slot) throw new Error("衔接视频任务缺少可验证的候选快照");
    if (hasEditingTransitionSubmissionClaim(take)) {
      return {
        claimed: false as const,
        take,
        reason: "already_claimed" as const,
      };
    }
    const blocker = takes.find(other => {
      if (other.id === take.id || !hasEditingTransitionSubmissionClaim(other)) {
        return false;
      }
      const otherSlot = editingTransitionSubmissionSlot(other);
      return Boolean(otherSlot && sameEditingTransitionSlot(slot, otherSlot));
    });
    if (blocker) {
      return {
        claimed: false as const,
        take,
        reason: "slot_occupied" as const,
        blockingTakeId: blocker.id,
      };
    }
    return { claimed: true as const, take: claimedEditingTransitionTake(take) };
  };

  const db = await getDb();
  if (!db) {
    return withMemoryVideoTakeSubmissionClaim(async () => {
      await ensureMemoryLoaded();
      const storyExists = memoryState.stories.some(
        story => story.id === input.storyId && story.userId === input.userId
      );
      if (!storyExists) throw new Error("故事不存在或无权操作");
      const storyTakes = memoryState.videoTakes.filter(
        take => take.storyId === input.storyId && take.userId === input.userId
      );
      const decision = decide(storyTakes);
      if (!decision.claimed) return decision;
      const index = memoryState.videoTakes.findIndex(
        take => take.id === decision.take.id && take.userId === input.userId
      );
      if (index < 0) throw new Error("衔接视频提交权持久化失败");
      const previous = memoryState.videoTakes[index];
      memoryState.videoTakes[index] = decision.take;
      try {
        await persistMemoryState();
      } catch (error) {
        memoryState.videoTakes[index] = previous;
        throw error;
      }
      return decision;
    });
  }

  return db.transaction(async tx => {
    const [story] = await tx
      .select({ id: stories.id })
      .from(stories)
      .where(
        and(eq(stories.id, input.storyId), eq(stories.userId, input.userId))
      )
      .for("update")
      .limit(1);
    if (!story) throw new Error("故事不存在或无权操作");

    const storyTakes = await tx
      .select()
      .from(videoTakes)
      .where(
        and(
          eq(videoTakes.storyId, input.storyId),
          eq(videoTakes.userId, input.userId)
        )
      )
      .for("update");
    const decision = decide(storyTakes);
    if (!decision.claimed) return decision;

    await tx
      .update(videoTakes)
      .set({
        status: decision.take.status,
        errorMessage: decision.take.errorMessage,
        parameterSnapshot: decision.take.parameterSnapshot,
      })
      .where(
        and(
          eq(videoTakes.id, decision.take.id),
          eq(videoTakes.storyId, input.storyId),
          eq(videoTakes.userId, input.userId)
        )
      );
    const [updated] = await tx
      .select()
      .from(videoTakes)
      .where(
        and(
          eq(videoTakes.id, decision.take.id),
          eq(videoTakes.storyId, input.storyId),
          eq(videoTakes.userId, input.userId)
        )
      )
      .limit(1);
    if (
      !updated ||
      jsonRecord(updated.parameterSnapshot).submissionState !== "submitting"
    ) {
      throw new Error("衔接视频提交权持久化失败");
    }
    return { claimed: true, take: updated };
  });
}

export type StartEndShotSubmissionClaim =
  | { claimed: true; take: VideoTake }
  | {
      claimed: false;
      take: VideoTake;
      reason: "already_claimed";
    };

function validateStartEndShotTake(take: VideoTake) {
  const snapshot = jsonRecord(take.parameterSnapshot);
  if (
    snapshot.kind !== "shot-start-end" ||
    snapshot.stableShotId !== take.stableShotId
  ) {
    throw new Error("首尾帧视频任务缺少可验证的镜头快照");
  }
  return snapshot;
}

function claimStartEndShotTake(take: VideoTake): VideoTake {
  const snapshot = validateStartEndShotTake(take);
  const state = snapshot.submissionState;
  if (state !== "not_started" && state !== "not_submitted") return take;
  return {
    ...take,
    status: "submitted",
    errorMessage: null,
    parameterSnapshot: {
      ...snapshot,
      submissionState: "submitting",
      submissionClaimedAt: new Date().toISOString(),
    },
    updatedAt: now(),
  };
}

/** 原子取得单镜头首尾帧付费提交权，避免双击或多实例重复扣费。 */
export async function claimStartEndShotSubmission(input: {
  takeId: number;
  storyId: number;
  userId: number;
}): Promise<StartEndShotSubmissionClaim> {
  const decide = (take: VideoTake) => {
    const claimed = claimStartEndShotTake(take);
    return claimed === take
      ? {
          claimed: false as const,
          take,
          reason: "already_claimed" as const,
        }
      : { claimed: true as const, take: claimed };
  };

  const db = await getDb();
  if (!db) {
    return withMemoryVideoTakeSubmissionClaim(async () => {
      await ensureMemoryLoaded();
      const storyExists = memoryState.stories.some(
        story => story.id === input.storyId && story.userId === input.userId
      );
      if (!storyExists) throw new Error("故事不存在或无权操作");
      const index = memoryState.videoTakes.findIndex(
        take =>
          take.id === input.takeId &&
          take.storyId === input.storyId &&
          take.userId === input.userId
      );
      if (index < 0) throw new Error("首尾帧视频任务不存在或无权操作");
      const decision = decide(memoryState.videoTakes[index]);
      if (!decision.claimed) return decision;
      const previous = memoryState.videoTakes[index];
      memoryState.videoTakes[index] = decision.take;
      try {
        await persistMemoryState();
      } catch (error) {
        memoryState.videoTakes[index] = previous;
        throw error;
      }
      return decision;
    });
  }

  return db.transaction(async tx => {
    const [story] = await tx
      .select({ id: stories.id })
      .from(stories)
      .where(
        and(eq(stories.id, input.storyId), eq(stories.userId, input.userId))
      )
      .for("update")
      .limit(1);
    if (!story) throw new Error("故事不存在或无权操作");
    const [take] = await tx
      .select()
      .from(videoTakes)
      .where(
        and(
          eq(videoTakes.id, input.takeId),
          eq(videoTakes.storyId, input.storyId),
          eq(videoTakes.userId, input.userId)
        )
      )
      .for("update")
      .limit(1);
    if (!take) throw new Error("首尾帧视频任务不存在或无权操作");
    const decision = decide(take);
    if (!decision.claimed) return decision;
    await tx
      .update(videoTakes)
      .set({
        status: decision.take.status,
        errorMessage: decision.take.errorMessage,
        parameterSnapshot: decision.take.parameterSnapshot,
      })
      .where(
        and(
          eq(videoTakes.id, input.takeId),
          eq(videoTakes.storyId, input.storyId),
          eq(videoTakes.userId, input.userId)
        )
      );
    const [updated] = await tx
      .select()
      .from(videoTakes)
      .where(
        and(
          eq(videoTakes.id, input.takeId),
          eq(videoTakes.storyId, input.storyId),
          eq(videoTakes.userId, input.userId)
        )
      )
      .limit(1);
    if (
      !updated ||
      jsonRecord(updated.parameterSnapshot).submissionState !== "submitting"
    ) {
      throw new Error("首尾帧视频提交权持久化失败");
    }
    return { claimed: true, take: updated };
  });
}

export async function createVideoTakeRange(
  data: Omit<InsertVideoTakeRange, "id" | "createdAt" | "updatedAt">
): Promise<VideoTakeRange> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const current = now();
    const row: VideoTakeRange = {
      id: nextMemoryId("videoTakeRange"),
      takeId: data.takeId,
      storyId: data.storyId,
      userId: data.userId,
      stableShotId: data.stableShotId,
      startSec: data.startSec,
      endSec: data.endSec,
      label: data.label ?? null,
      source: data.source ?? "manual",
      createdAt: current,
      updatedAt: current,
    };
    memoryState.videoTakeRanges.push(row);
    await persistMemoryState();
    return row;
  }
  const [result] = await db.insert(videoTakeRanges).values(data);
  const [row] = await db
    .select()
    .from(videoTakeRanges)
    .where(eq(videoTakeRanges.id, result.insertId));
  return row;
}

export async function getStoryVideoTakeRanges(
  storyId: number,
  userId: number
): Promise<VideoTakeRange[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return memoryState.videoTakeRanges
      .filter(range => range.storyId === storyId && range.userId === userId)
      .sort(
        (left, right) => left.startSec - right.startSec || left.id - right.id
      );
  }
  return db
    .select()
    .from(videoTakeRanges)
    .where(
      and(
        eq(videoTakeRanges.storyId, storyId),
        eq(videoTakeRanges.userId, userId)
      )
    )
    .orderBy(videoTakeRanges.startSec, videoTakeRanges.id);
}

export async function getVideoTakeRangeById(
  id: number,
  userId: number
): Promise<VideoTakeRange | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return (
      memoryState.videoTakeRanges.find(
        range => range.id === id && range.userId === userId
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(videoTakeRanges)
    .where(and(eq(videoTakeRanges.id, id), eq(videoTakeRanges.userId, userId)));
  return row ?? null;
}

export async function getStoryVideoTimelineSelections(
  storyId: number,
  userId: number
): Promise<VideoTimelineSelection[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return memoryState.videoTimelineSelections.filter(
      selection => selection.storyId === storyId && selection.userId === userId
    );
  }
  return db
    .select()
    .from(videoTimelineSelections)
    .where(
      and(
        eq(videoTimelineSelections.storyId, storyId),
        eq(videoTimelineSelections.userId, userId)
      )
    );
}

export async function setVideoTimelineSelection(
  data: Omit<InsertVideoTimelineSelection, "id" | "createdAt" | "updatedAt">
): Promise<VideoTimelineSelection> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const current = now();
    const existing = memoryState.videoTimelineSelections.find(
      selection =>
        selection.storyId === data.storyId &&
        selection.userId === data.userId &&
        selection.stableShotId === data.stableShotId
    );
    if (existing) {
      existing.takeId = data.takeId;
      existing.rangeId = data.rangeId ?? null;
      existing.selectionType = data.selectionType ?? "full_take";
      existing.updatedAt = current;
      await persistMemoryState();
      return existing;
    }
    const row: VideoTimelineSelection = {
      id: nextMemoryId("videoTimelineSelection"),
      storyId: data.storyId,
      userId: data.userId,
      stableShotId: data.stableShotId,
      takeId: data.takeId,
      rangeId: data.rangeId ?? null,
      selectionType: data.selectionType ?? "full_take",
      createdAt: current,
      updatedAt: current,
    };
    memoryState.videoTimelineSelections.push(row);
    await persistMemoryState();
    return row;
  }
  const [existing] = await db
    .select()
    .from(videoTimelineSelections)
    .where(
      and(
        eq(videoTimelineSelections.storyId, data.storyId),
        eq(videoTimelineSelections.userId, data.userId),
        eq(videoTimelineSelections.stableShotId, data.stableShotId)
      )
    )
    .limit(1);
  if (existing) {
    await db
      .update(videoTimelineSelections)
      .set(data)
      .where(eq(videoTimelineSelections.id, existing.id));
    const [updated] = await db
      .select()
      .from(videoTimelineSelections)
      .where(eq(videoTimelineSelections.id, existing.id));
    return updated;
  }
  const [result] = await db.insert(videoTimelineSelections).values(data);
  const [row] = await db
    .select()
    .from(videoTimelineSelections)
    .where(eq(videoTimelineSelections.id, result.insertId));
  return row;
}

export async function clearVideoTimelineSelection(
  storyId: number,
  userId: number,
  stableShotId: string
): Promise<void> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    memoryState.videoTimelineSelections =
      memoryState.videoTimelineSelections.filter(
        selection =>
          !(
            selection.storyId === storyId &&
            selection.userId === userId &&
            selection.stableShotId === stableShotId
          )
      );
    await persistMemoryState();
    return;
  }
  await db
    .delete(videoTimelineSelections)
    .where(
      and(
        eq(videoTimelineSelections.storyId, storyId),
        eq(videoTimelineSelections.userId, userId),
        eq(videoTimelineSelections.stableShotId, stableShotId)
      )
    );
}

export async function getStoryTimeline(
  storyId: number,
  userId: number
): Promise<
  (StoryTimeline & { overlays?: unknown; visualLayerState?: unknown }) | null
> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return withLocalTimelineLock(storyId, userId, async () => {
      const row =
        memoryState.storyTimelines.find(
          timeline => timeline.storyId === storyId && timeline.userId === userId
        ) ?? null;
      return row ? storyTimelineView(row) : null;
    });
  }
  const [row] = await db
    .select()
    .from(storyTimelines)
    .where(
      and(
        eq(storyTimelines.storyId, storyId),
        eq(storyTimelines.userId, userId)
      )
    )
    .limit(1);
  return row ? storyTimelineView(row) : null;
}

type StoryTimelinePayload = {
  items: unknown;
  overlays?: unknown;
  visualLayerState?: unknown;
  /**
   * Non-visual media slices (subtitles in U3, audio in U9). A visual writer
   * never sets this and must never drop it; it is preserved from the stored
   * document by the canonical codec on every save.
   */
  extensions?: Record<string, unknown>;
};

// Thin wrappers over the one canonical codec in
// server/persistence/storyTimelinePersistence.ts. Do not reimplement envelope
// decode/encode here — the architecture guard forbids a second codec.
function decodeStoryTimelinePayload(value: unknown): StoryTimelinePayload {
  return decodeStoredStoryTimeline(value);
}

function encodeStoryTimelinePayload(payload: StoryTimelinePayload): unknown {
  return encodeStoredStoryTimeline(payload);
}

function replaceStoryTimelineItemsPreservingOverlays(
  currentValue: unknown,
  nextItems: unknown
): unknown {
  const current = decodeStoryTimelinePayload(currentValue);
  const next = decodeStoryTimelinePayload(nextItems);
  return encodeStoryTimelinePayload({
    items: next.items,
    overlays: current.overlays ?? next.overlays,
    visualLayerState: current.visualLayerState ?? next.visualLayerState,
    // The replacement `nextItems` is a bare visual document; extension slices
    // only ever live on the stored row, so carry them straight through.
    extensions: mergeStoredStoryTimelineExtensions(
      currentValue,
      next.extensions
    ),
  });
}

function storyTimelineView(row: StoryTimeline): StoryTimeline & {
  overlays?: unknown;
  visualLayerState?: unknown;
  extensions?: Record<string, unknown>;
} {
  const payload = decodeStoryTimelinePayload(row.items);
  return {
    ...row,
    items: payload.items,
    ...(payload.overlays === undefined ? {} : { overlays: payload.overlays }),
    ...(payload.visualLayerState === undefined
      ? {}
      : { visualLayerState: payload.visualLayerState }),
    // Non-visual slices ride along in a namespaced bag; nothing in U1 reads
    // them, but the view must not be where they get dropped.
    ...(payload.extensions === undefined
      ? {}
      : { extensions: payload.extensions }),
  };
}

export async function updateStoryTimeline(input: {
  storyId: number;
  userId: number;
  expectedVersion: number;
  items: unknown;
  overlays?: unknown;
  visualLayerState?: unknown;
  /**
   * Non-visual media slices to merge per key (subtitles in U3, audio in U9).
   * A key set here replaces only that slice; every other stored slice is
   * preserved. Visual writers never pass this.
   */
  extensions?: Record<string, unknown>;
}): Promise<
  StoryTimeline & {
    overlays?: unknown;
    visualLayerState?: unknown;
    extensions?: Record<string, unknown>;
  }
> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return withLocalAggregateMutationLock(() =>
      withLocalTimelineLock(input.storyId, input.userId, async () => {
        const existing = memoryState.storyTimelines.find(
          timeline =>
            timeline.storyId === input.storyId &&
            timeline.userId === input.userId
        );
        if (!existing) {
          if (input.expectedVersion !== 0) throw new Error("时间轴版本已更新");
          const current = now();
          const createdItems = encodeStoryTimelinePayload({
            items: input.items,
            ...(input.overlays === undefined
              ? {}
              : { overlays: input.overlays }),
            ...(input.visualLayerState === undefined
              ? {}
              : { visualLayerState: input.visualLayerState }),
            extensions: mergeStoredStoryTimelineExtensions(
              undefined,
              input.extensions
            ),
          });
          const row: StoryTimeline = {
            id: nextMemoryId("storyTimeline"),
            storyId: input.storyId,
            userId: input.userId,
            version: 1,
            items: createdItems,
            createdAt: current,
            updatedAt: current,
          };
          memoryState.storyTimelines.push(row);
          const rollback = () => {
            const index = memoryState.storyTimelines.indexOf(row);
            if (
              index >= 0 &&
              row.version === 1 &&
              row.items === createdItems &&
              row.updatedAt === memoryState.storyTimelines[index]?.updatedAt
            ) {
              memoryState.storyTimelines.splice(index, 1);
            }
          };
          await persistMemoryState(rollback);
          return storyTimelineView(row);
        }
        if (existing.version !== input.expectedVersion) {
          throw new Error("时间轴版本已更新");
        }
        const currentPayload = decodeStoryTimelinePayload(existing.items);
        const previousItems = existing.items;
        const previousVersion = existing.version;
        const previousUpdatedAt = existing.updatedAt;
        const nextItems = encodeStoryTimelinePayload({
          items: input.items,
          overlays: input.overlays ?? currentPayload.overlays,
          visualLayerState:
            input.visualLayerState ?? currentPayload.visualLayerState,
          extensions: mergeStoredStoryTimelineExtensions(
            existing.items,
            input.extensions
          ),
        });
        const nextVersion = previousVersion + 1;
        const nextUpdatedAt = now();
        existing.items = nextItems;
        existing.version = nextVersion;
        existing.updatedAt = nextUpdatedAt;
        const rollback = () => {
          // A later successful CAS writer may already have advanced this row while
          // our full-state write was in flight. Only roll back the exact values
          // published by this call; never erase a newer in-memory success.
          if (
            existing.items === nextItems &&
            existing.version === nextVersion &&
            existing.updatedAt === nextUpdatedAt
          ) {
            existing.items = previousItems;
            existing.version = previousVersion;
            existing.updatedAt = previousUpdatedAt;
          }
        };
        await persistMemoryState(rollback);
        return storyTimelineView(existing);
      })
    );
  }

  return db.transaction(async tx => {
    const [existing] = await tx
      .select()
      .from(storyTimelines)
      .where(
        and(
          eq(storyTimelines.storyId, input.storyId),
          eq(storyTimelines.userId, input.userId)
        )
      )
      .for("update")
      .limit(1);
    if (!existing) {
      if (input.expectedVersion !== 0) throw new Error("时间轴版本已更新");
      const [result] = await tx.insert(storyTimelines).values({
        storyId: input.storyId,
        userId: input.userId,
        version: 1,
        items: encodeStoryTimelinePayload({
          items: input.items,
          ...(input.overlays === undefined ? {} : { overlays: input.overlays }),
          ...(input.visualLayerState === undefined
            ? {}
            : { visualLayerState: input.visualLayerState }),
          extensions: mergeStoredStoryTimelineExtensions(
            undefined,
            input.extensions
          ),
        }),
      });
      const [created] = await tx
        .select()
        .from(storyTimelines)
        .where(eq(storyTimelines.id, result.insertId));
      return storyTimelineView(created);
    }
    if (existing.version !== input.expectedVersion) {
      throw new Error("时间轴版本已更新");
    }
    const currentPayload = decodeStoryTimelinePayload(existing.items);
    await tx
      .update(storyTimelines)
      .set({
        items: encodeStoryTimelinePayload({
          items: input.items,
          overlays: input.overlays ?? currentPayload.overlays,
          visualLayerState:
            input.visualLayerState ?? currentPayload.visualLayerState,
          extensions: mergeStoredStoryTimelineExtensions(
            existing.items,
            input.extensions
          ),
        }),
        version: existing.version + 1,
      })
      .where(eq(storyTimelines.id, existing.id));
    const [updated] = await tx
      .select()
      .from(storyTimelines)
      .where(eq(storyTimelines.id, existing.id));
    return storyTimelineView(updated);
  });
}

/**
 * Service-only aggregate compare-and-swap for commands that must replace the
 * Story body and the complete Timeline document as one fact. `nextTimeline`
 * is replacement data for the visual fields: an empty overlays array clears
 * overlays, while an omitted overlays/visualLayerState field remains omitted.
 * It never inherits visual fields from the previous document.
 *
 * Non-visual extension slices (subtitles, audio) are the exception: they are
 * preserved from the stored document per key unless `nextTimeline.extensions`
 * explicitly overrides one. A visual-only aggregate command therefore cannot
 * drop a subtitle or audio slice.
 *
 * Local mode takes locks in the fixed Story -> Timeline order and persists an
 * isolated next state before publishing either row to shared memory. SQL mode
 * locks the same rows in the same order inside one transaction.
 */
export async function updateStoryAndTimelineAtomic(input: {
  storyId: number;
  userId: number;
  expectedStoryRevision: number;
  expectedTimelineVersion: number;
  nextStoryBody: unknown;
  nextTimeline: StoryTimelinePayload;
}): Promise<{
  story: Story;
  timeline: StoryTimeline & {
    overlays?: unknown;
    visualLayerState?: unknown;
    extensions?: Record<string, unknown>;
  };
}> {
  const nextStoryRevision = persistedStoryBodyRevision(input.nextStoryBody);
  if (nextStoryRevision !== input.expectedStoryRevision + 1) {
    throw new Error(
      `Story CAS body revision ${nextStoryRevision} must follow expected revision ${input.expectedStoryRevision}`
    );
  }
  // Extension slices ride on the stored row, so the payload can only be
  // finalized once the current row is under lock. `currentValue` is the
  // stored `items` column of the row being replaced (undefined for insert).
  const buildNextTimelinePayload = (currentValue: unknown) =>
    encodeStoryTimelinePayload({
      items: input.nextTimeline.items,
      ...(input.nextTimeline.overlays === undefined
        ? {}
        : { overlays: input.nextTimeline.overlays }),
      ...(input.nextTimeline.visualLayerState === undefined
        ? {}
        : { visualLayerState: input.nextTimeline.visualLayerState }),
      extensions: mergeStoredStoryTimelineExtensions(
        currentValue,
        input.nextTimeline.extensions
      ),
    });
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return withLocalAggregateMutationLock(() =>
      withLocalStoryLock(input.storyId, input.userId, () =>
        withLocalTimelineLock(input.storyId, input.userId, async () => {
          const storyIndex = memoryState.stories.findIndex(
            row => row.id === input.storyId && row.userId === input.userId
          );
          if (storyIndex < 0) throw new Error("故事不存在或无权操作");
          const story = memoryState.stories[storyIndex];
          const timelineIndex = memoryState.storyTimelines.findIndex(
            row => row.storyId === input.storyId && row.userId === input.userId
          );
          const timeline = memoryState.storyTimelines[timelineIndex];
          if (
            persistedStoryBodyRevision(story.body) !==
            input.expectedStoryRevision
          ) {
            throw new Error("故事已经更新，请重新加载后再试");
          }
          if ((timeline?.version ?? 0) !== input.expectedTimelineVersion) {
            throw new Error("时间轴已经更新，请重新加载后再试");
          }

          const current = now();
          const nextStory: Story = {
            ...story,
            body: input.nextStoryBody as StoryBody,
            updatedAt: current,
          };
          const nextIds = { ...memoryState.nextIds };
          const nextTimeline: StoryTimeline = timeline
            ? {
                ...timeline,
                items: buildNextTimelinePayload(timeline.items),
                version: timeline.version + 1,
                updatedAt: current,
              }
            : {
                id: nextIds.storyTimeline++,
                storyId: input.storyId,
                userId: input.userId,
                items: buildNextTimelinePayload(undefined),
                version: 1,
                createdAt: current,
                updatedAt: current,
              };
          // This primitive deliberately bypasses optimistic publication: the
          // durable snapshot is written first, then both live rows become
          // visible together. A failed write therefore requires no rollback.
          const nextState: MemoryState = {
            ...memoryState,
            stories: memoryState.stories.map((row, index) =>
              index === storyIndex ? nextStory : row
            ),
            storyTimelines:
              timelineIndex >= 0
                ? memoryState.storyTimelines.map((row, index) =>
                    index === timelineIndex ? nextTimeline : row
                  )
                : [...memoryState.storyTimelines, nextTimeline],
            nextIds,
          };
          const frozenNextState = frozenMemoryStateSnapshot(nextState);
          await enqueueLocalPersistenceWrite(() =>
            persistMemoryStateToDisk(frozenNextState)
          );
          memoryState.stories[storyIndex] = nextStory;
          if (timelineIndex >= 0) {
            memoryState.storyTimelines[timelineIndex] = nextTimeline;
          } else {
            memoryState.storyTimelines.push(nextTimeline);
            memoryState.nextIds.storyTimeline = nextIds.storyTimeline;
          }
          return {
            story: nextStory,
            timeline: storyTimelineView(nextTimeline),
          };
        })
      )
    );
  }

  return db.transaction(async tx => {
    const [story] = await tx
      .select()
      .from(stories)
      .where(
        and(eq(stories.id, input.storyId), eq(stories.userId, input.userId))
      )
      .for("update")
      .limit(1);
    if (!story) throw new Error("故事不存在或无权操作");
    if (
      persistedStoryBodyRevision(story.body) !== input.expectedStoryRevision
    ) {
      throw new Error("故事已经更新，请重新加载后再试");
    }

    const [timeline] = await tx
      .select()
      .from(storyTimelines)
      .where(
        and(
          eq(storyTimelines.storyId, input.storyId),
          eq(storyTimelines.userId, input.userId)
        )
      )
      .for("update")
      .limit(1);
    if ((timeline?.version ?? 0) !== input.expectedTimelineVersion) {
      throw new Error("时间轴已经更新，请重新加载后再试");
    }

    await tx
      .update(stories)
      .set({ body: input.nextStoryBody as StoryBody })
      .where(eq(stories.id, story.id));
    let timelineId: number;
    if (timeline) {
      timelineId = timeline.id;
      await tx
        .update(storyTimelines)
        .set({
          items: buildNextTimelinePayload(timeline.items),
          version: timeline.version + 1,
        })
        .where(eq(storyTimelines.id, timeline.id));
    } else {
      const [inserted] = await tx.insert(storyTimelines).values({
        storyId: input.storyId,
        userId: input.userId,
        items: buildNextTimelinePayload(undefined),
        version: 1,
      });
      timelineId = inserted.insertId;
    }
    const [[updatedStory], [updatedTimeline]] = await Promise.all([
      tx.select().from(stories).where(eq(stories.id, story.id)).limit(1),
      tx
        .select()
        .from(storyTimelines)
        .where(eq(storyTimelines.id, timelineId))
        .limit(1),
    ]);
    return {
      story: updatedStory,
      timeline: storyTimelineView(updatedTimeline),
    };
  });
}

export async function applyStoryTimelineOverlayAtomic(input: {
  storyId: number;
  userId: number;
  takeId: number;
  stableShotId: string;
  expectedStoryRevision: number;
  expectedVersion: number;
  nextStoryBody: unknown;
  nextTimelineItems: unknown;
  nextTimelineOverlays?: unknown;
  nextVisualLayerState?: unknown;
  overlay?: StoryTimelineOverlay;
}): Promise<{
  applied: boolean;
  story: Story;
  timeline: StoryTimeline & { overlays?: unknown };
  take: VideoTake;
}> {
  const snapshotWithApplied = (take: VideoTake) => ({
    ...(take.parameterSnapshot &&
    typeof take.parameterSnapshot === "object" &&
    !Array.isArray(take.parameterSnapshot)
      ? (take.parameterSnapshot as Record<string, unknown>)
      : {}),
    appliedToTimeline: true,
    ...(input.overlay ? { overlayId: input.overlay.id } : {}),
  });
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return withLocalAggregateMutationLock(() =>
      withLocalStoryLock(input.storyId, input.userId, () =>
        withLocalTimelineLock(input.storyId, input.userId, async () => {
          const storyIndex = memoryState.stories.findIndex(
            row => row.id === input.storyId && row.userId === input.userId
          );
          const timelineIndex = memoryState.storyTimelines.findIndex(
            row => row.storyId === input.storyId && row.userId === input.userId
          );
          const takeIndex = memoryState.videoTakes.findIndex(
            row =>
              row.id === input.takeId &&
              row.storyId === input.storyId &&
              row.userId === input.userId
          );
          if (storyIndex < 0 || timelineIndex < 0 || takeIndex < 0) {
            throw new Error("故事、时间轴或生成视频不存在");
          }
          const story = memoryState.stories[storyIndex];
          const timeline = memoryState.storyTimelines[timelineIndex];
          const take = memoryState.videoTakes[takeIndex];
          const payload = decodeStoryTimelinePayload(timeline.items);
          const overlays = Array.isArray(payload.overlays)
            ? [...payload.overlays]
            : [];
          const overlayExists =
            !input.overlay ||
            overlays.some(
              value =>
                value &&
                typeof value === "object" &&
                !Array.isArray(value) &&
                (value as Record<string, unknown>).id === input.overlay!.id
            );
          const shotExists = storyBodyContainsStableShotId(
            story.body,
            input.stableShotId
          );
          const timelineItemExists = timelineContainsStableShotId(
            payload.items,
            input.stableShotId
          );
          if (
            overlayExists &&
            shotExists &&
            timelineItemExists &&
            jsonRecord(take.parameterSnapshot).appliedToTimeline === true
          ) {
            return {
              applied: false,
              story,
              timeline: storyTimelineView(timeline),
              take,
            };
          }
          if (revisionOf(story.body) !== input.expectedStoryRevision)
            throw new Error("故事已经更新，请重新确认覆盖位置");
          if (timeline.version !== input.expectedVersion)
            throw new Error("时间轴已经更新，请重新确认覆盖位置");
          if (
            !shotExists &&
            !storyBodyContainsStableShotId(
              input.nextStoryBody,
              input.stableShotId
            )
          )
            throw new Error("待写入的故事版缺少生成镜头");
          if (
            !timelineItemExists &&
            !timelineContainsStableShotId(
              input.nextTimelineItems,
              input.stableShotId
            )
          )
            throw new Error("待写入的时间轴缺少生成镜头列");
          const current = now();
          const nextStory = shotExists
            ? story
            : {
                ...story,
                body: input.nextStoryBody as StoryBody,
                updatedAt: current,
              };
          const nextTimeline =
            timelineItemExists && overlayExists
              ? timeline
              : {
                  ...timeline,
                  items: encodeStoryTimelinePayload({
                    items: timelineItemExists
                      ? payload.items
                      : input.nextTimelineItems,
                    overlays:
                      input.nextTimelineOverlays ??
                      (overlayExists
                        ? overlays
                        : [...overlays, input.overlay!]),
                    visualLayerState:
                      input.nextVisualLayerState ?? payload.visualLayerState,
                    extensions: payload.extensions,
                  }),
                  version: timeline.version + 1,
                  updatedAt: current,
                };
          const nextTake = {
            ...take,
            parameterSnapshot: snapshotWithApplied(take),
            errorMessage: null,
            updatedAt: current,
          };
          const nextState: MemoryState = {
            ...memoryState,
            stories: memoryState.stories.map((row, i) =>
              i === storyIndex ? nextStory : row
            ),
            storyTimelines: memoryState.storyTimelines.map((row, i) =>
              i === timelineIndex ? nextTimeline : row
            ),
            videoTakes: memoryState.videoTakes.map((row, i) =>
              i === takeIndex ? nextTake : row
            ),
          };
          const snapshot = frozenMemoryStateSnapshot(nextState);
          await enqueueLocalPersistenceWrite(() =>
            persistMemoryStateToDisk(snapshot)
          );
          memoryState.stories[storyIndex] = nextStory;
          memoryState.storyTimelines[timelineIndex] = nextTimeline;
          memoryState.videoTakes[takeIndex] = nextTake;
          return {
            applied: true,
            story: nextStory,
            timeline: storyTimelineView(nextTimeline),
            take: nextTake,
          };
        })
      )
    );
  }

  return db.transaction(async tx => {
    // All aggregate writers acquire locks in the same deterministic order.
    // Parallel FOR UPDATE queries can reach MySQL in an arbitrary order and
    // deadlock against Story -> Timeline writers.
    const [story] = await tx
      .select()
      .from(stories)
      .where(
        and(eq(stories.id, input.storyId), eq(stories.userId, input.userId))
      )
      .for("update")
      .limit(1);
    const [timeline] = await tx
      .select()
      .from(storyTimelines)
      .where(
        and(
          eq(storyTimelines.storyId, input.storyId),
          eq(storyTimelines.userId, input.userId)
        )
      )
      .for("update")
      .limit(1);
    const [take] = await tx
      .select()
      .from(videoTakes)
      .where(
        and(
          eq(videoTakes.id, input.takeId),
          eq(videoTakes.storyId, input.storyId),
          eq(videoTakes.userId, input.userId)
        )
      )
      .for("update")
      .limit(1);
    if (!story || !timeline || !take) {
      throw new Error("故事、时间轴或生成视频不存在");
    }
    const payload = decodeStoryTimelinePayload(timeline.items);
    const overlays = Array.isArray(payload.overlays)
      ? [...payload.overlays]
      : [];
    const overlayExists =
      !input.overlay ||
      overlays.some(
        value =>
          value &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          (value as Record<string, unknown>).id === input.overlay!.id
      );
    const shotExists = storyBodyContainsStableShotId(
      story.body,
      input.stableShotId
    );
    const timelineItemExists = timelineContainsStableShotId(
      payload.items,
      input.stableShotId
    );
    if (
      overlayExists &&
      shotExists &&
      timelineItemExists &&
      jsonRecord(take.parameterSnapshot).appliedToTimeline === true
    ) {
      return {
        applied: false,
        story,
        timeline: storyTimelineView(timeline),
        take,
      };
    }
    if (revisionOf(story.body) !== input.expectedStoryRevision) {
      throw new Error("故事已经更新，请重新确认覆盖位置");
    }
    if (timeline.version !== input.expectedVersion) {
      throw new Error("时间轴已经更新，请重新确认覆盖位置");
    }
    if (!shotExists) {
      if (
        !storyBodyContainsStableShotId(input.nextStoryBody, input.stableShotId)
      ) {
        throw new Error("待写入的故事版缺少生成镜头");
      }
      await tx
        .update(stories)
        .set({ body: input.nextStoryBody as StoryBody })
        .where(
          and(eq(stories.id, input.storyId), eq(stories.userId, input.userId))
        );
    }
    if (!timelineItemExists || !overlayExists) {
      if (
        !timelineItemExists &&
        !timelineContainsStableShotId(
          input.nextTimelineItems,
          input.stableShotId
        )
      ) {
        throw new Error("待写入的时间轴缺少生成镜头列");
      }
      await tx
        .update(storyTimelines)
        .set({
          items: encodeStoryTimelinePayload({
            items: timelineItemExists ? payload.items : input.nextTimelineItems,
            overlays:
              input.nextTimelineOverlays ??
              (overlayExists ? overlays : [...overlays, input.overlay!]),
            visualLayerState:
              input.nextVisualLayerState ?? payload.visualLayerState,
            extensions: payload.extensions,
          }),
          version: timeline.version + 1,
        })
        .where(eq(storyTimelines.id, timeline.id));
    }
    await tx
      .update(videoTakes)
      .set({ parameterSnapshot: snapshotWithApplied(take), errorMessage: null })
      .where(eq(videoTakes.id, take.id));
    const [[updatedStory], [updatedTimeline], [updatedTake]] =
      await Promise.all([
        tx.select().from(stories).where(eq(stories.id, story.id)).limit(1),
        tx
          .select()
          .from(storyTimelines)
          .where(eq(storyTimelines.id, timeline.id))
          .limit(1),
        tx.select().from(videoTakes).where(eq(videoTakes.id, take.id)).limit(1),
      ]);
    return {
      applied: true,
      story: updatedStory,
      timeline: storyTimelineView(updatedTimeline),
      take: updatedTake,
    };
  });
}

/**
 * Atomically publishes a generated ordinary visual shot and marks its paid
 * Take adopted. It intentionally preserves the complete overlay document and
 * never creates a compatibility overlay.
 */
export function applyGeneratedVisualShotAtomic(input: {
  storyId: number;
  userId: number;
  takeId: number;
  stableShotId: string;
  expectedStoryRevision: number;
  expectedVersion: number;
  nextStoryBody: unknown;
  nextTimelineItems: unknown;
  nextTimelineOverlays?: unknown;
  nextVisualLayerState?: unknown;
}) {
  return applyStoryTimelineOverlayAtomic(input);
}

function storyBodyContainsStableShotId(
  body: unknown,
  stableShotId: string
): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const shots = (body as Record<string, unknown>).shots;
  if (!Array.isArray(shots)) return false;
  return shots.some(shot => {
    if (!shot || typeof shot !== "object" || Array.isArray(shot)) return false;
    const record = shot as Record<string, unknown>;
    return [record.stableShotId, record.shotIdentity, record.shotKey].some(
      value => value === stableShotId
    );
  });
}

function timelineContainsStableShotId(
  items: unknown,
  stableShotId: string
): boolean {
  const timelineItems = decodeStoryTimelinePayload(items).items;
  return (
    Array.isArray(timelineItems) &&
    timelineItems.some(item => {
      if (!item || typeof item !== "object" || Array.isArray(item))
        return false;
      return (item as Record<string, unknown>).stableShotId === stableShotId;
    })
  );
}

/**
 * 聊聊生成的衔接镜头需要同时进入故事体和时间轴。这个写入点只承担两件事：
 * 版本校验与原子落库。视频 Take 在调用前已经完成，重复确认则按 stableShotId
 * 幂等返回，不会再次插入同一镜头。
 */
export async function insertTransitionShotAtomic(input: {
  storyId: number;
  userId: number;
  stableShotId: string;
  expectedStoryRevision: number;
  expectedTimelineVersion: number;
  nextStoryBody: unknown;
  nextTimelineItems: unknown;
}): Promise<{
  applied: boolean;
  story: Story;
  timeline: StoryTimeline;
}> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return withLocalAggregateMutationLock(() =>
      withLocalStoryLock(input.storyId, input.userId, () =>
        withLocalTimelineLock(input.storyId, input.userId, async () => {
          const storyIndex = memoryState.stories.findIndex(
            row => row.id === input.storyId && row.userId === input.userId
          );
          const timelineIndex = memoryState.storyTimelines.findIndex(
            row => row.storyId === input.storyId && row.userId === input.userId
          );
          const story = memoryState.stories[storyIndex];
          const timeline = memoryState.storyTimelines[timelineIndex];
          if (storyIndex < 0) throw new Error("故事不存在或无权操作");
          if (storyBodyContainsStableShotId(story.body, input.stableShotId)) {
            if (!timeline)
              throw new Error("衔接镜头已经存在，但时间轴记录缺失");
            return { applied: false, story, timeline };
          }
          if (revisionOf(story.body) !== input.expectedStoryRevision) {
            throw new Error("故事已经更新，请重新确认衔接位置");
          }
          if ((timeline?.version ?? 0) !== input.expectedTimelineVersion) {
            throw new Error("时间轴已经更新，请重新确认衔接位置");
          }

          const current = now();
          const nextStory = {
            ...story,
            body: input.nextStoryBody as StoryBody,
            updatedAt: current,
          };
          const nextIds = { ...memoryState.nextIds };
          let savedTimeline: StoryTimeline;
          if (timeline) {
            savedTimeline = {
              ...timeline,
              items: replaceStoryTimelineItemsPreservingOverlays(
                timeline.items,
                input.nextTimelineItems
              ),
              version: timeline.version + 1,
              updatedAt: current,
            };
          } else {
            savedTimeline = {
              id: nextIds.storyTimeline++,
              storyId: input.storyId,
              userId: input.userId,
              version: 1,
              items: input.nextTimelineItems,
              createdAt: current,
              updatedAt: current,
            };
          }
          const nextState: MemoryState = {
            ...memoryState,
            stories: memoryState.stories.map((row, i) =>
              i === storyIndex ? nextStory : row
            ),
            storyTimelines:
              timelineIndex >= 0
                ? memoryState.storyTimelines.map((row, i) =>
                    i === timelineIndex ? savedTimeline : row
                  )
                : [...memoryState.storyTimelines, savedTimeline],
            nextIds,
          };
          await enqueueLocalPersistenceWrite(() =>
            persistMemoryStateToDisk(frozenMemoryStateSnapshot(nextState))
          );
          memoryState.stories[storyIndex] = nextStory;
          if (timelineIndex >= 0)
            memoryState.storyTimelines[timelineIndex] = savedTimeline;
          else {
            memoryState.storyTimelines.push(savedTimeline);
            memoryState.nextIds.storyTimeline = nextIds.storyTimeline;
          }
          return { applied: true, story: nextStory, timeline: savedTimeline };
        })
      )
    );
  }

  return db.transaction(async tx => {
    const [story] = await tx
      .select()
      .from(stories)
      .where(
        and(eq(stories.id, input.storyId), eq(stories.userId, input.userId))
      )
      .for("update")
      .limit(1);
    const [timeline] = await tx
      .select()
      .from(storyTimelines)
      .where(
        and(
          eq(storyTimelines.storyId, input.storyId),
          eq(storyTimelines.userId, input.userId)
        )
      )
      .for("update")
      .limit(1);
    if (!story) throw new Error("故事不存在或无权操作");
    if (storyBodyContainsStableShotId(story.body, input.stableShotId)) {
      if (!timeline) throw new Error("衔接镜头已经存在，但时间轴记录缺失");
      return { applied: false, story, timeline };
    }
    if (revisionOf(story.body) !== input.expectedStoryRevision) {
      throw new Error("故事已经更新，请重新确认衔接位置");
    }
    if ((timeline?.version ?? 0) !== input.expectedTimelineVersion) {
      throw new Error("时间轴已经更新，请重新确认衔接位置");
    }

    await tx
      .update(stories)
      .set({ body: input.nextStoryBody as StoryBody })
      .where(
        and(eq(stories.id, input.storyId), eq(stories.userId, input.userId))
      );

    let timelineId: number;
    if (timeline) {
      timelineId = timeline.id;
      await tx
        .update(storyTimelines)
        .set({
          items: replaceStoryTimelineItemsPreservingOverlays(
            timeline.items,
            input.nextTimelineItems
          ),
          version: timeline.version + 1,
        })
        .where(eq(storyTimelines.id, timeline.id));
    } else {
      const [created] = await tx.insert(storyTimelines).values({
        storyId: input.storyId,
        userId: input.userId,
        version: 1,
        items: input.nextTimelineItems,
      });
      timelineId = created.insertId;
    }

    const [[savedStory], [savedTimeline]] = await Promise.all([
      tx.select().from(stories).where(eq(stories.id, input.storyId)).limit(1),
      tx
        .select()
        .from(storyTimelines)
        .where(eq(storyTimelines.id, timelineId))
        .limit(1),
    ]);
    if (!savedStory || !savedTimeline) {
      throw new Error("衔接镜头写入后读取失败");
    }
    return { applied: true, story: savedStory, timeline: savedTimeline };
  });
}

/**
 * Revert a structural split without rewinding either revision counter. The
 * caller supplies the pre-split documents with a fresh story revision; this
 * function owns the cross-document CAS and transaction boundary.
 */
export async function restoreSplitStoryShotAtomic(input: {
  storyId: number;
  userId: number;
  splitStableShotId: string;
  expectedStoryRevision: number;
  expectedTimelineVersion: number;
  nextStoryBody: unknown;
  nextTimelineItems: unknown;
}): Promise<{ story: Story; timeline: StoryTimeline }> {
  const validate = (story: Story, timeline: StoryTimeline | null) => {
    if (revisionOf(story.body) !== input.expectedStoryRevision) {
      throw new Error("故事已在切割后继续编辑，无法安全撤销");
    }
    if ((timeline?.version ?? 0) !== input.expectedTimelineVersion) {
      throw new Error("时间轴已在切割后继续编辑，无法安全撤销");
    }
    if (!storyBodyContainsStableShotId(story.body, input.splitStableShotId)) {
      throw new Error("切割产生的镜头已经不存在，无法撤销");
    }
    if (
      storyBodyContainsStableShotId(
        input.nextStoryBody,
        input.splitStableShotId
      )
    ) {
      throw new Error("撤销快照仍包含切割镜头");
    }
    if (
      !timeline ||
      !timelineContainsStableShotId(timeline.items, input.splitStableShotId)
    ) {
      throw new Error("切割产生的时间轴镜头已经不存在，无法撤销");
    }
    if (
      timelineContainsStableShotId(
        input.nextTimelineItems,
        input.splitStableShotId
      )
    ) {
      throw new Error("撤销时间轴快照仍包含切割镜头");
    }
  };

  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return withLocalAggregateMutationLock(() =>
      withLocalStoryLock(input.storyId, input.userId, () =>
        withLocalTimelineLock(input.storyId, input.userId, async () => {
          const storyIndex = memoryState.stories.findIndex(
            row => row.id === input.storyId && row.userId === input.userId
          );
          const timelineIndex = memoryState.storyTimelines.findIndex(
            row => row.storyId === input.storyId && row.userId === input.userId
          );
          const story = memoryState.stories[storyIndex];
          const timeline =
            timelineIndex >= 0
              ? memoryState.storyTimelines[timelineIndex]
              : null;
          if (storyIndex < 0) throw new Error("故事不存在或无权操作");
          validate(story, timeline);
          const current = now();
          const nextStory = {
            ...story,
            body: input.nextStoryBody as StoryBody,
            updatedAt: current,
          };
          const nextTimeline = {
            ...timeline!,
            items: replaceStoryTimelineItemsPreservingOverlays(
              timeline!.items,
              input.nextTimelineItems
            ),
            version: timeline!.version + 1,
            updatedAt: current,
          };
          const nextState: MemoryState = {
            ...memoryState,
            stories: memoryState.stories.map((row, i) =>
              i === storyIndex ? nextStory : row
            ),
            storyTimelines: memoryState.storyTimelines.map((row, i) =>
              i === timelineIndex ? nextTimeline : row
            ),
          };
          await enqueueLocalPersistenceWrite(() =>
            persistMemoryStateToDisk(frozenMemoryStateSnapshot(nextState))
          );
          memoryState.stories[storyIndex] = nextStory;
          memoryState.storyTimelines[timelineIndex] = nextTimeline;
          return { story: nextStory, timeline: nextTimeline };
        })
      )
    );
  }

  return db.transaction(async tx => {
    const [story] = await tx
      .select()
      .from(stories)
      .where(
        and(eq(stories.id, input.storyId), eq(stories.userId, input.userId))
      )
      .for("update")
      .limit(1);
    const [timeline] = await tx
      .select()
      .from(storyTimelines)
      .where(
        and(
          eq(storyTimelines.storyId, input.storyId),
          eq(storyTimelines.userId, input.userId)
        )
      )
      .for("update")
      .limit(1);
    if (!story) throw new Error("故事不存在或无权操作");
    validate(story, timeline ?? null);
    await tx
      .update(stories)
      .set({ body: input.nextStoryBody as StoryBody })
      .where(
        and(eq(stories.id, input.storyId), eq(stories.userId, input.userId))
      );
    await tx
      .update(storyTimelines)
      .set({
        items: replaceStoryTimelineItemsPreservingOverlays(
          timeline.items,
          input.nextTimelineItems
        ),
        version: timeline.version + 1,
      })
      .where(eq(storyTimelines.id, timeline.id));
    const [[savedStory], [savedTimeline]] = await Promise.all([
      tx.select().from(stories).where(eq(stories.id, input.storyId)).limit(1),
      tx
        .select()
        .from(storyTimelines)
        .where(eq(storyTimelines.id, timeline.id))
        .limit(1),
    ]);
    if (!savedStory || !savedTimeline) throw new Error("切割撤销后读取失败");
    return { story: savedStory, timeline: savedTimeline };
  });
}

// ─── Story audio assets & staged import operations (U2) ─────────────────

/**
 * Best-effort removal of managed audio bytes for a set of storage keys. Never
 * throws — a missing file or a bad key is fine; the metadata rows are already
 * gone by the time this runs.
 */
export async function removeManagedAudioFiles(
  storageKeys: readonly string[]
): Promise<void> {
  for (const key of storageKeys) {
    if (!isValidAudioStorageKey(key)) continue;
    try {
      await unlink(resolveManagedAudioPath(key));
    } catch {
      // best effort
    }
  }
}

export type StoryAudioAssetPatch = Partial<
  Pick<
    InsertStoryAudioAsset,
    | "status"
    | "failureReason"
    | "durationFrames"
    | "durationSeconds"
    | "sampleRate"
    | "channels"
    | "codecName"
    | "formatName"
    | "checksum"
    | "sourceKey"
    | "mediaKind"
    | "displayName"
    | "provenance"
  >
>;

export async function createStoryAudioAssetRow(
  data: Omit<InsertStoryAudioAsset, "id" | "createdAt" | "updatedAt">
): Promise<StoryAudioAsset> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const current = now();
    const row: StoryAudioAsset = {
      id: nextMemoryId("storyAudioAsset"),
      storyId: data.storyId,
      userId: data.userId,
      storageKey: data.storageKey,
      displayName: data.displayName,
      mediaKind: data.mediaKind ?? "unknown",
      sourceKind: data.sourceKind,
      sourceKey: data.sourceKey ?? null,
      checksum: data.checksum ?? null,
      status: data.status ?? "pending",
      failureReason: data.failureReason ?? null,
      durationFrames: data.durationFrames ?? null,
      durationSeconds: data.durationSeconds ?? null,
      sampleRate: data.sampleRate ?? null,
      channels: data.channels ?? null,
      codecName: data.codecName ?? null,
      formatName: data.formatName ?? null,
      provenance: data.provenance ?? null,
      createdAt: current,
      updatedAt: current,
    };
    memoryState.storyAudioAssets.push(row);
    await persistMemoryState();
    return row;
  }
  const [result] = await db.insert(storyAudioAssets).values(data);
  const [row] = await db
    .select()
    .from(storyAudioAssets)
    .where(eq(storyAudioAssets.id, result.insertId));
  return row;
}

export async function updateStoryAudioAssetRow(
  assetId: number,
  userId: number,
  patch: StoryAudioAssetPatch
): Promise<StoryAudioAsset | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const row = memoryState.storyAudioAssets.find(
      asset => asset.id === assetId && asset.userId === userId
    );
    if (!row) return null;
    applyDefinedValues(
      row as unknown as Record<string, unknown>,
      patch as unknown as Record<string, unknown>
    );
    row.updatedAt = now();
    await persistMemoryState();
    return row;
  }
  await db
    .update(storyAudioAssets)
    .set(patch)
    .where(
      and(eq(storyAudioAssets.id, assetId), eq(storyAudioAssets.userId, userId))
    );
  const [row] = await db
    .select()
    .from(storyAudioAssets)
    .where(eq(storyAudioAssets.id, assetId));
  return row ?? null;
}

/** Ownership-checked read. Never trusts a bare assetId. */
export async function getStoryAudioAssetRow(input: {
  assetId: number;
  storyId: number;
  userId: number;
}): Promise<StoryAudioAsset | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return (
      memoryState.storyAudioAssets.find(
        asset =>
          asset.id === input.assetId &&
          asset.storyId === input.storyId &&
          asset.userId === input.userId
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(storyAudioAssets)
    .where(
      and(
        eq(storyAudioAssets.id, input.assetId),
        eq(storyAudioAssets.storyId, input.storyId),
        eq(storyAudioAssets.userId, input.userId)
      )
    );
  return row ?? null;
}

export async function listStoryAudioAssetRows(input: {
  storyId: number;
  userId: number;
}): Promise<StoryAudioAsset[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return memoryState.storyAudioAssets
      .filter(
        asset =>
          asset.storyId === input.storyId && asset.userId === input.userId
      )
      .map(asset => ({ ...asset }));
  }
  return db
    .select()
    .from(storyAudioAssets)
    .where(
      and(
        eq(storyAudioAssets.storyId, input.storyId),
        eq(storyAudioAssets.userId, input.userId)
      )
    );
}

export async function listStoryAudioAssetRowsForUser(
  userId: number
): Promise<StoryAudioAsset[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return memoryState.storyAudioAssets
      .filter(asset => asset.userId === userId)
      .map(asset => ({ ...asset }));
  }
  return db
    .select()
    .from(storyAudioAssets)
    .where(eq(storyAudioAssets.userId, userId));
}

/** A `ready` asset with the same upstream identity in the same Story, for idempotent reuse. */
export async function findReusableStoryAudioAssetRow(input: {
  storyId: number;
  userId: number;
  sourceKind: StoryAudioAsset["sourceKind"];
  sourceKey: string;
}): Promise<StoryAudioAsset | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return (
      memoryState.storyAudioAssets.find(
        asset =>
          asset.storyId === input.storyId &&
          asset.userId === input.userId &&
          asset.sourceKind === input.sourceKind &&
          asset.sourceKey === input.sourceKey &&
          asset.status === "ready"
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(storyAudioAssets)
    .where(
      and(
        eq(storyAudioAssets.storyId, input.storyId),
        eq(storyAudioAssets.userId, input.userId),
        eq(storyAudioAssets.sourceKind, input.sourceKind),
        eq(storyAudioAssets.sourceKey, input.sourceKey),
        eq(storyAudioAssets.status, "ready")
      )
    )
    .limit(1);
  return row ?? null;
}

export type StoryAudioImportOperationPatch = Partial<
  Pick<
    InsertStoryAudioImportOperation,
    "status" | "failureCode" | "stagingKey" | "assetId"
  >
>;

const storyAudioImportMemoryLock = createKeyedSerialLock<string>();

export type StoryAudioImportBundleResult =
  | {
      created: true;
      asset: StoryAudioAsset;
      operation: StoryAudioImportOperation;
    }
  | { created: false; operation: StoryAudioImportOperation };

/** Atomically creates the pending asset and its recovery source-of-truth row. */
export async function createStoryAudioImportBundle(input: {
  asset: Omit<InsertStoryAudioAsset, "id" | "createdAt" | "updatedAt">;
  operation: Omit<
    InsertStoryAudioImportOperation,
    "id" | "assetId" | "createdAt" | "updatedAt"
  >;
}): Promise<StoryAudioImportBundleResult> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const key = `${input.operation.storyId}:${input.operation.userId}:${input.operation.operationId}`;
    return storyAudioImportMemoryLock.run(key, async () => {
      const existing = memoryState.storyAudioImportOperations.find(
        op =>
          op.storyId === input.operation.storyId &&
          op.userId === input.operation.userId &&
          op.operationId === input.operation.operationId
      );
      if (existing) return { created: false, operation: { ...existing } };

      const previousAssetId = memoryState.nextIds.storyAudioAsset;
      const previousOperationId = memoryState.nextIds.storyAudioImportOperation;
      const current = now();
      const asset: StoryAudioAsset = {
        id: nextMemoryId("storyAudioAsset"),
        storyId: input.asset.storyId,
        userId: input.asset.userId,
        storageKey: input.asset.storageKey,
        displayName: input.asset.displayName,
        mediaKind: input.asset.mediaKind ?? "unknown",
        sourceKind: input.asset.sourceKind,
        sourceKey: input.asset.sourceKey ?? null,
        checksum: input.asset.checksum ?? null,
        status: input.asset.status ?? "pending",
        failureReason: input.asset.failureReason ?? null,
        durationFrames: input.asset.durationFrames ?? null,
        durationSeconds: input.asset.durationSeconds ?? null,
        sampleRate: input.asset.sampleRate ?? null,
        channels: input.asset.channels ?? null,
        codecName: input.asset.codecName ?? null,
        formatName: input.asset.formatName ?? null,
        provenance: input.asset.provenance ?? null,
        createdAt: current,
        updatedAt: current,
      };
      const operation: StoryAudioImportOperation = {
        id: nextMemoryId("storyAudioImportOperation"),
        storyId: input.operation.storyId,
        userId: input.operation.userId,
        operationId: input.operation.operationId,
        requestDigest: input.operation.requestDigest,
        assetId: asset.id,
        sourceKind: input.operation.sourceKind,
        status: input.operation.status ?? "pending",
        failureCode: input.operation.failureCode ?? null,
        stagingKey: input.operation.stagingKey ?? null,
        createdAt: current,
        updatedAt: current,
      };
      memoryState.storyAudioAssets.push(asset);
      memoryState.storyAudioImportOperations.push(operation);
      try {
        await persistMemoryState();
      } catch (error) {
        memoryState.storyAudioAssets.pop();
        memoryState.storyAudioImportOperations.pop();
        memoryState.nextIds.storyAudioAsset = previousAssetId;
        memoryState.nextIds.storyAudioImportOperation = previousOperationId;
        throw error;
      }
      return { created: true, asset, operation };
    });
  }

  try {
    return await db.transaction(async tx => {
      const [existing] = await tx
        .select()
        .from(storyAudioImportOperations)
        .where(
          and(
            eq(storyAudioImportOperations.storyId, input.operation.storyId),
            eq(storyAudioImportOperations.userId, input.operation.userId),
            eq(
              storyAudioImportOperations.operationId,
              input.operation.operationId
            )
          )
        );
      if (existing) return { created: false as const, operation: existing };

      const [assetInsert] = await tx
        .insert(storyAudioAssets)
        .values(input.asset);
      const [asset] = await tx
        .select()
        .from(storyAudioAssets)
        .where(eq(storyAudioAssets.id, assetInsert.insertId));
      const [operationInsert] = await tx
        .insert(storyAudioImportOperations)
        .values({ ...input.operation, assetId: asset.id });
      const [operation] = await tx
        .select()
        .from(storyAudioImportOperations)
        .where(eq(storyAudioImportOperations.id, operationInsert.insertId));
      return { created: true as const, asset, operation };
    });
  } catch (error) {
    const existing = await getStoryAudioImportOperationRow({
      storyId: input.operation.storyId,
      userId: input.operation.userId,
      operationId: input.operation.operationId,
    });
    if (existing) return { created: false, operation: existing };
    throw error;
  }
}

export async function createStoryAudioImportOperationRow(
  data: Omit<InsertStoryAudioImportOperation, "id" | "createdAt" | "updatedAt">
): Promise<StoryAudioImportOperation> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const current = now();
    const row: StoryAudioImportOperation = {
      id: nextMemoryId("storyAudioImportOperation"),
      storyId: data.storyId,
      userId: data.userId,
      operationId: data.operationId,
      requestDigest: data.requestDigest,
      assetId: data.assetId ?? null,
      sourceKind: data.sourceKind,
      status: data.status ?? "pending",
      failureCode: data.failureCode ?? null,
      stagingKey: data.stagingKey ?? null,
      createdAt: current,
      updatedAt: current,
    };
    memoryState.storyAudioImportOperations.push(row);
    await persistMemoryState();
    return row;
  }
  const [result] = await db.insert(storyAudioImportOperations).values(data);
  const [row] = await db
    .select()
    .from(storyAudioImportOperations)
    .where(eq(storyAudioImportOperations.id, result.insertId));
  return row;
}

export async function getStoryAudioImportOperationRow(input: {
  storyId: number;
  userId: number;
  operationId: string;
}): Promise<StoryAudioImportOperation | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return (
      memoryState.storyAudioImportOperations.find(
        op =>
          op.storyId === input.storyId &&
          op.userId === input.userId &&
          op.operationId === input.operationId
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(storyAudioImportOperations)
    .where(
      and(
        eq(storyAudioImportOperations.storyId, input.storyId),
        eq(storyAudioImportOperations.userId, input.userId),
        eq(storyAudioImportOperations.operationId, input.operationId)
      )
    );
  return row ?? null;
}

export async function updateStoryAudioImportOperationRow(
  id: number,
  patch: StoryAudioImportOperationPatch
): Promise<StoryAudioImportOperation | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const row = memoryState.storyAudioImportOperations.find(op => op.id === id);
    if (!row) return null;
    applyDefinedValues(
      row as unknown as Record<string, unknown>,
      patch as unknown as Record<string, unknown>
    );
    row.updatedAt = now();
    await persistMemoryState();
    return row;
  }
  await db
    .update(storyAudioImportOperations)
    .set(patch)
    .where(eq(storyAudioImportOperations.id, id));
  const [row] = await db
    .select()
    .from(storyAudioImportOperations)
    .where(eq(storyAudioImportOperations.id, id));
  return row ?? null;
}

/** Operations still mid-flight, for the crash-recovery pass. */
export async function listUnsettledStoryAudioImportOperationRows(): Promise<
  StoryAudioImportOperation[]
> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return memoryState.storyAudioImportOperations
      .filter(op => op.status !== "ready" && op.status !== "failed")
      .map(op => ({ ...op }));
  }
  return db
    .select()
    .from(storyAudioImportOperations)
    .where(
      and(
        ne(storyAudioImportOperations.status, "ready"),
        ne(storyAudioImportOperations.status, "failed")
      )
    );
}

/**
 * Managed audio storage keys still referenced by a Story's asset rows —
 * used by the backup script and by Story deletion to clean the real bytes.
 */
export async function listStoryAudioStorageKeysForStory(input: {
  storyId: number;
  userId: number;
}): Promise<string[]> {
  const rows = await listStoryAudioAssetRows(input);
  return rows.map(row => row.storageKey);
}

export async function createShotDerivationDraft(
  data: Omit<InsertShotDerivationDraft, "id" | "createdAt" | "updatedAt">
): Promise<ShotDerivationDraft> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const current = now();
    const row: ShotDerivationDraft = {
      id: nextMemoryId("shotDerivationDraft"),
      storyId: data.storyId,
      userId: data.userId,
      sourceStableShotId: data.sourceStableShotId,
      sourceTakeId: data.sourceTakeId,
      sourceTimeSec: data.sourceTimeSec,
      crop: data.crop,
      fullFrameImageUrl: data.fullFrameImageUrl,
      cropImageUrl: data.cropImageUrl,
      referenceRole: data.referenceRole ?? null,
      analysis: data.analysis ?? null,
      proposal: data.proposal ?? null,
      candidateImageIds: data.candidateImageIds ?? null,
      provisionalStableShotId: data.provisionalStableShotId,
      status: data.status ?? "draft",
      createdAt: current,
      updatedAt: current,
    };
    memoryState.shotDerivationDrafts.push(row);
    await persistMemoryState();
    return row;
  }
  const [result] = await db.insert(shotDerivationDrafts).values(data);
  const [row] = await db
    .select()
    .from(shotDerivationDrafts)
    .where(eq(shotDerivationDrafts.id, result.insertId));
  return row;
}

export async function getShotDerivationDraft(
  id: number,
  userId: number
): Promise<ShotDerivationDraft | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return (
      memoryState.shotDerivationDrafts.find(
        draft => draft.id === id && draft.userId === userId
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(shotDerivationDrafts)
    .where(
      and(
        eq(shotDerivationDrafts.id, id),
        eq(shotDerivationDrafts.userId, userId)
      )
    );
  return row ?? null;
}

export async function updateShotDerivationDraft(
  id: number,
  userId: number,
  data: Partial<InsertShotDerivationDraft>
): Promise<ShotDerivationDraft | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const row = memoryState.shotDerivationDrafts.find(
      draft => draft.id === id && draft.userId === userId
    );
    if (!row) return null;
    applyDefinedValues(
      row as unknown as Record<string, unknown>,
      data as unknown as Record<string, unknown>
    );
    row.updatedAt = now();
    await persistMemoryState();
    return row;
  }
  await db
    .update(shotDerivationDrafts)
    .set(data)
    .where(
      and(
        eq(shotDerivationDrafts.id, id),
        eq(shotDerivationDrafts.userId, userId)
      )
    );
  return getShotDerivationDraft(id, userId);
}

export async function createStoryOperation(
  data: Omit<InsertStoryOperation, "id" | "createdAt" | "updatedAt">
): Promise<StoryOperation> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const current = now();
    const row: StoryOperation = {
      id: nextMemoryId("storyOperation"),
      storyId: data.storyId,
      userId: data.userId,
      kind: data.kind,
      status: data.status ?? "applied",
      beforeState: data.beforeState,
      afterStoryRevision: data.afterStoryRevision,
      afterTimelineVersion: data.afterTimelineVersion,
      draftId: data.draftId ?? null,
      createdAt: current,
      updatedAt: current,
    };
    memoryState.storyOperations.push(row);
    await persistMemoryState();
    return row;
  }
  const [result] = await db.insert(storyOperations).values(data);
  const [row] = await db
    .select()
    .from(storyOperations)
    .where(eq(storyOperations.id, result.insertId));
  return row;
}

export async function getStoryOperation(
  id: number,
  userId: number
): Promise<StoryOperation | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return (
      memoryState.storyOperations.find(
        operation => operation.id === id && operation.userId === userId
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(storyOperations)
    .where(and(eq(storyOperations.id, id), eq(storyOperations.userId, userId)));
  return row ?? null;
}

export async function markStoryOperationReverted(
  id: number,
  userId: number
): Promise<void> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const row = memoryState.storyOperations.find(
      operation => operation.id === id && operation.userId === userId
    );
    if (row) {
      row.status = "reverted";
      row.updatedAt = now();
      await persistMemoryState();
    }
    return;
  }
  await db
    .update(storyOperations)
    .set({ status: "reverted" })
    .where(and(eq(storyOperations.id, id), eq(storyOperations.userId, userId)));
}

function revisionOf(body: unknown): number {
  if (!body || typeof body !== "object" || Array.isArray(body)) return 0;
  const value = (body as Record<string, unknown>)._revision;
  return typeof value === "number" && Number.isInteger(value) ? value : 0;
}

export async function confirmDerivedShotAtomic(input: {
  storyId: number;
  userId: number;
  draftId: number;
  selectedImageId: number;
  stableShotId: string;
  shotNo: string;
  expectedStoryRevision: number;
  expectedTimelineVersion: number;
  nextStoryBody: unknown;
  nextTimelineItems: unknown;
}): Promise<{ operation: StoryOperation; timelineVersion: number }> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const story = memoryState.stories.find(
      row => row.id === input.storyId && row.userId === input.userId
    );
    const draft = memoryState.shotDerivationDrafts.find(
      row =>
        row.id === input.draftId &&
        row.storyId === input.storyId &&
        row.userId === input.userId
    );
    const image = memoryState.generatedImages.find(
      row =>
        row.id === input.selectedImageId &&
        row.storyId === input.storyId &&
        (row.userId === input.userId || row.userId == null)
    );
    const timeline = memoryState.storyTimelines.find(
      row => row.storyId === input.storyId && row.userId === input.userId
    );
    if (!story || !draft || !image) throw new Error("派生草稿或候选图不存在");
    if (draft.status === "confirmed") {
      const existingOperation = memoryState.storyOperations.find(
        operation =>
          operation.storyId === input.storyId &&
          operation.userId === input.userId &&
          operation.draftId === input.draftId &&
          operation.kind === "derive_shot" &&
          operation.status === "applied"
      );
      if (existingOperation) {
        return {
          operation: existingOperation,
          timelineVersion: existingOperation.afterTimelineVersion,
        };
      }
    }
    if (draft.status !== "ready" && draft.status !== "draft") {
      throw new Error("派生草稿状态已变化");
    }
    if (revisionOf(story.body) !== input.expectedStoryRevision) {
      throw new Error("故事已经更新，请重新确认派生内容");
    }
    if ((timeline?.version ?? 0) !== input.expectedTimelineVersion) {
      throw new Error("时间轴已经更新，请重新确认插入位置");
    }
    const beforeState = {
      storyBody: story.body,
      timelineItems: timeline?.items ?? null,
      timelineVersion: timeline?.version ?? 0,
      image: {
        id: image.id,
        shotNo: image.shotNo,
        shotIdentity: image.shotIdentity,
        isCurrent: image.isCurrent,
      },
      draftStatus: draft.status,
    };
    story.body = input.nextStoryBody;
    story.updatedAt = now();
    for (const candidate of memoryState.generatedImages) {
      if (
        candidate.storyId === input.storyId &&
        candidate.shotIdentity === input.stableShotId
      ) {
        candidate.isCurrent = candidate.id === image.id;
      }
    }
    image.shotNo = input.shotNo;
    image.shotIdentity = input.stableShotId;
    image.isCurrent = true;
    memoryState.imageSignals.push({
      id: nextMemoryId("imageSignal"),
      userId: input.userId,
      storyId: input.storyId,
      imageId: image.id,
      action: "swipe_right",
      metadata: { source: "derive_shot", draftId: input.draftId },
      createdAt: now(),
    });
    let timelineVersion: number;
    if (timeline) {
      timeline.items = replaceStoryTimelineItemsPreservingOverlays(
        timeline.items,
        input.nextTimelineItems
      );
      timeline.version += 1;
      timeline.updatedAt = now();
      timelineVersion = timeline.version;
    } else {
      const current = now();
      timelineVersion = 1;
      memoryState.storyTimelines.push({
        id: nextMemoryId("storyTimeline"),
        storyId: input.storyId,
        userId: input.userId,
        version: timelineVersion,
        items: input.nextTimelineItems,
        createdAt: current,
        updatedAt: current,
      });
    }
    draft.status = "confirmed";
    draft.updatedAt = now();
    const operation: StoryOperation = {
      id: nextMemoryId("storyOperation"),
      storyId: input.storyId,
      userId: input.userId,
      kind: "derive_shot",
      status: "applied",
      beforeState,
      afterStoryRevision: revisionOf(input.nextStoryBody),
      afterTimelineVersion: timelineVersion,
      draftId: input.draftId,
      createdAt: now(),
      updatedAt: now(),
    };
    memoryState.storyOperations.push(operation);
    await persistMemoryState();
    return { operation, timelineVersion };
  }

  return db.transaction(async tx => {
    const [story] = await tx
      .select()
      .from(stories)
      .where(
        and(eq(stories.id, input.storyId), eq(stories.userId, input.userId))
      )
      .for("update")
      .limit(1);
    const [draft] = await tx
      .select()
      .from(shotDerivationDrafts)
      .where(
        and(
          eq(shotDerivationDrafts.id, input.draftId),
          eq(shotDerivationDrafts.storyId, input.storyId),
          eq(shotDerivationDrafts.userId, input.userId)
        )
      )
      .for("update")
      .limit(1);
    const [image] = await tx
      .select()
      .from(generatedImages)
      .where(
        and(
          eq(generatedImages.id, input.selectedImageId),
          eq(generatedImages.storyId, input.storyId),
          or(
            eq(generatedImages.userId, input.userId),
            isNull(generatedImages.userId)
          )
        )
      )
      .for("update")
      .limit(1);
    const [timeline] = await tx
      .select()
      .from(storyTimelines)
      .where(
        and(
          eq(storyTimelines.storyId, input.storyId),
          eq(storyTimelines.userId, input.userId)
        )
      )
      .for("update")
      .limit(1);
    if (!story || !draft || !image) throw new Error("派生草稿或候选图不存在");
    if (draft.status === "confirmed") {
      const [existingOperation] = await tx
        .select()
        .from(storyOperations)
        .where(
          and(
            eq(storyOperations.storyId, input.storyId),
            eq(storyOperations.userId, input.userId),
            eq(storyOperations.draftId, input.draftId),
            eq(storyOperations.kind, "derive_shot"),
            eq(storyOperations.status, "applied")
          )
        )
        .limit(1);
      if (existingOperation) {
        return {
          operation: existingOperation,
          timelineVersion: existingOperation.afterTimelineVersion,
        };
      }
    }
    if (draft.status !== "ready" && draft.status !== "draft") {
      throw new Error("派生草稿状态已变化");
    }
    if (revisionOf(story.body) !== input.expectedStoryRevision) {
      throw new Error("故事已经更新，请重新确认派生内容");
    }
    if ((timeline?.version ?? 0) !== input.expectedTimelineVersion) {
      throw new Error("时间轴已经更新，请重新确认插入位置");
    }
    const beforeState = {
      storyBody: story.body,
      timelineItems: timeline?.items ?? null,
      timelineVersion: timeline?.version ?? 0,
      image: {
        id: image.id,
        shotNo: image.shotNo,
        shotIdentity: image.shotIdentity,
        isCurrent: image.isCurrent,
      },
      draftStatus: draft.status,
    };
    await tx
      .update(stories)
      .set({ body: input.nextStoryBody })
      .where(eq(stories.id, story.id));
    await tx
      .update(generatedImages)
      .set({ isCurrent: false })
      .where(
        and(
          eq(generatedImages.storyId, input.storyId),
          eq(generatedImages.shotIdentity, input.stableShotId)
        )
      );
    await tx
      .update(generatedImages)
      .set({
        shotNo: input.shotNo,
        shotIdentity: input.stableShotId,
        isCurrent: true,
      })
      .where(eq(generatedImages.id, image.id));
    await tx.insert(imageSignals).values({
      userId: input.userId,
      storyId: input.storyId,
      imageId: image.id,
      action: "swipe_right",
      metadata: { source: "derive_shot", draftId: input.draftId },
    });
    let timelineVersion: number;
    if (timeline) {
      timelineVersion = timeline.version + 1;
      await tx
        .update(storyTimelines)
        .set({
          items: replaceStoryTimelineItemsPreservingOverlays(
            timeline.items,
            input.nextTimelineItems
          ),
          version: timelineVersion,
        })
        .where(eq(storyTimelines.id, timeline.id));
    } else {
      timelineVersion = 1;
      await tx.insert(storyTimelines).values({
        storyId: input.storyId,
        userId: input.userId,
        version: timelineVersion,
        items: input.nextTimelineItems,
      });
    }
    await tx
      .update(shotDerivationDrafts)
      .set({ status: "confirmed" })
      .where(eq(shotDerivationDrafts.id, draft.id));
    const [result] = await tx.insert(storyOperations).values({
      storyId: input.storyId,
      userId: input.userId,
      kind: "derive_shot",
      status: "applied",
      beforeState,
      afterStoryRevision: revisionOf(input.nextStoryBody),
      afterTimelineVersion: timelineVersion,
      draftId: input.draftId,
    });
    const [operation] = await tx
      .select()
      .from(storyOperations)
      .where(eq(storyOperations.id, result.insertId));
    return { operation, timelineVersion };
  });
}

export async function undoDerivedShotAtomic(
  operationId: number,
  userId: number
): Promise<void> {
  type DerivationBeforeState = {
    storyBody?: unknown;
    timelineItems?: unknown;
    timelineVersion?: number;
    image?: {
      id?: number;
      shotNo?: string | null;
      shotIdentity?: string | null;
      isCurrent?: boolean;
    };
    draftStatus?: ShotDerivationDraft["status"];
  };

  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const operation = memoryState.storyOperations.find(
      row => row.id === operationId && row.userId === userId
    );
    if (!operation || operation.status !== "applied") {
      throw new Error("撤销记录不存在或已经撤销");
    }
    const before = operation.beforeState as DerivationBeforeState;
    const story = memoryState.stories.find(
      row => row.id === operation.storyId && row.userId === userId
    );
    const timeline = memoryState.storyTimelines.find(
      row => row.storyId === operation.storyId && row.userId === userId
    );
    if (
      !story ||
      revisionOf(story.body) !== operation.afterStoryRevision ||
      (timeline?.version ?? 0) !== operation.afterTimelineVersion
    ) {
      throw new Error("派生后已有新的编辑，不能直接撤销");
    }
    const image =
      before.image?.id != null
        ? memoryState.generatedImages.find(
            row =>
              row.id === before.image?.id &&
              row.storyId === operation.storyId &&
              (row.userId === userId || row.userId == null)
          )
        : null;
    const draft =
      operation.draftId != null
        ? memoryState.shotDerivationDrafts.find(
            row =>
              row.id === operation.draftId &&
              row.storyId === operation.storyId &&
              row.userId === userId
          )
        : null;
    const snapshot = {
      storyBody: story.body,
      storyUpdatedAt: story.updatedAt,
      timelineItems: timeline?.items,
      timelineVersion: timeline?.version,
      timelineUpdatedAt: timeline?.updatedAt,
      image: image
        ? {
            shotNo: image.shotNo,
            shotIdentity: image.shotIdentity,
            isCurrent: image.isCurrent,
          }
        : null,
      draftStatus: draft?.status,
      draftUpdatedAt: draft?.updatedAt,
      operationStatus: operation.status,
      operationUpdatedAt: operation.updatedAt,
      imageSignals: [...memoryState.imageSignals],
    };
    try {
      const changedAt = now();
      story.body = before.storyBody;
      story.updatedAt = changedAt;
      if (timeline) {
        timeline.items = replaceStoryTimelineItemsPreservingOverlays(
          timeline.items,
          before.timelineItems ?? []
        );
        timeline.version += 1;
        timeline.updatedAt = changedAt;
      }
      if (image) {
        image.shotNo = before.image?.shotNo ?? null;
        image.shotIdentity = before.image?.shotIdentity ?? null;
        image.isCurrent = before.image?.isCurrent ?? false;
      }
      if (draft) {
        draft.status = "reverted";
        draft.updatedAt = changedAt;
      }
      memoryState.imageSignals = memoryState.imageSignals.filter(signal => {
        if (
          signal.userId !== userId ||
          signal.storyId !== operation.storyId ||
          signal.action !== "swipe_right"
        ) {
          return true;
        }
        const metadata =
          signal.metadata &&
          typeof signal.metadata === "object" &&
          !Array.isArray(signal.metadata)
            ? (signal.metadata as Record<string, unknown>)
            : {};
        return !(
          metadata.source === "derive_shot" &&
          Number(metadata.draftId) === operation.draftId
        );
      });
      operation.status = "reverted";
      operation.updatedAt = changedAt;
      await persistMemoryState();
    } catch (error) {
      story.body = snapshot.storyBody;
      story.updatedAt = snapshot.storyUpdatedAt;
      if (timeline) {
        timeline.items = snapshot.timelineItems;
        timeline.version = snapshot.timelineVersion!;
        timeline.updatedAt = snapshot.timelineUpdatedAt!;
      }
      if (image && snapshot.image) {
        image.shotNo = snapshot.image.shotNo;
        image.shotIdentity = snapshot.image.shotIdentity;
        image.isCurrent = snapshot.image.isCurrent;
      }
      if (draft && snapshot.draftStatus && snapshot.draftUpdatedAt) {
        draft.status = snapshot.draftStatus;
        draft.updatedAt = snapshot.draftUpdatedAt;
      }
      operation.status = snapshot.operationStatus;
      operation.updatedAt = snapshot.operationUpdatedAt;
      memoryState.imageSignals = snapshot.imageSignals;
      throw error;
    }
    return;
  }

  await db.transaction(async tx => {
    const [operation] = await tx
      .select()
      .from(storyOperations)
      .where(
        and(
          eq(storyOperations.id, operationId),
          eq(storyOperations.userId, userId)
        )
      )
      .for("update")
      .limit(1);
    if (!operation || operation.status !== "applied") {
      throw new Error("撤销记录不存在或已经撤销");
    }
    const before = operation.beforeState as DerivationBeforeState;
    const [story] = await tx
      .select()
      .from(stories)
      .where(and(eq(stories.id, operation.storyId), eq(stories.userId, userId)))
      .for("update")
      .limit(1);
    const [timeline] = await tx
      .select()
      .from(storyTimelines)
      .where(
        and(
          eq(storyTimelines.storyId, operation.storyId),
          eq(storyTimelines.userId, userId)
        )
      )
      .for("update")
      .limit(1);
    if (
      !story ||
      revisionOf(story.body) !== operation.afterStoryRevision ||
      (timeline?.version ?? 0) !== operation.afterTimelineVersion
    ) {
      throw new Error("派生后已有新的编辑，不能直接撤销");
    }
    await tx
      .update(stories)
      .set({ body: before.storyBody })
      .where(eq(stories.id, story.id));
    if (timeline) {
      await tx
        .update(storyTimelines)
        .set({
          items: before.timelineItems ?? [],
          version: timeline.version + 1,
        })
        .where(eq(storyTimelines.id, timeline.id));
    }
    if (before.image?.id != null) {
      await tx
        .update(generatedImages)
        .set({
          shotNo: before.image.shotNo ?? null,
          shotIdentity: before.image.shotIdentity ?? null,
          isCurrent: before.image.isCurrent ?? false,
        })
        .where(
          and(
            eq(generatedImages.id, before.image.id),
            eq(generatedImages.storyId, operation.storyId),
            or(
              eq(generatedImages.userId, userId),
              isNull(generatedImages.userId)
            )
          )
        );
    }
    if (operation.draftId != null) {
      await tx
        .update(shotDerivationDrafts)
        .set({ status: "reverted" })
        .where(
          and(
            eq(shotDerivationDrafts.id, operation.draftId),
            eq(shotDerivationDrafts.storyId, operation.storyId),
            eq(shotDerivationDrafts.userId, userId)
          )
        );
      await tx
        .delete(imageSignals)
        .where(
          and(
            eq(imageSignals.storyId, operation.storyId),
            eq(imageSignals.userId, userId),
            eq(imageSignals.action, "swipe_right"),
            sql`JSON_UNQUOTE(JSON_EXTRACT(${imageSignals.metadata}, '$.source')) = 'derive_shot'`,
            sql`CAST(JSON_UNQUOTE(JSON_EXTRACT(${imageSignals.metadata}, '$.draftId')) AS UNSIGNED) = ${operation.draftId}`
          )
        );
    }
    await tx
      .update(storyOperations)
      .set({ status: "reverted" })
      .where(eq(storyOperations.id, operation.id));
  });
}

/**
 * Reset in-memory state and loaded flag — for use in tests only.
 * Prevents accumulated state from prior test runs from leaking between tests.
 */
/**
 * 用途：测试专用——按指定 id 直接种一行归属明确的 project。项目级归属校验落地后，
 *   拿一个凭空的 projectId 调接口会被正确拒绝，而不少既有测试正是这么写的（断言
 *   里还钉着那个字面量 id）。与其改掉这些断言，不如让测试先把这行数据真正建出来，
 *   保持"接口只接受属于自己的 project"这条不变量在测试里也成立。
 * 调用入口：server/*.test.ts（仅测试）。
 * 下游调用：无，直接写 memoryState.projects。
 */
export function seedProjectForTesting(input: {
  id: number;
  userId: number;
  name?: string;
}): void {
  const current = now();
  memoryState.projects = memoryState.projects.filter(
    project => project.id !== input.id
  );
  memoryState.projects.push({
    id: input.id,
    userId: input.userId,
    name: input.name ?? `测试项目 ${input.id}`,
    deadline: null,
    autoRender: false,
    createdAt: current,
    updatedAt: current,
  });
}

export function resetMemoryStateForTesting(): void {
  memoryState.users = [];
  memoryState.accessSessions = [];
  memoryState.projects = [];
  memoryState.references = [];
  memoryState.shots = [];
  memoryState.analysisResults = [];
  memoryState.emotionAnalysisProfiles = [];
  memoryState.emotionDailyLetters = [];
  memoryState.stories = [];
  memoryState.editSnapshots = [];
  memoryState.semanticAnnotations = [];
  memoryState.generatedImages = [];
  memoryState.previewMaskedImageOperations = [];
  memoryState.timelineFrameExtractionOperations = [];
  memoryState.imageSignals = [];
  memoryState.videoTakes = [];
  memoryState.videoTakeRanges = [];
  memoryState.videoTimelineSelections = [];
  memoryState.storyTimelines = [];
  memoryState.storyAudioAssets = [];
  memoryState.storyAudioImportOperations = [];
  memoryState.shotDerivationDrafts = [];
  memoryState.storyOperations = [];
  memoryState.inviteCodes = [];
  memoryState.creditAccounts = [];
  memoryState.creditLedgerEntries = [];
  memoryState.creditHolds = [];
  memoryState.billingOperations = [];
  memoryState.providerAttempts = [];
  memoryState.accountIdentities = [];
  memoryState.accountCredentials = [];
  memoryState.accountVerificationChallenges = [];
  memoryState.accountRateLimits = [];
  memoryState.promptLineage = createEmptyPromptLineageLocalState();
  memoryState.personalMemory = createEmptyPersonalMemoryLocalState();
  promptLineageLoaded = true;
  promptLineageLoadFallback = undefined;
  editSnapshotsLoaded = true;
  editSnapshotsLoadFallback = undefined;
  memoryState.nextIds = {
    user: 1,
    accessSession: 1,
    project: 1,
    reference: 1,
    shot: 1,
    analysisResult: 1,
    emotionAnalysisProfile: 1,
    emotionDailyLetter: 1,
    story: 1,
    editSnapshot: 1,
    semanticAnnotation: 1,
    generatedImage: 1,
    previewMaskedImageOperation: 1,
    timelineFrameExtractionOperation: 1,
    imageSignal: 1,
    videoTake: 1,
    videoTakeRange: 1,
    videoTimelineSelection: 1,
    storyTimeline: 1,
    storyAudioAsset: 1,
    storyAudioImportOperation: 1,
    shotDerivationDraft: 1,
    storyOperation: 1,
    inviteCode: 1,
    creditAccount: 1,
    creditLedgerEntry: 1,
    creditHold: 1,
    billingOperation: 1,
    providerAttempt: 1,
    accountIdentity: 1,
    accountCredential: 1,
    accountVerificationChallenge: 1,
    accountRateLimit: 1,
  };
  defaultProjectLocks.clear();
  timelineFrameExtractionMemoryLock.clear();
  previewMaskedImageMemoryLock.clear();
  memoryVideoTakeSubmissionClaimQueue = Promise.resolve();
  memoryInviteClaimQueue = Promise.resolve();
  memoryEmailOtps = [];
  nextMemoryEmailOtpId = 1;
  // Mark as loaded so subsequent calls don't reload stale data from disk.
  memoryLoaded = true;
  memoryLoadPromise = null;
}

// ── Email OTP 相关函数 ──────────────────────────────────────────────

/** 创建邮箱验证码记录 */
export async function createEmailOtp(
  email: string,
  code: string,
  expiresAt: Date
): Promise<void> {
  const db = await getDb();
  if (!db) {
    memoryEmailOtps.push({
      id: nextMemoryEmailOtpId++,
      email,
      code,
      expiresAt,
      usedAt: null,
      createdAt: new Date(),
    });
    return;
  }
  await db.insert(emailOtps).values({ email, code, expiresAt });
}

/** 查找有效（未过期、未使用）的 OTP */
export async function findValidEmailOtp(
  email: string,
  code: string
): Promise<EmailOtp | null> {
  const db = await getDb();
  if (!db) {
    const current = Date.now();
    return (
      [...memoryEmailOtps]
        .reverse()
        .find(
          otp =>
            otp.email === email &&
            otp.code === code &&
            otp.expiresAt.getTime() >= current &&
            !otp.usedAt
        ) ?? null
    );
  }
  const [otp] = await db
    .select()
    .from(emailOtps)
    .where(
      and(
        eq(emailOtps.email, email),
        eq(emailOtps.code, code),
        gte(emailOtps.expiresAt, new Date()),
        isNull(emailOtps.usedAt)
      )
    )
    .limit(1);
  return otp ?? null;
}

/** 标记 OTP 已使用 */
export async function markEmailOtpUsed(id: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    const otp = memoryEmailOtps.find(item => item.id === id);
    if (otp) otp.usedAt = new Date();
    return;
  }
  await db
    .update(emailOtps)
    .set({ usedAt: new Date() })
    .where(eq(emailOtps.id, id));
}

// ── 内测邀请码相关函数 ──────────────────────────────────────────────

export type InviteOverviewRow = {
  id: number;
  label: string | null;
  status: "pending" | "redeemed" | "expired";
  redeemedByEmail: string | null;
  redeemedByUserId: number | null;
  userName: string | null;
  userEmail: string | null;
  expiresAt: Date | null;
  redeemedAt: Date | null;
  createdAt: Date;
};

/**
 * 管理员邀请概览。只返回可展示的状态字段，不暴露不可逆的邀请码哈希。
 */
export async function getInviteOverview(
  generatedAt = new Date()
): Promise<InviteOverviewRow[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
  }

  const rows = !db
    ? memoryState.inviteCodes.map(invite => {
        const user =
          invite.redeemedByUserId == null
            ? undefined
            : memoryState.users.find(
                candidate => candidate.id === invite.redeemedByUserId
              );
        return {
          id: invite.id,
          label: invite.label,
          redeemedByEmail: invite.redeemedByEmail,
          redeemedByUserId: invite.redeemedByUserId,
          userName: user?.name ?? null,
          userEmail: user?.email ?? null,
          expiresAt: invite.expiresAt,
          redeemedAt: invite.redeemedAt,
          createdAt: invite.createdAt,
        };
      })
    : await db
        .select({
          id: inviteCodes.id,
          label: inviteCodes.label,
          redeemedByEmail: inviteCodes.redeemedByEmail,
          redeemedByUserId: inviteCodes.redeemedByUserId,
          userName: users.name,
          userEmail: users.email,
          expiresAt: inviteCodes.expiresAt,
          redeemedAt: inviteCodes.redeemedAt,
          createdAt: inviteCodes.createdAt,
        })
        .from(inviteCodes)
        .leftJoin(users, eq(inviteCodes.redeemedByUserId, users.id))
        .orderBy(desc(inviteCodes.createdAt));

  return rows
    .map(row => ({
      ...row,
      status: row.redeemedAt
        ? ("redeemed" as const)
        : row.expiresAt && row.expiresAt < generatedAt
          ? ("expired" as const)
          : ("pending" as const),
    }))
    .sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
    );
}

export async function createInviteCode(
  data: Pick<InsertInviteCode, "codeHash" | "label" | "expiresAt">
): Promise<{ id: number }> {
  const db = await getDb();
  if (!db) {
    const row: InviteCode = {
      id: nextMemoryId("inviteCode"),
      codeHash: data.codeHash,
      label: data.label ?? null,
      redeemedByEmail: null,
      redeemedByUserId: null,
      expiresAt: data.expiresAt ?? null,
      redeemedAt: null,
      createdAt: new Date(),
    };
    memoryState.inviteCodes.push(row);
    await persistMemoryState();
    return { id: row.id };
  }

  const result = await db.insert(inviteCodes).values(data);
  return { id: result[0].insertId };
}

export async function findAvailableInviteCode(
  codeHash: string
): Promise<InviteCode | null> {
  const db = await getDb();
  const current = new Date();
  if (!db) {
    return (
      memoryState.inviteCodes.find(
        item =>
          item.codeHash === codeHash &&
          !item.redeemedAt &&
          (!item.expiresAt || item.expiresAt >= current)
      ) ?? null
    );
  }

  const [invite] = await db
    .select()
    .from(inviteCodes)
    .where(
      and(
        eq(inviteCodes.codeHash, codeHash),
        isNull(inviteCodes.redeemedAt),
        or(isNull(inviteCodes.expiresAt), gte(inviteCodes.expiresAt, current))
      )
    )
    .limit(1);
  return invite ?? null;
}

/**
 * 校验邀请码是否可以由指定邮箱使用。未核销邀请码可用于首次登录；
 * 已核销邀请码只允许继续服务它最初绑定的邮箱。
 */
export async function findInviteCodeForEmailAccess(
  codeHash: string,
  email: string
): Promise<InviteCode | null> {
  const db = await getDb();
  const current = new Date();
  if (!db) {
    const invite =
      memoryState.inviteCodes.find(item => item.codeHash === codeHash) ?? null;
    if (!invite) return null;
    if (invite.redeemedAt) {
      return invite.redeemedByEmail === email ? invite : null;
    }
    return !invite.expiresAt || invite.expiresAt >= current ? invite : null;
  }

  const [invite] = await db
    .select()
    .from(inviteCodes)
    .where(eq(inviteCodes.codeHash, codeHash))
    .limit(1);
  if (!invite) return null;
  if (invite.redeemedAt) {
    return invite.redeemedByEmail === email ? invite : null;
  }
  return !invite.expiresAt || invite.expiresAt >= current ? invite : null;
}

export async function hasRedeemedInviteForEmail(
  email: string
): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    return memoryState.inviteCodes.some(
      item => item.redeemedByEmail === email && Boolean(item.redeemedAt)
    );
  }

  const [invite] = await db
    .select({ id: inviteCodes.id })
    .from(inviteCodes)
    .where(
      and(
        eq(inviteCodes.redeemedByEmail, email),
        isNotNull(inviteCodes.redeemedAt)
      )
    )
    .limit(1);
  return Boolean(invite);
}

/**
 * 将邀请码原子绑定到邮箱。相同邮箱重试同一邀请码视为成功，方便外部服务失败后重试。
 */
export async function redeemInviteForEmail(
  codeHash: string,
  email: string
): Promise<InviteCode | null> {
  const db = await getDb();
  const current = new Date();
  if (!db) {
    let claimed: InviteCode | null = null;
    const operation = memoryInviteClaimQueue.then(async () => {
      const invite = memoryState.inviteCodes.find(
        item => item.codeHash === codeHash
      );
      if (!invite) return;
      if (invite.redeemedAt) {
        if (invite.redeemedByEmail === email) claimed = { ...invite };
        return;
      }
      if (invite.expiresAt && invite.expiresAt < current) return;

      invite.redeemedByEmail = email;
      invite.redeemedAt = current;
      claimed = { ...invite };
      await persistMemoryState();
    });
    memoryInviteClaimQueue = operation.catch(() => {});
    await operation;
    return claimed;
  }

  const [existing] = await db
    .select()
    .from(inviteCodes)
    .where(eq(inviteCodes.codeHash, codeHash))
    .limit(1);
  if (!existing) return null;
  if (existing.redeemedAt) {
    return existing.redeemedByEmail === email ? existing : null;
  }
  if (existing.expiresAt && existing.expiresAt < current) return null;

  const result = await db
    .update(inviteCodes)
    .set({
      redeemedByEmail: email,
      redeemedAt: current,
    })
    .where(
      and(
        eq(inviteCodes.id, existing.id),
        isNull(inviteCodes.redeemedAt),
        or(isNull(inviteCodes.expiresAt), gte(inviteCodes.expiresAt, current))
      )
    );
  if (result[0].affectedRows !== 1) {
    const [claimed] = await db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.id, existing.id))
      .limit(1);
    return claimed?.redeemedByEmail === email ? claimed : null;
  }

  return {
    ...existing,
    redeemedByEmail: email,
    redeemedAt: current,
  };
}

export async function bindRedeemedInviteToUser(
  email: string,
  userId: number
): Promise<void> {
  const db = await getDb();
  if (!db) {
    const invite = memoryState.inviteCodes.find(
      item => item.redeemedByEmail === email && Boolean(item.redeemedAt)
    );
    if (!invite || invite.redeemedByUserId === userId) return;
    invite.redeemedByUserId = userId;
    await persistMemoryState();
    return;
  }

  await db
    .update(inviteCodes)
    .set({ redeemedByUserId: userId })
    .where(
      and(
        eq(inviteCodes.redeemedByEmail, email),
        isNotNull(inviteCodes.redeemedAt)
      )
    );
}

// ══════════════════════════════════════════════════════════════════════
// 算力账本：不可改写的逐笔记录 + 事务内预占
//
// 事实来源是 append-only 的 credit_ledger_entries；credit_accounts 只是账本在
// 事务里维护的派生投影，存在的意义是让「检查余额 → 预占」能在一条
// SELECT ... FOR UPDATE 里原子完成，而不是每次去 SUM 全表。
//
// 这里**没有**通用的「直接设置余额」。人工调整也是新增一条 adjustment，
// 既有消费事实不可 update、不可 delete。
//
// 预占与结算是两个独立的短事务：供应商网络调用发生在它们之间，任何路径都不
// 跨网络持有余额行的锁。
// ══════════════════════════════════════════════════════════════════════

const memoryCreditAccountLock = createKeyedSerialLock<number>();

export type CreditAccountSummary = {
  userId: number;
  /** 已入账余额（微元） */
  balanceMinor: number;
  /** 活动预占合计（微元） */
  reservedMinor: number;
  /** 累计消费（微元） */
  lifetimeSpentMinor: number;
  /** 可用余额 = balanceMinor − reservedMinor */
  availableMinor: number;
  accessEnabledAt: Date | null;
};

function summarizeCreditAccount(
  userId: number,
  row: Pick<
    CreditAccount,
    "balanceMinor" | "reservedMinor" | "lifetimeSpentMinor" | "accessEnabledAt"
  > | null
): CreditAccountSummary {
  const balanceMinor = Number(row?.balanceMinor ?? 0);
  const reservedMinor = Number(row?.reservedMinor ?? 0);
  return {
    userId,
    balanceMinor,
    reservedMinor,
    lifetimeSpentMinor: Number(row?.lifetimeSpentMinor ?? 0),
    availableMinor: balanceMinor - reservedMinor,
    accessEnabledAt: row?.accessEnabledAt ?? null,
  };
}

function memoryCreditAccountRow(userId: number): CreditAccount {
  let row = memoryState.creditAccounts.find(item => item.userId === userId);
  if (!row) {
    const current = now();
    row = {
      id: nextMemoryId("creditAccount"),
      userId,
      balanceMinor: 0,
      reservedMinor: 0,
      lifetimeSpentMinor: 0,
      currency: "CNY",
      accessEnabledAt: null,
      createdAt: current,
      updatedAt: current,
    };
    memoryState.creditAccounts.push(row);
  }
  return row;
}

export async function getCreditAccountSummary(
  userId: number
): Promise<CreditAccountSummary> {
  const db = await getDb();
  if (!db) {
    const row =
      memoryState.creditAccounts.find(item => item.userId === userId) ?? null;
    return summarizeCreditAccount(userId, row);
  }

  const [row] = await db
    .select()
    .from(creditAccounts)
    .where(eq(creditAccounts.userId, userId))
    .limit(1);
  return summarizeCreditAccount(userId, row ?? null);
}

export type ReserveComputeCreditInput = {
  userId: number;
  operationId: string;
  operationType: string;
  requestHash: string;
  /** 可信最高费用（微元），必须为正 */
  amountMinor: number;
  storyId?: number | null;
  quoteExpiresAt?: Date | null;
};

export type ReserveComputeCreditResult =
  | { kind: "reserved"; availableMinor: number }
  /** 同一 operationId 已存在。调用方比对 requestHash 决定是重放还是冲突 */
  | {
      kind: "existing";
      status: BillingOperation["status"];
      requestHash: string;
    }
  | { kind: "insufficient"; availableMinor: number; requiredMinor: number };

/**
 * 在一个短事务里锁定账号余额行、检查可用余额、建立 operation 与 hold。
 *
 * 可用余额的比较必须发生在锁内——这是并发两个预占不能同时通过的唯一保证。
 * 业务侧的重放/冲突/上界/报价判断在 `computeBilling.planReservation` 里，
 * 这里只做那件必须原子的事。
 */
export async function reserveComputeCredit(
  input: ReserveComputeCreditInput
): Promise<ReserveComputeCreditResult> {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error(`预占金额必须是正的安全整数微元：${input.amountMinor}`);
  }

  const db = await getDb();
  if (!db) {
    return memoryCreditAccountLock.run(input.userId, async () => {
      const existing = memoryState.billingOperations.find(
        item => item.operationId === input.operationId
      );
      if (existing) {
        return {
          kind: "existing" as const,
          status: existing.status,
          requestHash: existing.requestHash,
        };
      }

      const account = memoryCreditAccountRow(input.userId);
      const availableMinor =
        Number(account.balanceMinor) - Number(account.reservedMinor);
      if (availableMinor < input.amountMinor) {
        return {
          kind: "insufficient" as const,
          availableMinor,
          requiredMinor: input.amountMinor,
        };
      }

      const current = now();
      memoryState.billingOperations.push({
        id: nextMemoryId("billingOperation"),
        userId: input.userId,
        operationId: input.operationId,
        operationType: input.operationType,
        requestHash: input.requestHash,
        status: "reserved",
        maxCostMinor: input.amountMinor,
        actualCostMinor: null,
        storyId: input.storyId ?? null,
        quoteExpiresAt: input.quoteExpiresAt ?? null,
        createdAt: current,
        updatedAt: current,
      });
      memoryState.creditHolds.push({
        id: nextMemoryId("creditHold"),
        userId: input.userId,
        operationId: input.operationId,
        amountMinor: input.amountMinor,
        status: "active",
        createdAt: current,
        updatedAt: current,
      });
      account.reservedMinor = Number(account.reservedMinor) + input.amountMinor;
      account.updatedAt = current;
      await persistMemoryState();
      return {
        kind: "reserved" as const,
        availableMinor: availableMinor - input.amountMinor,
      };
    });
  }

  return db.transaction(async tx => {
    await tx
      .insert(creditAccounts)
      .values({ userId: input.userId })
      .onDuplicateKeyUpdate({ set: { userId: input.userId } });

    const [account] = await tx
      .select()
      .from(creditAccounts)
      .where(eq(creditAccounts.userId, input.userId))
      .for("update")
      .limit(1);

    const [existing] = await tx
      .select()
      .from(billingOperations)
      .where(eq(billingOperations.operationId, input.operationId))
      .limit(1);
    if (existing) {
      return {
        kind: "existing" as const,
        status: existing.status,
        requestHash: existing.requestHash,
      };
    }

    const availableMinor =
      Number(account?.balanceMinor ?? 0) - Number(account?.reservedMinor ?? 0);
    if (availableMinor < input.amountMinor) {
      return {
        kind: "insufficient" as const,
        availableMinor,
        requiredMinor: input.amountMinor,
      };
    }

    await tx.insert(billingOperations).values({
      userId: input.userId,
      operationId: input.operationId,
      operationType: input.operationType,
      requestHash: input.requestHash,
      status: "reserved",
      maxCostMinor: input.amountMinor,
      storyId: input.storyId ?? null,
      quoteExpiresAt: input.quoteExpiresAt ?? null,
    });
    await tx.insert(creditHolds).values({
      userId: input.userId,
      operationId: input.operationId,
      amountMinor: input.amountMinor,
      status: "active",
    });
    await tx
      .update(creditAccounts)
      .set({
        reservedMinor: sql`${creditAccounts.reservedMinor} + ${input.amountMinor}`,
      })
      .where(eq(creditAccounts.userId, input.userId));

    return {
      kind: "reserved" as const,
      availableMinor: availableMinor - input.amountMinor,
    };
  });
}

export type ApplyComputeSettlementInput = {
  operationId: string;
  /** 实际扣款（微元），可以是 0 */
  chargeMinor: number;
  /** 放回的预占（微元），可以是 0 */
  releaseMinor: number;
  nextOperationStatus: BillingOperation["status"];
  nextHoldStatus: CreditHold["status"];
  reason?: string | null;
};

export type ApplyComputeSettlementResult =
  | {
      kind: "applied";
      balanceMinor: number;
      reservedMinor: number;
      lifetimeSpentMinor: number;
      chargeMinor: number;
    }
  /** operation 已处于终态：最终结算只发生一次 */
  | { kind: "already_final"; status: BillingOperation["status"] }
  | { kind: "missing" };

/**
 * 结算/释放/冻结：一个独立的短事务，发生在供应商调用之后。
 *
 * 幂等靠两层：operation 的终态检查（在锁内）+ 账本 `idempotencyKey` 的唯一约束。
 * 重放同一次结算只会得到 `already_final`，不会二次扣费。
 */
export async function applyComputeSettlement(
  input: ApplyComputeSettlementInput
): Promise<ApplyComputeSettlementResult> {
  const chargeMinor = Number(input.chargeMinor);
  const releaseMinor = Number(input.releaseMinor);
  if (
    !Number.isSafeInteger(chargeMinor) ||
    !Number.isSafeInteger(releaseMinor) ||
    chargeMinor < 0 ||
    releaseMinor < 0
  ) {
    throw new Error("结算金额必须是非负的安全整数微元");
  }
  const reservedDelta = chargeMinor + releaseMinor;
  const finalStatuses = new Set(["settled", "released", "exception"]);

  const db = await getDb();
  if (!db) {
    const operationPeek = memoryState.billingOperations.find(
      item => item.operationId === input.operationId
    );
    if (!operationPeek) return { kind: "missing" };

    return memoryCreditAccountLock.run(operationPeek.userId, async () => {
      const operation = memoryState.billingOperations.find(
        item => item.operationId === input.operationId
      );
      if (!operation) return { kind: "missing" as const };
      if (finalStatuses.has(operation.status)) {
        return { kind: "already_final" as const, status: operation.status };
      }

      const account = memoryCreditAccountRow(operation.userId);
      const current = now();
      if (chargeMinor > 0 || input.nextOperationStatus === "settled") {
        memoryState.creditLedgerEntries.push({
          id: nextMemoryId("creditLedgerEntry"),
          userId: operation.userId,
          entryType: "consumption",
          amountMinor: -chargeMinor,
          currency: "CNY",
          idempotencyKey: `consume:${input.operationId}`,
          operationId: input.operationId,
          giftCardId: null,
          actorUserId: null,
          reason: input.reason ?? null,
          createdAt: current,
        });
        account.balanceMinor = Number(account.balanceMinor) - chargeMinor;
        account.lifetimeSpentMinor =
          Number(account.lifetimeSpentMinor) + chargeMinor;
      }
      account.reservedMinor = Number(account.reservedMinor) - reservedDelta;
      account.updatedAt = current;

      operation.status = input.nextOperationStatus;
      operation.actualCostMinor = finalStatuses.has(input.nextOperationStatus)
        ? chargeMinor
        : operation.actualCostMinor;
      operation.updatedAt = current;

      const hold = memoryState.creditHolds.find(
        item => item.operationId === input.operationId
      );
      if (hold) {
        hold.status = input.nextHoldStatus;
        hold.updatedAt = current;
      }
      await persistMemoryState();
      return {
        kind: "applied" as const,
        balanceMinor: Number(account.balanceMinor),
        reservedMinor: Number(account.reservedMinor),
        lifetimeSpentMinor: Number(account.lifetimeSpentMinor),
        chargeMinor,
      };
    });
  }

  return db.transaction(async tx => {
    const [operation] = await tx
      .select()
      .from(billingOperations)
      .where(eq(billingOperations.operationId, input.operationId))
      .for("update")
      .limit(1);
    if (!operation) return { kind: "missing" as const };
    if (finalStatuses.has(operation.status)) {
      return { kind: "already_final" as const, status: operation.status };
    }

    const [account] = await tx
      .select()
      .from(creditAccounts)
      .where(eq(creditAccounts.userId, operation.userId))
      .for("update")
      .limit(1);

    if (chargeMinor > 0 || input.nextOperationStatus === "settled") {
      await tx.insert(creditLedgerEntries).values({
        userId: operation.userId,
        entryType: "consumption",
        amountMinor: -chargeMinor,
        idempotencyKey: `consume:${input.operationId}`,
        operationId: input.operationId,
        reason: input.reason ?? null,
      });
    }

    const nextBalance = Number(account?.balanceMinor ?? 0) - chargeMinor;
    const nextReserved = Number(account?.reservedMinor ?? 0) - reservedDelta;
    const nextLifetime = Number(account?.lifetimeSpentMinor ?? 0) + chargeMinor;
    await tx
      .update(creditAccounts)
      .set({
        balanceMinor: nextBalance,
        reservedMinor: nextReserved,
        lifetimeSpentMinor: nextLifetime,
      })
      .where(eq(creditAccounts.userId, operation.userId));

    await tx
      .update(billingOperations)
      .set({
        status: input.nextOperationStatus,
        ...(finalStatuses.has(input.nextOperationStatus)
          ? { actualCostMinor: chargeMinor }
          : {}),
      })
      .where(eq(billingOperations.operationId, input.operationId));
    await tx
      .update(creditHolds)
      .set({ status: input.nextHoldStatus })
      .where(eq(creditHolds.operationId, input.operationId));

    return {
      kind: "applied" as const,
      balanceMinor: nextBalance,
      reservedMinor: nextReserved,
      lifetimeSpentMinor: nextLifetime,
      chargeMinor,
    };
  });
}

export type AppendCreditEntryInput = {
  userId: number;
  entryType: CreditLedgerEntry["entryType"];
  /** 带符号金额（微元）：赠送/退款为正，人工扣减为负 */
  amountMinor: number;
  /** 业务幂等键。重复写入被唯一约束挡下 */
  idempotencyKey: string;
  giftCardId?: number | null;
  actorUserId?: number | null;
  reason?: string | null;
  /** 领卡开通工作台时一并写入 */
  enableAccess?: boolean;
};

export type AppendCreditEntryResult =
  | { kind: "appended"; balanceMinor: number }
  /** 同一幂等键已经写过：重复赠送/重复迁移在这里被挡下 */
  | { kind: "duplicate" };

/**
 * 往账本追加一条记录（赠送、人工调整、退款），并同步余额投影。
 *
 * 这是唯一的入账口径，没有「直接设置余额」的旁路。重复迁移和重复领卡靠
 * `idempotencyKey` 的唯一约束收敛为零新增。
 */
export async function appendCreditLedgerEntry(
  input: AppendCreditEntryInput
): Promise<AppendCreditEntryResult> {
  if (!Number.isSafeInteger(input.amountMinor)) {
    throw new Error(`账本金额必须是安全整数微元：${input.amountMinor}`);
  }
  if (!input.idempotencyKey.trim()) {
    throw new Error("账本写入必须带幂等键");
  }

  const db = await getDb();
  if (!db) {
    return memoryCreditAccountLock.run(input.userId, async () => {
      const duplicate = memoryState.creditLedgerEntries.some(
        item => item.idempotencyKey === input.idempotencyKey
      );
      if (duplicate) return { kind: "duplicate" as const };

      const account = memoryCreditAccountRow(input.userId);
      const current = now();
      memoryState.creditLedgerEntries.push({
        id: nextMemoryId("creditLedgerEntry"),
        userId: input.userId,
        entryType: input.entryType,
        amountMinor: input.amountMinor,
        currency: "CNY",
        idempotencyKey: input.idempotencyKey,
        operationId: null,
        giftCardId: input.giftCardId ?? null,
        actorUserId: input.actorUserId ?? null,
        reason: input.reason ?? null,
        createdAt: current,
      });
      account.balanceMinor = Number(account.balanceMinor) + input.amountMinor;
      if (input.enableAccess && !account.accessEnabledAt) {
        account.accessEnabledAt = current;
      }
      account.updatedAt = current;
      await persistMemoryState();
      return {
        kind: "appended" as const,
        balanceMinor: Number(account.balanceMinor),
      };
    });
  }

  return db.transaction(async tx => {
    await tx
      .insert(creditAccounts)
      .values({ userId: input.userId })
      .onDuplicateKeyUpdate({ set: { userId: input.userId } });
    const [account] = await tx
      .select()
      .from(creditAccounts)
      .where(eq(creditAccounts.userId, input.userId))
      .for("update")
      .limit(1);

    const [duplicate] = await tx
      .select({ id: creditLedgerEntries.id })
      .from(creditLedgerEntries)
      .where(eq(creditLedgerEntries.idempotencyKey, input.idempotencyKey))
      .limit(1);
    if (duplicate) return { kind: "duplicate" as const };

    await tx.insert(creditLedgerEntries).values({
      userId: input.userId,
      entryType: input.entryType,
      amountMinor: input.amountMinor,
      idempotencyKey: input.idempotencyKey,
      giftCardId: input.giftCardId ?? null,
      actorUserId: input.actorUserId ?? null,
      reason: input.reason ?? null,
    });

    const nextBalance = Number(account?.balanceMinor ?? 0) + input.amountMinor;
    await tx
      .update(creditAccounts)
      .set({
        balanceMinor: nextBalance,
        ...(input.enableAccess && !account?.accessEnabledAt
          ? { accessEnabledAt: new Date() }
          : {}),
      })
      .where(eq(creditAccounts.userId, input.userId));

    return { kind: "appended" as const, balanceMinor: nextBalance };
  });
}

export async function listCreditLedgerEntries(
  userId: number,
  limit = 50
): Promise<CreditLedgerEntry[]> {
  const db = await getDb();
  if (!db) {
    return memoryState.creditLedgerEntries
      .filter(item => item.userId === userId)
      .sort((left, right) => right.id - left.id)
      .slice(0, limit)
      .map(item => ({ ...item }));
  }

  return db
    .select()
    .from(creditLedgerEntries)
    .where(eq(creditLedgerEntries.userId, userId))
    .orderBy(desc(creditLedgerEntries.id))
    .limit(limit);
}

export async function findBillingOperation(
  operationId: string
): Promise<BillingOperation | null> {
  const db = await getDb();
  if (!db) {
    return (
      memoryState.billingOperations.find(
        item => item.operationId === operationId
      ) ?? null
    );
  }

  const [operation] = await db
    .select()
    .from(billingOperations)
    .where(eq(billingOperations.operationId, operationId))
    .limit(1);
  return operation ?? null;
}

export async function findActiveCreditHold(
  operationId: string
): Promise<CreditHold | null> {
  const db = await getDb();
  if (!db) {
    return (
      memoryState.creditHolds.find(
        item => item.operationId === operationId && item.status === "active"
      ) ?? null
    );
  }

  const [hold] = await db
    .select()
    .from(creditHolds)
    .where(
      and(
        eq(creditHolds.operationId, operationId),
        eq(creditHolds.status, "active")
      )
    )
    .limit(1);
  return hold ?? null;
}

export type RecordProviderAttemptInput = {
  operationId: string;
  attemptIndex: number;
  provider: string;
  model?: string | null;
  providerTaskId?: string | null;
  receiptId?: string | null;
  status: ProviderAttempt["status"];
  usage?: unknown;
  costMinor?: number | null;
};

/**
 * 记录一次供应商尝试。
 *
 * 供应商层与业务层分开：这里记 fallback、重试和真实用量，但**不动余额**——
 * 扣费只发生在业务层的一次结算里，避免 adapter 重复扣费。
 */
export async function recordProviderAttempt(
  input: RecordProviderAttemptInput
): Promise<{ kind: "recorded" } | { kind: "missing_operation" }> {
  const operation = await findBillingOperation(input.operationId);
  if (!operation) return { kind: "missing_operation" };

  const db = await getDb();
  if (!db) {
    const current = now();
    const existing = memoryState.providerAttempts.find(
      item =>
        item.billingOperationId === operation.id &&
        item.attemptIndex === input.attemptIndex
    );
    if (existing) {
      existing.status = input.status;
      existing.providerTaskId = input.providerTaskId ?? existing.providerTaskId;
      existing.receiptId = input.receiptId ?? existing.receiptId;
      existing.usage = (input.usage ??
        existing.usage) as ProviderAttempt["usage"];
      existing.costMinor = input.costMinor ?? existing.costMinor;
      existing.updatedAt = current;
      await persistMemoryState();
      return { kind: "recorded" };
    }
    memoryState.providerAttempts.push({
      id: nextMemoryId("providerAttempt"),
      billingOperationId: operation.id,
      attemptIndex: input.attemptIndex,
      provider: input.provider,
      model: input.model ?? null,
      providerTaskId: input.providerTaskId ?? null,
      receiptId: input.receiptId ?? null,
      status: input.status,
      usage: (input.usage ?? null) as ProviderAttempt["usage"],
      costMinor: input.costMinor ?? null,
      submittedAt: null,
      completedAt: null,
      createdAt: current,
      updatedAt: current,
    });
    await persistMemoryState();
    return { kind: "recorded" };
  }

  await db
    .insert(providerAttempts)
    .values({
      billingOperationId: operation.id,
      attemptIndex: input.attemptIndex,
      provider: input.provider,
      model: input.model ?? null,
      providerTaskId: input.providerTaskId ?? null,
      receiptId: input.receiptId ?? null,
      status: input.status,
      usage: input.usage ?? null,
      costMinor: input.costMinor ?? null,
    })
    .onDuplicateKeyUpdate({
      set: {
        status: input.status,
        providerTaskId: input.providerTaskId ?? null,
        receiptId: input.receiptId ?? null,
        usage: input.usage ?? null,
        costMinor: input.costMinor ?? null,
      },
    });
  return { kind: "recorded" };
}

export async function listProviderAttemptsForOperation(
  operationId: string
): Promise<ProviderAttempt[]> {
  const operation = await findBillingOperation(operationId);
  if (!operation) return [];
  const db = await getDb();
  if (!db) {
    return memoryState.providerAttempts
      .filter(item => item.billingOperationId === operation.id)
      .sort((left, right) => left.attemptIndex - right.attemptIndex)
      .map(item => ({ ...item }));
  }
  return db
    .select()
    .from(providerAttempts)
    .where(eq(providerAttempts.billingOperationId, operation.id))
    .orderBy(providerAttempts.attemptIndex);
}

// ══════════════════════════════════════════════════════════════════════
// 统一账号：身份解析、密码凭据、验证码挑战、共享持久化限流
//
// 「一个标准化邮箱只解析到一个 userId」是整套账号的地基。解析不出唯一答案时
// **停在冲突状态**，交给人工处理——静默 merge 会把两个人的故事并进一个账号，
// 那是不可逆的。
// ══════════════════════════════════════════════════════════════════════

const memoryRateLimitLock = createKeyedSerialLock<string>();
const memoryChallengeLock = createKeyedSerialLock<string>();

export function normalizeAccountEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type EmailIdentityResolution =
  /** account_identities 里已有登记 */
  | { kind: "resolved"; userId: number }
  /** 历史 users 表里恰好一个匹配，尚未登记 identity */
  | { kind: "legacy_single"; userId: number }
  /** 同一标准化邮箱对应多个历史用户：停下来，不猜 */
  | { kind: "conflict"; userIds: number[] }
  | { kind: "absent" };

/**
 * 把标准化邮箱解析成唯一 userId。
 *
 * 先查 identity 表（`(provider, subject)` 唯一，最多一条）；没有再回落到历史
 * `users.email`。历史表里出现多个匹配时返回 conflict——调用方必须失败关闭，
 * 等 U3 的映射清单和人工裁决，不允许自动挑一个。
 */
export async function resolveEmailIdentity(
  email: string
): Promise<EmailIdentityResolution> {
  const normalized = normalizeAccountEmail(email);
  if (!normalized) return { kind: "absent" };

  const db = await getDb();
  if (!db) {
    const identity = memoryState.accountIdentities.find(
      item => item.provider === "email" && item.subject === normalized
    );
    if (identity) return { kind: "resolved", userId: identity.userId };

    const matches = memoryState.users.filter(
      item => normalizeAccountEmail(item.email ?? "") === normalized
    );
    if (matches.length === 1)
      return { kind: "legacy_single", userId: matches[0].id };
    if (matches.length > 1) {
      return { kind: "conflict", userIds: matches.map(item => item.id).sort() };
    }
    return { kind: "absent" };
  }

  const [identity] = await db
    .select()
    .from(accountIdentities)
    .where(
      and(
        eq(accountIdentities.provider, "email"),
        eq(accountIdentities.subject, normalized)
      )
    )
    .limit(1);
  if (identity) return { kind: "resolved", userId: identity.userId };

  const matches = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`LOWER(TRIM(${users.email})) = ${normalized}`);
  if (matches.length === 1)
    return { kind: "legacy_single", userId: matches[0].id };
  if (matches.length > 1) {
    return { kind: "conflict", userIds: matches.map(item => item.id).sort() };
  }
  return { kind: "absent" };
}

export async function linkEmailIdentity(input: {
  userId: number;
  email: string;
  verifiedAt?: Date | null;
}): Promise<{ kind: "linked" } | { kind: "taken"; userId: number }> {
  const normalized = normalizeAccountEmail(input.email);
  const existing = await resolveEmailIdentity(normalized);
  if (existing.kind === "resolved") {
    return existing.userId === input.userId
      ? { kind: "linked" }
      : { kind: "taken", userId: existing.userId };
  }

  const db = await getDb();
  if (!db) {
    const current = now();
    memoryState.accountIdentities.push({
      id: nextMemoryId("accountIdentity"),
      userId: input.userId,
      provider: "email",
      subject: normalized,
      verifiedAt: input.verifiedAt ?? current,
      createdAt: current,
      updatedAt: current,
    });
    await persistMemoryState();
    return { kind: "linked" };
  }

  await db.insert(accountIdentities).values({
    userId: input.userId,
    provider: "email",
    subject: normalized,
    verifiedAt: input.verifiedAt ?? new Date(),
  });
  return { kind: "linked" };
}

export async function getPasswordCredential(
  userId: number
): Promise<AccountCredential | null> {
  const db = await getDb();
  if (!db) {
    return (
      memoryState.accountCredentials.find(
        item => item.userId === userId && item.kind === "password"
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(accountCredentials)
    .where(
      and(
        eq(accountCredentials.userId, userId),
        eq(accountCredentials.kind, "password")
      )
    )
    .limit(1);
  return row ?? null;
}

export async function setPasswordCredential(input: {
  userId: number;
  secret: string;
  algorithmVersion: number;
}): Promise<void> {
  const db = await getDb();
  if (!db) {
    const current = now();
    const existing = memoryState.accountCredentials.find(
      item => item.userId === input.userId && item.kind === "password"
    );
    if (existing) {
      existing.secret = input.secret;
      existing.algorithmVersion = input.algorithmVersion;
      existing.updatedAt = current;
    } else {
      memoryState.accountCredentials.push({
        id: nextMemoryId("accountCredential"),
        userId: input.userId,
        kind: "password",
        secret: input.secret,
        algorithmVersion: input.algorithmVersion,
        createdAt: current,
        updatedAt: current,
      });
    }
    await persistMemoryState();
    return;
  }

  await db
    .insert(accountCredentials)
    .values({
      userId: input.userId,
      kind: "password",
      secret: input.secret,
      algorithmVersion: input.algorithmVersion,
    })
    .onDuplicateKeyUpdate({
      set: { secret: input.secret, algorithmVersion: input.algorithmVersion },
    });
}

export async function getUserSessionVersion(
  userId: number
): Promise<number | null> {
  const db = await getDb();
  if (!db) {
    const user = memoryState.users.find(item => item.id === userId);
    return user ? Number(user.sessionVersion ?? 1) : null;
  }
  const [row] = await db
    .select({ sessionVersion: users.sessionVersion })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ? Number(row.sessionVersion) : null;
}

/** 自增会话版本：改密码撤销其他设备、找回密码撤销全部旧 session 都靠它。 */
export async function bumpUserSessionVersion(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) {
    const user = memoryState.users.find(item => item.id === userId);
    if (!user) throw new Error(`用户不存在：${userId}`);
    user.sessionVersion = Number(user.sessionVersion ?? 1) + 1;
    user.updatedAt = now();
    await persistMemoryState();
    return user.sessionVersion;
  }

  await db
    .update(users)
    .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
    .where(eq(users.id, userId));
  return (await getUserSessionVersion(userId)) ?? 1;
}

export type VerificationChallengeInput = {
  email: string;
  purpose: AccountVerificationChallenge["purpose"];
  codeHash: string;
  secretVersion: number;
  expiresAt: Date;
  maxAttempts?: number;
};

/**
 * 签发一个验证码挑战，并让同邮箱同用途的旧挑战立即失效。
 *
 * 「连续点两次发送验证码，第一封里的码必须作废」——否则攻击者可以攒一批同时有效的码。
 */
export async function issueVerificationChallenge(
  input: VerificationChallengeInput
): Promise<{ id: number }> {
  const normalized = normalizeAccountEmail(input.email);
  const key = `${normalized}:${input.purpose}`;

  const db = await getDb();
  if (!db) {
    return memoryChallengeLock.run(key, async () => {
      const current = now();
      for (const challenge of memoryState.accountVerificationChallenges) {
        if (
          challenge.normalizedEmail === normalized &&
          challenge.purpose === input.purpose &&
          !challenge.consumedAt &&
          !challenge.invalidatedAt
        ) {
          challenge.invalidatedAt = current;
        }
      }
      const id = nextMemoryId("accountVerificationChallenge");
      memoryState.accountVerificationChallenges.push({
        id,
        purpose: input.purpose,
        normalizedEmail: normalized,
        codeHash: input.codeHash,
        secretVersion: input.secretVersion,
        attemptCount: 0,
        maxAttempts: input.maxAttempts ?? 5,
        sentAt: current,
        expiresAt: input.expiresAt,
        consumedAt: null,
        invalidatedAt: null,
        createdAt: current,
      });
      await persistMemoryState();
      return { id };
    });
  }

  return db.transaction(async tx => {
    await tx
      .update(accountVerificationChallenges)
      .set({ invalidatedAt: new Date() })
      .where(
        and(
          eq(accountVerificationChallenges.normalizedEmail, normalized),
          eq(accountVerificationChallenges.purpose, input.purpose),
          isNull(accountVerificationChallenges.consumedAt),
          isNull(accountVerificationChallenges.invalidatedAt)
        )
      );
    const result = await tx.insert(accountVerificationChallenges).values({
      purpose: input.purpose,
      normalizedEmail: normalized,
      codeHash: input.codeHash,
      secretVersion: input.secretVersion,
      expiresAt: input.expiresAt,
      maxAttempts: input.maxAttempts ?? 5,
    });
    return { id: result[0].insertId };
  });
}

export type ChallengeConsumption =
  | { kind: "consumed"; challenge: AccountVerificationChallenge }
  | { kind: "no_active_challenge" }
  | { kind: "expired" }
  | { kind: "too_many_attempts" }
  | { kind: "mismatch"; attemptCount: number };

/**
 * 原子地消费一个验证码挑战。
 *
 * `verify` 是调用方传进来的纯比对函数（`accountSecurity.otpDigestMatches`），
 * 在锁内执行：比对失败要计数，比对成功要立刻标记已用，这两件事必须和读取同一个事务，
 * 否则同一个码可以被并发用两次。
 */
export async function consumeVerificationChallenge(input: {
  email: string;
  purpose: AccountVerificationChallenge["purpose"];
  verify: (challenge: AccountVerificationChallenge) => boolean;
  now?: Date;
}): Promise<ChallengeConsumption> {
  const normalized = normalizeAccountEmail(input.email);
  const key = `${normalized}:${input.purpose}`;
  const current = input.now ?? new Date();

  const evaluate = (
    challenge: AccountVerificationChallenge | undefined
  ):
    | { done: ChallengeConsumption }
    | { proceed: AccountVerificationChallenge } => {
    if (!challenge) return { done: { kind: "no_active_challenge" } };
    if (challenge.expiresAt <= current) return { done: { kind: "expired" } };
    if (challenge.attemptCount >= challenge.maxAttempts) {
      return { done: { kind: "too_many_attempts" } };
    }
    return { proceed: challenge };
  };

  const db = await getDb();
  if (!db) {
    return memoryChallengeLock.run(key, async () => {
      const challenge = memoryState.accountVerificationChallenges.find(
        item =>
          item.normalizedEmail === normalized &&
          item.purpose === input.purpose &&
          !item.consumedAt &&
          !item.invalidatedAt
      );
      const outcome = evaluate(challenge);
      if ("done" in outcome) return outcome.done;

      if (!input.verify(outcome.proceed)) {
        outcome.proceed.attemptCount += 1;
        await persistMemoryState();
        return {
          kind: "mismatch" as const,
          attemptCount: outcome.proceed.attemptCount,
        };
      }
      outcome.proceed.consumedAt = current;
      await persistMemoryState();
      return { kind: "consumed" as const, challenge: { ...outcome.proceed } };
    });
  }

  return db.transaction(async tx => {
    const [challenge] = await tx
      .select()
      .from(accountVerificationChallenges)
      .where(
        and(
          eq(accountVerificationChallenges.normalizedEmail, normalized),
          eq(accountVerificationChallenges.purpose, input.purpose),
          isNull(accountVerificationChallenges.consumedAt),
          isNull(accountVerificationChallenges.invalidatedAt)
        )
      )
      .orderBy(desc(accountVerificationChallenges.id))
      .for("update")
      .limit(1);

    const outcome = evaluate(challenge);
    if ("done" in outcome) return outcome.done;

    if (!input.verify(outcome.proceed)) {
      const attemptCount = outcome.proceed.attemptCount + 1;
      await tx
        .update(accountVerificationChallenges)
        .set({ attemptCount })
        .where(eq(accountVerificationChallenges.id, outcome.proceed.id));
      return { kind: "mismatch" as const, attemptCount };
    }

    await tx
      .update(accountVerificationChallenges)
      .set({ consumedAt: current })
      .where(eq(accountVerificationChallenges.id, outcome.proceed.id));
    return {
      kind: "consumed" as const,
      challenge: { ...outcome.proceed, consumedAt: current },
    };
  });
}

export type RateLimitDecision = {
  allowed: boolean;
  /** 本窗口内已用掉的次数（含本次） */
  attemptCount: number;
  retryAfterMs: number;
};

/**
 * 共享持久化限流。
 *
 * 必须落库：PM2 重启或多进程时，进程内内存限流形同虚设。窗口用「首次尝试时间 +
 * windowSeconds」的固定窗口，超限后拒绝并给出还要等多久。
 */
export async function consumePersistentRateLimit(input: {
  scope: string;
  subject: string;
  windowSeconds: number;
  maxAttempts: number;
  now?: Date;
}): Promise<RateLimitDecision> {
  const current = input.now ?? new Date();
  const windowMs = input.windowSeconds * 1000;
  const key = `${input.scope}:${input.subject}`;

  const decide = (
    windowStartedAt: Date,
    attemptCount: number
  ): {
    decision: RateLimitDecision;
    nextStartedAt: Date;
    nextCount: number;
  } => {
    const windowExpired =
      current.getTime() - windowStartedAt.getTime() >= windowMs;
    const startedAt = windowExpired ? current : windowStartedAt;
    const used = windowExpired ? 0 : attemptCount;
    if (used >= input.maxAttempts) {
      return {
        decision: {
          allowed: false,
          attemptCount: used,
          retryAfterMs: Math.max(
            0,
            startedAt.getTime() + windowMs - current.getTime()
          ),
        },
        nextStartedAt: startedAt,
        nextCount: used,
      };
    }
    return {
      decision: { allowed: true, attemptCount: used + 1, retryAfterMs: 0 },
      nextStartedAt: startedAt,
      nextCount: used + 1,
    };
  };

  const db = await getDb();
  if (!db) {
    return memoryRateLimitLock.run(key, async () => {
      let row = memoryState.accountRateLimits.find(
        item => item.scope === input.scope && item.subject === input.subject
      );
      if (!row) {
        row = {
          id: nextMemoryId("accountRateLimit"),
          scope: input.scope,
          subject: input.subject,
          windowStartedAt: current,
          windowSeconds: input.windowSeconds,
          attemptCount: 0,
          blockedUntil: null,
          updatedAt: current,
        };
        memoryState.accountRateLimits.push(row);
      }
      const outcome = decide(row.windowStartedAt, row.attemptCount);
      row.windowStartedAt = outcome.nextStartedAt;
      row.attemptCount = outcome.nextCount;
      row.windowSeconds = input.windowSeconds;
      row.updatedAt = current;
      await persistMemoryState();
      return outcome.decision;
    });
  }

  return db.transaction(async tx => {
    await tx
      .insert(accountRateLimits)
      .values({
        scope: input.scope,
        subject: input.subject,
        windowSeconds: input.windowSeconds,
        windowStartedAt: current,
        attemptCount: 0,
      })
      .onDuplicateKeyUpdate({ set: { windowSeconds: input.windowSeconds } });

    const [row] = await tx
      .select()
      .from(accountRateLimits)
      .where(
        and(
          eq(accountRateLimits.scope, input.scope),
          eq(accountRateLimits.subject, input.subject)
        )
      )
      .for("update")
      .limit(1);

    const outcome = decide(
      row?.windowStartedAt ?? current,
      row?.attemptCount ?? 0
    );
    await tx
      .update(accountRateLimits)
      .set({
        windowStartedAt: outcome.nextStartedAt,
        attemptCount: outcome.nextCount,
        windowSeconds: input.windowSeconds,
      })
      .where(
        and(
          eq(accountRateLimits.scope, input.scope),
          eq(accountRateLimits.subject, input.subject)
        )
      );
    return outcome.decision;
  });
}

// ─── 个人记忆（U1）─────────────────────────────────────────────────────
//
// 语义在 shared/personalMemory.ts，这里只负责把它落到两条持久化路径上，
// 并保证两条路径对外可观察的结果一致。
//
// 两种模式的耐久机制**不同**，这是有意的，不要试图抹平：
//
//   MySQL：来源、事件与任务写在同一个 SQL 事务里，本来就原子。
//   本地：  outbox 写进来源自己所属的聚合，跨聚合靠带水位的幂等投影。
//          两份 JSON 之间没有共同事务，代码里也不许假装有。

export type PersonalMemoryEventRow = PersonalMemoryEventRecord;

/**
 * MySQL 事务句柄。U2／U3／U5 在自己的领域事务里把它传进来，
 * 让经历与来源写入搭上同一趟车，而不是各自另开一个嵌套事务。
 */
type DrizzleDatabase = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type PersonalMemoryMysqlTx = Parameters<
  Parameters<DrizzleDatabase["transaction"]>[0]
>[0];

/** 事务作用域。调用方必须已经在自己的领域事务／聚合写入里。 */
export type PersonalMemoryTxScope =
  | { mode: "mysql"; tx: PersonalMemoryMysqlTx }
  /**
   * 本地模式：直接作用在传入的状态上。调用方负责把这份状态和自己的来源
   * 一起落盘——失败就整份丢弃，不做部分回滚。
   */
  | { mode: "local"; state: PersonalMemoryLocalState };

function rowToPersonalMemoryEvent(row: {
  id: number;
  userId: number;
  sourceType: string;
  sourceKey: string;
  sourceRevision: string;
  actionKind: string;
  actionId: string;
  occurredOn: string;
  occurredAt: Date;
  excerpt: string | null;
  contentHash: string | null;
  display: unknown;
  contentScrubbed: boolean;
  createdAt: Date;
}): PersonalMemoryEventRecord {
  return {
    id: row.id,
    userId: row.userId,
    sourceType: row.sourceType as PersonalMemoryEventIdentity["sourceType"],
    sourceKey: row.sourceKey,
    sourceRevision: row.sourceRevision,
    actionKind: row.actionKind as PersonalMemoryEventIdentity["actionKind"],
    actionId: row.actionId,
    occurredOn: row.occurredOn,
    occurredAt: row.occurredAt.toISOString(),
    snapshot: {
      excerpt: row.excerpt,
      contentHash: row.contentHash,
      display: (row.display as Record<string, unknown> | null) ?? null,
    },
    contentScrubbed: row.contentScrubbed,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * 事务作用域内幂等捕获一次经历。
 *
 * 重放同一动作 ID 时返回既有事件、`changed: false`，事件／任务基数不变。
 * 身份非法（任何一段为空）会抛错——**在写任何一行之前**，因为空串在 MySQL
 * 唯一索引里等价于 NULL，放过去就是静默重复。
 */
export async function capturePersonalMemoryEvent(
  scope: PersonalMemoryTxScope,
  capture: PersonalMemoryCapture
): Promise<{ event: PersonalMemoryEventRecord; changed: boolean }> {
  // 先校验再动手：两条路径都不允许「写了一半才发现身份不合法」。
  const identity = normalizePersonalMemoryEventIdentity(capture.identity);

  if (scope.mode === "local") {
    return applyPersonalMemoryCapture(scope.state, {
      ...capture,
      identity,
    });
  }

  const { tx } = scope;
  const existing = await findPersonalMemoryEventInTx(tx, identity);
  if (existing) return { event: existing, changed: false };

  // 多态来源先登记进租户注册表；事件再用 (sourceId, userId) 复合外键指过来，
  // 这样跨账号引用在数据库层就写不进去。
  await tx
    .insert(personalMemorySources)
    .values({
      userId: identity.userId,
      sourceType: identity.sourceType,
      sourceKey: identity.sourceKey,
      storyId: capture.storyId,
    })
    .onDuplicateKeyUpdate({ set: { sourceKey: identity.sourceKey } });
  // FOR UPDATE：见 findPersonalMemoryEventInTx 的说明。上面这条
  // INSERT ... ON DUPLICATE KEY UPDATE 是当前读，能看到并发事务刚提交的来源行；
  // 但如果这里用普通读，就会退回本事务开始时的快照、把那一行读成不存在。
  const [source] = await tx
    .select({ id: personalMemorySources.id })
    .from(personalMemorySources)
    .where(
      and(
        eq(personalMemorySources.userId, identity.userId),
        eq(personalMemorySources.sourceType, identity.sourceType),
        eq(personalMemorySources.sourceKey, identity.sourceKey)
      )
    )
    .limit(1)
    .for("update");
  if (!source) throw new Error("个人记忆来源登记失败");

  const occurredAt = new Date(capture.occurredAt);
  try {
    await tx.insert(personalMemoryEvents).values({
      userId: identity.userId,
      sourceId: source.id,
      sourceType: identity.sourceType,
      sourceKey: identity.sourceKey,
      sourceRevision: identity.sourceRevision,
      actionKind: identity.actionKind,
      actionId: identity.actionId,
      occurredOn: capture.occurredOn,
      occurredAt,
      excerpt: capture.snapshot.excerpt,
      contentHash: capture.snapshot.contentHash,
      display: capture.snapshot.display,
    });
  } catch (error) {
    // 并发重放：另一个事务抢先写了同一身份。唯一索引挡住了重复，
    // 这里把既有事件当前读回来，语义与「一开始就发现已存在」完全一致。
    // 不用 SELECT ... FOR UPDATE 抢在插入之前做，是为了避免两个事务
    // 同时在缺失行上持有间隙锁然后互相等成死锁。
    if (!isDuplicateKeyError(error)) throw error;
    const existingAfterRace = await findPersonalMemoryEventInTx(
      tx,
      identity,
      true
    );
    if (!existingAfterRace) throw error;
    return { event: existingAfterRace, changed: false };
  }
  const event = await findPersonalMemoryEventInTx(tx, identity);
  if (!event) throw new Error("个人记忆事件写入后读不回");

  if (capture.job) {
    // 同一事件 + 同一提炼器版本只排一次，靠唯一索引兜住并发重复投递。
    // operationId 也有全局唯一索引，所以这里用 ON DUPLICATE KEY UPDATE
    // 而不是让并发投递炸出来。
    await tx
      .insert(personalMemoryJobs)
      .values({
        userId: identity.userId,
        eventId: event.id,
        operationId: capture.job.operationId,
        extractorVersion: capture.job.extractorVersion,
        availableAt: occurredAt,
      })
      .onDuplicateKeyUpdate({
        set: { extractorVersion: capture.job.extractorVersion },
      });
  }

  return { event, changed: true };
}

/**
 * 认出「唯一键冲突」。drizzle 会把 mysql2 的错误包一层，所以要顺着 cause 找。
 */
function isDuplicateKeyError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const candidate = current as {
      code?: string;
      errno?: number;
      cause?: unknown;
    };
    if (candidate.code === "ER_DUP_ENTRY" || candidate.errno === 1062)
      return true;
    current = candidate.cause;
  }
  return false;
}

/**
 * 死锁。InnoDB 会挑一个事务回滚掉，被回滚的那个重试即可。
 *
 * 这在并发插入同一段区间时是**正常现象**，不是 bug——除非我们自己去抢间隙锁
 * 把它变成必然。见 appendEmotionDailyLetterVersion 的说明。
 */
function isDeadlockError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const candidate = current as {
      code?: string;
      errno?: number;
      cause?: unknown;
    };
    if (candidate.code === "ER_LOCK_DEADLOCK" || candidate.errno === 1213) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

/**
 * @param locking true = `FOR UPDATE`，读当前已提交状态而不是事务快照。
 *
 * 这个参数不是性能开关，是正确性开关。MySQL 默认 REPEATABLE READ：事务里
 * 第一次普通 SELECT 就确立了快照，之后再普通读**看不到**别的事务在这期间
 * 提交的行——哪怕自己刚刚被那一行的唯一键挡了一下。所以「插入撞了唯一键、
 * 回头把既有行读出来」这一步必须是当前读，否则会读回空、然后误报写入失败。
 */
async function findPersonalMemoryEventInTx(
  tx: PersonalMemoryMysqlTx,
  identity: PersonalMemoryEventIdentity,
  locking = false
): Promise<PersonalMemoryEventRecord | null> {
  const query = tx
    .select()
    .from(personalMemoryEvents)
    .where(
      and(
        eq(personalMemoryEvents.userId, identity.userId),
        eq(personalMemoryEvents.sourceType, identity.sourceType),
        eq(personalMemoryEvents.sourceKey, identity.sourceKey),
        eq(personalMemoryEvents.sourceRevision, identity.sourceRevision),
        eq(personalMemoryEvents.actionKind, identity.actionKind),
        eq(personalMemoryEvents.actionId, identity.actionId)
      )
    )
    .limit(1);
  const [row] = await (locking ? query.for("update") : query);
  return row ? rowToPersonalMemoryEvent(row) : null;
}

/**
 * 自带事务的捕获入口。只给「没有更大领域事务可搭车」的调用方用；
 * U2／U3／U5 必须走 capturePersonalMemoryEvent + 自己的事务。
 */
export async function capturePersonalMemoryEventStandalone(
  capture: PersonalMemoryCapture
): Promise<{ event: PersonalMemoryEventRecord; changed: boolean }> {
  const db = await getDb();
  if (!db) {
    return withLocalAggregateMutationLock(async () => {
      const before = structuredClone(memoryState.personalMemory);
      const result = capturePersonalMemoryEvent(
        { mode: "local", state: memoryState.personalMemory },
        capture
      );
      const resolved = await result;
      if (!resolved.changed) return resolved;
      try {
        await persistMemoryState();
      } catch (error) {
        // 落盘失败就整份还原：本地聚合是 copy-on-write，不留半写状态。
        memoryState.personalMemory = before;
        throw error;
      }
      return resolved;
    });
  }
  return db.transaction(async tx =>
    capturePersonalMemoryEvent({ mode: "mysql", tx }, capture)
  );
}

export async function getPersonalMemoryEventByIdentity(
  identity: PersonalMemoryEventIdentity
): Promise<PersonalMemoryEventRecord | null> {
  const normalized = normalizePersonalMemoryEventIdentity(identity);
  const db = await getDb();
  if (!db) {
    const fingerprint = personalMemoryEventFingerprint(normalized);
    return (
      memoryState.personalMemory.events.find(
        event => personalMemoryEventFingerprint(event) === fingerprint
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(personalMemoryEvents)
    .where(
      and(
        eq(personalMemoryEvents.userId, normalized.userId),
        eq(personalMemoryEvents.sourceType, normalized.sourceType),
        eq(personalMemoryEvents.sourceKey, normalized.sourceKey),
        eq(personalMemoryEvents.sourceRevision, normalized.sourceRevision),
        eq(personalMemoryEvents.actionKind, normalized.actionKind),
        eq(personalMemoryEvents.actionId, normalized.actionId)
      )
    )
    .limit(1);
  return row ? rowToPersonalMemoryEvent(row) : null;
}

/**
 * 按 `occurredAt DESC, id DESC` 列出经历。
 * 两条路径排序必须一致，否则 U7 的 keyset 分页会在切换模式后错位。
 */
export async function listPersonalMemoryEvents(
  userId: number,
  limit = 50
): Promise<PersonalMemoryEventRecord[]> {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const db = await getDb();
  if (!db) {
    return memoryState.personalMemory.events
      .filter(event => event.userId === userId)
      .sort((left, right) => {
        const byTime = right.occurredAt.localeCompare(left.occurredAt);
        return byTime !== 0 ? byTime : right.id - left.id;
      })
      .slice(0, safeLimit);
  }
  const rows = await db
    .select()
    .from(personalMemoryEvents)
    .where(eq(personalMemoryEvents.userId, userId))
    .orderBy(
      desc(personalMemoryEvents.occurredAt),
      desc(personalMemoryEvents.id)
    )
    .limit(safeLimit);
  return rows.map(rowToPersonalMemoryEvent);
}

/**
 * 足迹时间线的 keyset 分页。
 *
 * 按 `(occurredAt DESC, id DESC)` 取 `limit + 1` 行：多出来那一行只用来判断
 * 「还有没有下一页」，不返回给调用方。用 keyset 而不是 OFFSET，是因为翻页
 * 期间随时会插入新事件——OFFSET 会让分页边界整体错位，用户会看到重复行，
 * 或者更糟：漏掉一整条经历还毫无察觉。
 *
 * `(userId, occurredAt, id)` 上有专门的复合索引支撑这个顺序。
 */
export async function listPersonalMemoryEventsPage(input: {
  userId: number;
  cursor?: PersonalMemoryTimelineCursor | null;
  limit?: number;
  sourceTypes?: readonly PersonalMemorySourceType[] | null;
}): Promise<{ events: PersonalMemoryEventRecord[]; hasMore: boolean }> {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 20)));
  const cursor = input.cursor ?? null;
  const sourceTypes =
    input.sourceTypes && input.sourceTypes.length > 0
      ? [...input.sourceTypes]
      : null;
  const db = await getDb();

  if (!db) {
    const cursorAt = cursor ? Date.parse(cursor.occurredAt) : null;
    const filtered = memoryState.personalMemory.events
      .filter(event => {
        if (event.userId !== input.userId) return false;
        if (sourceTypes && !sourceTypes.includes(event.sourceType)) {
          return false;
        }
        if (!cursor || cursorAt == null) return true;
        // 和 SQL 侧同一条 keyset 谓词：时间更早，或同一时刻但 id 更小。
        const eventAt = Date.parse(event.occurredAt);
        if (eventAt < cursorAt) return true;
        return eventAt === cursorAt && event.id < cursor.id;
      })
      .sort((left, right) => {
        const byTime =
          Date.parse(right.occurredAt) - Date.parse(left.occurredAt);
        return byTime !== 0 ? byTime : right.id - left.id;
      });
    return {
      events: filtered.slice(0, safeLimit),
      hasMore: filtered.length > safeLimit,
    };
  }

  const conditions = [eq(personalMemoryEvents.userId, input.userId)];
  if (sourceTypes) {
    conditions.push(inArray(personalMemoryEvents.sourceType, sourceTypes));
  }
  if (cursor) {
    const cursorAt = new Date(cursor.occurredAt);
    conditions.push(
      or(
        lt(personalMemoryEvents.occurredAt, cursorAt),
        and(
          eq(personalMemoryEvents.occurredAt, cursorAt),
          lt(personalMemoryEvents.id, cursor.id)
        )
      )!
    );
  }
  const rows = await db
    .select()
    .from(personalMemoryEvents)
    .where(and(...conditions))
    .orderBy(desc(personalMemoryEvents.occurredAt), desc(personalMemoryEvents.id))
    .limit(safeLimit + 1);
  return {
    events: rows.slice(0, safeLimit).map(rowToPersonalMemoryEvent),
    hasMore: rows.length > safeLimit,
  };
}

/**
 * 按 ID 批量取事件（仍然按 userId 过滤）。
 *
 * 存在的理由是理解卡要显示「依据 X 月 X 日起的 N 条记录」：证据行只存
 * eventId，日期在事件上。一张卡逐条查会变成 N×M 次往返，所以这里一次取回。
 */
export async function listPersonalMemoryEventsByIds(
  userId: number,
  eventIds: readonly number[]
): Promise<PersonalMemoryEventRecord[]> {
  const ids = [...new Set(eventIds)].filter(
    id => Number.isSafeInteger(id) && id > 0
  );
  if (ids.length === 0) return [];
  const db = await getDb();
  if (!db) {
    return memoryState.personalMemory.events.filter(
      event => event.userId === userId && ids.includes(event.id)
    );
  }
  const rows = await db
    .select()
    .from(personalMemoryEvents)
    .where(
      and(
        eq(personalMemoryEvents.userId, userId),
        inArray(personalMemoryEvents.id, ids)
      )
    );
  return rows.map(rowToPersonalMemoryEvent);
}

/**
 * 某一天的全部事件（不分页——一天的量天然有限，不需要 keyset）。
 *
 * 这条查询单独存在的理由：`listPersonalMemoryEventsPage` 是给"滚动浏览"用的
 * keyset 分页，只保证「最近 N 条」；日期详情页要的是「**这一天**的全部事件」，
 * 用户越活跃、要翻的天数越靠前，这两者的语义差距就越大——用最近 N 条做
 * 日期详情，翻旧日期会静默返回空，而不是报错，最容易被漏测。
 */
export async function listPersonalMemoryEventsForDay(
  userId: number,
  occurredOn: string
): Promise<PersonalMemoryEventRecord[]> {
  const db = await getDb();
  if (!db) {
    return memoryState.personalMemory.events
      .filter(event => event.userId === userId && event.occurredOn === occurredOn)
      .sort((left, right) => {
        const byTime = right.occurredAt.localeCompare(left.occurredAt);
        return byTime !== 0 ? byTime : right.id - left.id;
      });
  }
  const rows = await db
    .select()
    .from(personalMemoryEvents)
    .where(
      and(
        eq(personalMemoryEvents.userId, userId),
        eq(personalMemoryEvents.occurredOn, occurredOn)
      )
    )
    .orderBy(desc(personalMemoryEvents.occurredAt), desc(personalMemoryEvents.id));
  return rows.map(rowToPersonalMemoryEvent);
}

/**
 * 列出某账号的派生理解。
 *
 * 只按 userId 过滤——所有调用方都必须从认证上下文拿这个值，绝不接受
 * 客户端传入的用户身份。
 */
export async function listPersonalMemoryInsightsForUser(input: {
  userId: number;
  states?: readonly PersonalMemoryInsightState[] | null;
  limit?: number;
}): Promise<PersonalMemoryInsightRecord[]> {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)));
  const states =
    input.states && input.states.length > 0 ? [...input.states] : null;
  const db = await getDb();
  if (!db) {
    return memoryState.personalMemory.insights
      .filter(
        insight =>
          insight.userId === input.userId &&
          (!states || states.includes(insight.state))
      )
      .sort((left, right) => {
        const byTime = right.updatedAt.localeCompare(left.updatedAt);
        return byTime !== 0 ? byTime : right.id - left.id;
      })
      .slice(0, safeLimit);
  }
  const conditions = [eq(personalMemoryInsights.userId, input.userId)];
  if (states) {
    conditions.push(inArray(personalMemoryInsights.state, states));
  }
  const rows = await db
    .select()
    .from(personalMemoryInsights)
    .where(and(...conditions))
    .orderBy(desc(personalMemoryInsights.updatedAt), desc(personalMemoryInsights.id))
    .limit(safeLimit);
  return rows.map(rowToPersonalMemoryInsight);
}

/**
 * 把某个来源聚合的 outbox 投影进统一足迹索引（**仅本地模式**）。
 *
 * MySQL 不需要它——那里事件本来就和来源同事务落库。
 */
export async function projectPersonalMemoryOutboxIntoIndex(
  aggregateName: string,
  entries: readonly PersonalMemoryOutboxEntry[]
): Promise<{ applied: number; skipped: number; watermark: number }> {
  const db = await getDb();
  if (db) return { applied: 0, skipped: entries.length, watermark: 0 };
  return withLocalAggregateMutationLock(async () => {
    const before = structuredClone(memoryState.personalMemory);
    const result = projectPersonalMemoryOutbox(
      memoryState.personalMemory,
      aggregateName,
      entries
    );
    if (
      result.applied === 0 &&
      result.watermark === before.projectionWatermarks[aggregateName]
    ) {
      return result;
    }
    try {
      await persistMemoryState();
    } catch (error) {
      memoryState.personalMemory = before;
      throw error;
    }
    return result;
  });
}

/**
 * 读取用户当前隐私 epoch。没有记录时是 1（不写行，读多写少）。
 */
export async function getPersonalMemoryPrivacyEpoch(
  userId: number
): Promise<number> {
  const db = await getDb();
  if (!db) {
    return (
      memoryState.personalMemory.privacyEpochs.find(
        row => row.userId === userId
      )?.epoch ?? 1
    );
  }
  const [row] = await db
    .select()
    .from(personalMemoryPrivacyEpochs)
    .where(eq(personalMemoryPrivacyEpochs.userId, userId))
    .limit(1);
  return row?.epoch ?? 1;
}

/**
 * 递增隐私 epoch。忘记或删除来源时**必须**在同一短事务里调用，
 * 让在途的来信生成即使已经拿到模型结果也无法提交旧输入。
 */
export async function bumpPersonalMemoryPrivacyEpoch(
  userId: number
): Promise<number> {
  const db = await getDb();
  if (!db) {
    return withLocalAggregateMutationLock(async () => {
      const rows = memoryState.personalMemory.privacyEpochs;
      const existing = rows.find(row => row.userId === userId);
      const next = (existing?.epoch ?? 1) + 1;
      const stamp = now().toISOString();
      if (existing) {
        existing.epoch = next;
        existing.updatedAt = stamp;
      } else {
        rows.push({ userId, epoch: next, updatedAt: stamp });
      }
      await persistMemoryState();
      return next;
    });
  }
  await db
    .insert(personalMemoryPrivacyEpochs)
    .values({ userId, epoch: 2 })
    .onDuplicateKeyUpdate({
      set: { epoch: sql`${personalMemoryPrivacyEpochs.epoch} + 1` },
    });
  return getPersonalMemoryPrivacyEpoch(userId);
}

// ─── 每日来信：不可变版本是唯一正文权威 ────────────────────────────────

export type AppendDailyLetterVersionInput = {
  userId: number;
  letterDate: string;
  /** 稳定动作 ID。重复提交同一次生成／重读返回同一版本，不排第二次。 */
  actionId: string;
  trigger: PersonalMemoryLetterEnvelope["trigger"];
  selectorVersion: string;
  promptVersion: string;
  modelVersion: string;
  privacyEpoch: number;
  payload: PersonalMemoryLetterPayload;
  /** 兼容投影需要的字段；日期级行不接受独立正文写入。 */
  userMessageSaidAt?: Date | null;
  userMessageEditedAt?: Date | null;
  /**
   * 条件提交：给定时，只有当天当前版本号恰好等于它才追加。
   * legacy 的 revision CAS 就是通过它继续成立的——冲突返回 null，
   * 而不是悄悄追加一版覆盖别人刚写的内容。
   */
  expectedCurrentVersionNumber?: number;
  /**
   * 每日留言的经历捕获（U2）。与版本、日期级指针写在**同一个短事务**里。
   *
   * 这里不需要 outbox：留言的来源（日期级行）和统一足迹索引本来就同在
   * local-persist 聚合里，MySQL 那边也在同一个 SQL 事务里。需要 outbox 的
   * 只有跨聚合的普通聊天。
   *
   * 是否捕获由调用方（Phase 1 白名单）决定；不传就是不捕获。
   */
  personalMemoryCapture?: PersonalMemoryCapture;
};

export type AppendDailyLetterVersionResult = {
  version: PersonalMemoryLetterVersionRecord;
  letter: EmotionDailyLetter;
  /** false = 这次是重复提交，返回的是既有版本。 */
  created: boolean;
};

function letterVersionRowToRecord(row: {
  id: number;
  userId: number;
  letterDate: string;
  envelope: unknown;
  payload: unknown;
  privacyEpoch: number;
  actionId: string;
  createdAt: Date;
}): PersonalMemoryLetterVersionRecord {
  return {
    id: row.id,
    userId: row.userId,
    letterDate: row.letterDate,
    envelope: row.envelope as PersonalMemoryLetterEnvelope,
    payload: (row.payload as PersonalMemoryLetterPayload | null) ?? null,
    privacyEpoch: row.privacyEpoch,
    actionId: row.actionId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * **来信正文的唯一写入口。**
 *
 * 追加一个不可变版本，并在同一事务里把日期级行推进为该版本的投影 + 指针。
 * `emotion_daily_letters` 从 U1 起不再接受独立正文写入——任何绕过这里直接改
 * 日期级正文的代码路径都是必须被拒绝的 pre-U1 行为，回滚构建也不许放回去。
 */
export async function appendEmotionDailyLetterVersion(
  input: AppendDailyLetterVersionInput
): Promise<AppendDailyLetterVersionResult | null> {
  const db = await getDb();
  if (!db) {
    return withLocalAggregateMutationLock(async () => {
      const before = structuredClone(memoryState.personalMemory);
      const beforeLetters = memoryState.emotionDailyLetters.map(row => ({
        ...row,
      }));
      const result = appendLetterVersionToLocalState(input);
      // CAS 冲突：一行都没改，直接把 null 交回给调用方。
      if (!result || !result.created) return result;
      try {
        await persistMemoryState();
      } catch (error) {
        memoryState.personalMemory = before;
        memoryState.emotionDailyLetters = beforeLetters;
        throw error;
      }
      return result;
    });
  }

  // 有界重试：唯一索引撞车或死锁都意味着「有人抢先提交了」，
  // 重开一个事务就能看见对方的结果——要么发现这是重放，要么算出下一个版本号。
  // 不无限重试：真的持续冲突说明有别的问题，应该报出来而不是自己转圈。
  const MAX_APPEND_ATTEMPTS = 5;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await appendLetterVersionOnce(db, input);
    } catch (error) {
      const retryable = isDuplicateKeyError(error) || isDeadlockError(error);
      if (!retryable || attempt >= MAX_APPEND_ATTEMPTS) throw error;
    }
  }
}

async function appendLetterVersionOnce(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  input: AppendDailyLetterVersionInput
): Promise<AppendDailyLetterVersionResult | null> {
  return db.transaction(async tx => {
    // 刻意**不**在这里用 SELECT ... FOR UPDATE。
    //
    // 当天还没有任何版本时，那是一段空区间；两个事务同时对空区间取锁会各拿到
    // 一个相容的间隙锁，然后都想往这个间隙插入——必然互相等成死锁
    // （2026-09-03 在真实 MySQL 上实测到 ER_LOCK_DEADLOCK）。
    //
    // 改成乐观策略：普通读算版本号 → 直接插入 → 撞唯一索引或死锁就整笔重试。
    // 唯一索引 (userId, letterDate, versionNumber) 才是真正的仲裁者，
    // 重试时是新事务、新快照，看得到对方已经提交的版本。
    const priorVersions = await tx
      .select()
      .from(emotionDailyLetterVersions)
      .where(
        and(
          eq(emotionDailyLetterVersions.userId, input.userId),
          eq(emotionDailyLetterVersions.letterDate, input.letterDate)
        )
      );
    const priorRecords = priorVersions.map(letterVersionRowToRecord);

    // 幂等：同一 action ID 已经产生过版本就原样返回，不再追加。
    const replay = priorRecords.find(
      version => version.actionId === input.actionId
    );
    if (replay) {
      const letter = await readDailyLetterRowInTx(
        tx,
        input.userId,
        input.letterDate
      );
      if (!letter) throw new Error("来信版本存在但日期级投影缺失");
      return { version: replay, letter, created: false };
    }

    const current = currentLetterVersion(priorRecords);
    // 向前兼容：U1 之前写下的日期级行没有任何版本，但它的 revision 是真的。
    // 从它起算，否则第一次经过版本权威的写入会把 revision 从 3 打回 1，
    // 而 legacy 的 CAS 调用方正拿着 3 在等。
    const legacyRow = current
      ? null
      : await readDailyLetterRowInTx(tx, input.userId, input.letterDate);
    const currentNumber =
      current?.envelope.versionNumber ?? legacyRow?.revision ?? 0;
    if (
      input.expectedCurrentVersionNumber !== undefined &&
      input.expectedCurrentVersionNumber !== currentNumber
    ) {
      return null;
    }
    const versionNumber = currentNumber + 1;
    const envelope: PersonalMemoryLetterEnvelope = {
      versionNumber,
      generatedAt: now().toISOString(),
      trigger: input.trigger,
      selectorVersion: input.selectorVersion,
      promptVersion: input.promptVersion,
      modelVersion: input.modelVersion,
    };

    await tx.insert(emotionDailyLetterVersions).values({
      userId: input.userId,
      letterDate: input.letterDate,
      versionNumber,
      envelope,
      payload: input.payload,
      privacyEpoch: input.privacyEpoch,
      actionId: input.actionId,
    });
    const [inserted] = await tx
      .select()
      .from(emotionDailyLetterVersions)
      .where(
        and(
          eq(emotionDailyLetterVersions.userId, input.userId),
          eq(emotionDailyLetterVersions.letterDate, input.letterDate),
          eq(emotionDailyLetterVersions.versionNumber, versionNumber)
        )
      )
      .limit(1);
    if (!inserted) throw new Error("来信版本写入后读不回");
    const version = letterVersionRowToRecord(inserted);

    // 同一事务里推进日期级指针与兼容投影。投影完全由版本重建。
    const projected = projectLetterRowFromVersion(version);
    await tx
      .insert(emotionDailyLetters)
      .values({
        userId: projected.userId,
        letterDate: projected.letterDate,
        userMessage: projected.userMessage,
        userMessageSaidAt: input.userMessageSaidAt ?? null,
        userMessageEditedAt: input.userMessageEditedAt ?? null,
        dailyReference: projected.dailyReference,
        analysisSeed: projected.analysisSeed,
        revision: projected.revision,
        currentVersionId: version.id,
      })
      .onDuplicateKeyUpdate({
        set: {
          userMessage: projected.userMessage,
          userMessageSaidAt: input.userMessageSaidAt ?? null,
          userMessageEditedAt: input.userMessageEditedAt ?? null,
          dailyReference: projected.dailyReference,
          analysisSeed: projected.analysisSeed,
          revision: projected.revision,
          currentVersionId: version.id,
          updatedAt: new Date(),
        },
      });
    const letter = await readDailyLetterRowInTx(
      tx,
      input.userId,
      input.letterDate
    );
    if (!letter) throw new Error("日期级投影写入后读不回");
    if (input.personalMemoryCapture) {
      await capturePersonalMemoryEvent(
        { mode: "mysql", tx },
        input.personalMemoryCapture
      );
    }
    return { version, letter, created: true };
  });
}

async function readDailyLetterRowInTx(
  tx: PersonalMemoryMysqlTx,
  userId: number,
  letterDate: string
): Promise<EmotionDailyLetter | null> {
  const [row] = await tx
    .select()
    .from(emotionDailyLetters)
    .where(
      and(
        eq(emotionDailyLetters.userId, userId),
        eq(emotionDailyLetters.letterDate, letterDate)
      )
    )
    .limit(1);
  return row ?? null;
}

/** 本地模式的版本追加。调用方已持有聚合锁，这里只改内存。 */
function appendLetterVersionToLocalState(
  input: AppendDailyLetterVersionInput
): AppendDailyLetterVersionResult | null {
  const state = memoryState.personalMemory;
  const sameDay = state.letterVersions.filter(
    version =>
      version.userId === input.userId && version.letterDate === input.letterDate
  );
  const replay = sameDay.find(version => version.actionId === input.actionId);
  if (replay) {
    const letter = memoryState.emotionDailyLetters.find(
      row => row.userId === input.userId && row.letterDate === input.letterDate
    );
    if (!letter) throw new Error("来信版本存在但日期级投影缺失");
    return { version: replay, letter, created: false };
  }

  const currentVersion = currentLetterVersion(sameDay);
  const legacyRow = currentVersion
    ? null
    : memoryState.emotionDailyLetters.find(
        row =>
          row.userId === input.userId && row.letterDate === input.letterDate
      );
  // 见 MySQL 分支的同名注释：存量行的 revision 必须被继承，不能从 1 重来。
  const currentNumber =
    currentVersion?.envelope.versionNumber ?? legacyRow?.revision ?? 0;
  if (
    input.expectedCurrentVersionNumber !== undefined &&
    input.expectedCurrentVersionNumber !== currentNumber
  ) {
    return null;
  }
  const versionNumber = currentNumber + 1;
  const stamp = now().toISOString();
  const version: PersonalMemoryLetterVersionRecord = {
    id: state.nextIds.letterVersion,
    userId: input.userId,
    letterDate: input.letterDate,
    envelope: {
      versionNumber,
      generatedAt: stamp,
      trigger: input.trigger,
      selectorVersion: input.selectorVersion,
      promptVersion: input.promptVersion,
      modelVersion: input.modelVersion,
    },
    payload: input.payload,
    privacyEpoch: input.privacyEpoch,
    actionId: input.actionId,
    createdAt: stamp,
  };
  state.nextIds.letterVersion += 1;
  state.letterVersions.push(version);

  const projected = projectLetterRowFromVersion(version);
  const current = now();
  const existing = memoryState.emotionDailyLetters.find(
    row => row.userId === input.userId && row.letterDate === input.letterDate
  );
  if (existing) {
    existing.userMessage = projected.userMessage;
    existing.userMessageSaidAt = input.userMessageSaidAt ?? null;
    existing.userMessageEditedAt = input.userMessageEditedAt ?? null;
    existing.dailyReference = projected.dailyReference;
    existing.analysisSeed = projected.analysisSeed;
    existing.revision = projected.revision;
    existing.currentVersionId = version.id;
    existing.updatedAt = current;
    captureLetterMessageLocally(input);
    return { version, letter: existing, created: true };
  }
  const letter: EmotionDailyLetter = {
    id: nextMemoryId("emotionDailyLetter"),
    userId: input.userId,
    letterDate: input.letterDate,
    userMessage: projected.userMessage,
    userMessageSaidAt: input.userMessageSaidAt ?? null,
    userMessageEditedAt: input.userMessageEditedAt ?? null,
    dailyReference: projected.dailyReference,
    analysisSeed: projected.analysisSeed,
    revision: projected.revision,
    currentVersionId: version.id,
    createdAt: current,
    updatedAt: current,
  };
  memoryState.emotionDailyLetters.push(letter);
  captureLetterMessageLocally(input);
  return { version, letter, created: true };
}

/** 见 AppendDailyLetterVersionInput.personalMemoryCapture：同聚合，无需 outbox。 */
function captureLetterMessageLocally(
  input: AppendDailyLetterVersionInput
): void {
  if (!input.personalMemoryCapture) return;
  applyPersonalMemoryCapture(
    memoryState.personalMemory,
    input.personalMemoryCapture
  );
}

/** 列出某天的全部版本，按版本号升序。历史版本只读。 */
export async function listEmotionDailyLetterVersions(
  userId: number,
  letterDate: string
): Promise<PersonalMemoryLetterVersionRecord[]> {
  const db = await getDb();
  if (!db) {
    return memoryState.personalMemory.letterVersions
      .filter(
        version =>
          version.userId === userId && version.letterDate === letterDate
      )
      .sort(
        (left, right) =>
          left.envelope.versionNumber - right.envelope.versionNumber
      );
  }
  const rows = await db
    .select()
    .from(emotionDailyLetterVersions)
    .where(
      and(
        eq(emotionDailyLetterVersions.userId, userId),
        eq(emotionDailyLetterVersions.letterDate, letterDate)
      )
    )
    .orderBy(emotionDailyLetterVersions.versionNumber);
  return rows.map(letterVersionRowToRecord);
}

/**
 * 把 prompt-lineage 聚合积压的个人记忆 outbox 投影进统一足迹索引（仅本地模式）。
 *
 * 这是跨聚合那一跳：聊天与 outbox 已经在 prompt-lineage 里安全落盘了，
 * 这里只负责把它搬进 local-persist 的足迹索引。中途崩溃是安全的——
 * 下一次调用会从水位续投，重复投递也不会翻倍（见 projectPersonalMemoryOutbox）。
 *
 * 已投影的条目不立刻删：删一次就要多写一遍整份 prompt-lineage 文件，
 * 而那份文件在一次对话里本来就要写好几遍。改成积压超过阈值才裁剪一次，
 * 既不让 outbox 无限长大（2026-07-08 的 383MB 事故就是这么来的），
 * 也不给每一轮对话增加一次全量重写。
 */
const PERSONAL_MEMORY_OUTBOX_PRUNE_THRESHOLD = 200;

export async function drainLocalPersonalMemoryOutbox(): Promise<{
  applied: number;
  pruned: number;
}> {
  const db = await getDb();
  if (db) return { applied: 0, pruned: 0 };
  await ensureLocalPromptLineageLoaded();
  const entries = memoryState.promptLineage.personalMemoryOutbox;
  if (entries.length === 0) return { applied: 0, pruned: 0 };

  const result = await projectPersonalMemoryOutboxIntoIndex(
    "promptLineage",
    entries
  );

  const projected = entries.filter(entry => entry.seq <= result.watermark);
  if (projected.length < PERSONAL_MEMORY_OUTBOX_PRUNE_THRESHOLD) {
    return { applied: result.applied, pruned: 0 };
  }
  // 只裁剪水位之下的条目：水位之上的还没投影，删了就真丢了。
  const remaining = entries.filter(entry => entry.seq > result.watermark);
  memoryState.promptLineage.personalMemoryOutbox = remaining;
  await persistLocalPromptLineageStateToDisk(memoryState.promptLineage);
  return { applied: result.applied, pruned: projected.length };
}

// ─── 个人记忆（U5）：提炼任务队列与理解状态机 ───────────────────────────
//
// 这一段建在 U1-U3 的事件/来源基础设施之上。核心不变量：
//
//   1. reinforce／supersede 只能作用在当前恰好是 active 的 lineage tip 上；
//      任何用户动作或另一个任务抢先完成，都会让这里判定「过期，丢弃」而
//      不是覆盖。判定逻辑在 shared/personalMemory.ts，MySQL 与本地各自
//      负责读出同一形状的切片喂给它。
//   2. 手动动作（纠正／归档／恢复／忘记）自己也生成一条 sourceType=insight
//      的经历，让理解状态的变化本身可追溯；提炼驱动的 reinforce 复用触发
//      它的原始事件作证据，不再造一条合成事件。

export type PersonalMemoryInsightRow = PersonalMemoryInsightRecord;

function rowToPersonalMemoryInsight(row: {
  id: number;
  userId: number;
  lineageKey: string;
  revision: number;
  state: string;
  origin: string;
  category: string;
  text: string | null;
  scope: unknown;
  confidence: number;
  allowProactiveMention: boolean;
  supersededByInsightId: number | null;
  createdAt: Date;
  updatedAt: Date;
}): PersonalMemoryInsightRecord {
  return {
    id: row.id,
    userId: row.userId,
    lineageKey: row.lineageKey,
    revision: row.revision,
    state: row.state as PersonalMemoryInsightRecord["state"],
    origin: row.origin as PersonalMemoryInsightRecord["origin"],
    category: row.category as PersonalMemoryInsightRecord["category"],
    text: row.text,
    scope: (row.scope as Record<string, unknown> | null) ?? null,
    confidence: row.confidence,
    allowProactiveMention: row.allowProactiveMention,
    supersededByInsightId: row.supersededByInsightId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function rowToPersonalMemoryEvidence(row: {
  id: number;
  userId: number;
  insightId: number;
  eventId: number;
  sourceRevision: string;
  createdAt: Date;
}): PersonalMemoryEvidenceRecord {
  return {
    id: row.id,
    userId: row.userId,
    insightId: row.insightId,
    eventId: row.eventId,
    sourceRevision: row.sourceRevision,
    createdAt: row.createdAt.toISOString(),
  };
}

function rowToPersonalMemoryJob(row: {
  id: number;
  userId: number;
  eventId: number;
  operationId: string;
  extractorVersion: string;
  state: string;
  attempts: number;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
  availableAt: Date;
  lastErrorKind: string | null;
  createdAt: Date;
  updatedAt: Date;
}): PersonalMemoryJobRecord {
  return {
    id: row.id,
    userId: row.userId,
    eventId: row.eventId,
    operationId: row.operationId,
    extractorVersion: row.extractorVersion,
    state: row.state as PersonalMemoryJobRecord["state"],
    attempts: row.attempts,
    leaseToken: row.leaseToken,
    leaseExpiresAt: row.leaseExpiresAt ? row.leaseExpiresAt.toISOString() : null,
    availableAt: row.availableAt.toISOString(),
    lastErrorKind: row.lastErrorKind,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── 任务 claim／完成／失败 ─────────────────────────────────────────────

export type ClaimPersonalMemoryJobsInput = {
  /** 单轮最多 claim 多少条。 */
  limit: number;
  leaseMs: number;
  now?: Date;
};

/**
 * 逐条 claim，而不是一条 UPDATE 批量抢。
 *
 * 用「UPDATE ... WHERE id = (SELECT id ... LIMIT 1)」这个经典 MySQL 原子
 * 单行写法：两个并发 runner 的子查询可能选中同一行，但只有一个 UPDATE 真的
 * 生效——InnoDB 对 UPDATE 命中的行做当前读，第二个事务重新求值 WHERE 时
 * 这行状态已经变了，affectedRows=0，直接跳过。不需要 SKIP LOCKED，也不会
 * 死锁：每次只碰一行，不会有两个事务同时握着不同行互相等对方。
 *
 * 过期 lease 的回收不需要单独一步——WHERE 条件本身就把
 * `state='claimed' AND leaseExpiresAt<now` 当作可 claim，启动时第一轮
 * claim 自然把它们收回来。
 */
export async function claimPersonalMemoryJobs(
  input: ClaimPersonalMemoryJobsInput
): Promise<PersonalMemoryJobRecord[]> {
  const now = input.now ?? new Date();
  const leaseExpiresAt = new Date(now.getTime() + input.leaseMs);
  const limit = Math.max(0, Math.min(50, Math.floor(input.limit)));
  if (limit === 0) return [];

  const db = await getDb();
  if (!db) {
    return withLocalAggregateMutationLock(async () => {
      const state = memoryState.personalMemory;
      const claimed: PersonalMemoryJobRecord[] = [];
      const eligible = state.jobs
        .filter(
          job =>
            job.state === "pending" ||
            (job.state === "claimed" &&
              job.leaseExpiresAt !== null &&
              new Date(job.leaseExpiresAt).getTime() < now.getTime())
        )
        .sort((a, b) => a.availableAt.localeCompare(b.availableAt) || a.id - b.id)
        .filter(job => new Date(job.availableAt).getTime() <= now.getTime());
      for (const job of eligible.slice(0, limit)) {
        job.state = "claimed";
        job.leaseToken = randomUUID();
        job.leaseExpiresAt = leaseExpiresAt.toISOString();
        job.attempts += 1;
        job.updatedAt = now.toISOString();
        claimed.push({ ...job });
      }
      if (claimed.length > 0) await persistMemoryState();
      return claimed;
    });
  }

  const claimed: PersonalMemoryJobRecord[] = [];
  for (let i = 0; i < limit; i += 1) {
    const row = await claimOnePersonalMemoryJobRow(db, now, leaseExpiresAt);
    if (!row) break; // 没有更多可 claim 的了
    claimed.push(rowToPersonalMemoryJob(row));
  }
  return claimed;
}

/**
 * 单行原子 claim，带死锁重试。
 *
 * 这条 `UPDATE ... WHERE id = (SELECT ... ORDER BY ... LIMIT 1)` 即使只有
 * 一行数据、即使不带 FOR UPDATE，在真实 MySQL 上仍然会死锁——InnoDB 给
 * range 条件扫描加的是 next-key lock，锁的是它扫过的整段间隙，不只是最终
 * 命中的那一行。两个并发事务的扫描顺序一旦交叉，就会互相等对方持有的间隙
 * 锁。这在只有本地文件模式和 tsc 类型检查时完全看不出来，2026-09-04 用真实
 * MySQL 跑并发 claim 测试时才复现——和来信版本首次并发追加的死锁是同一类
 * 根因，修法也一样：不是避免这条语句，而是死锁了就重试，因为重试就是新
 * 事务、新快照，两边不会永远互相卡住。
 */
async function claimOnePersonalMemoryJobRow(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  now: Date,
  leaseExpiresAt: Date
): Promise<
  | {
      id: number;
      userId: number;
      eventId: number;
      operationId: string;
      extractorVersion: string;
      state: string;
      attempts: number;
      leaseToken: string | null;
      leaseExpiresAt: Date | null;
      availableAt: Date;
      lastErrorKind: string | null;
      createdAt: Date;
      updatedAt: Date;
    }
  | null
> {
  const MAX_CLAIM_ATTEMPTS = 5;
  for (let attempt = 1; ; attempt += 1) {
    const leaseToken = randomUUID();
    try {
      const result = await db.execute(sql`
        UPDATE personal_memory_jobs
        SET state = 'claimed',
            leaseToken = ${leaseToken},
            leaseExpiresAt = ${leaseExpiresAt},
            attempts = attempts + 1,
            updatedAt = NOW()
        WHERE id = (
          SELECT id FROM (
            SELECT id FROM personal_memory_jobs
            WHERE (state = 'pending' OR (state = 'claimed' AND leaseExpiresAt < ${now}))
              AND availableAt <= ${now}
            ORDER BY availableAt ASC, id ASC
            LIMIT 1
          ) AS eligible
        )
      `);
      const affected = (result as unknown as [{ affectedRows: number }])[0]
        ?.affectedRows;
      if (!affected) return null; // 没有更多可 claim 的了
      const [row] = await db
        .select()
        .from(personalMemoryJobs)
        .where(eq(personalMemoryJobs.leaseToken, leaseToken))
        .limit(1);
      return row ?? null;
    } catch (error) {
      if (!isDeadlockError(error) || attempt >= MAX_CLAIM_ATTEMPTS) throw error;
      // 不无限重试：持续死锁说明有别的问题，应该报出来而不是自己转圈。
    }
  }
}

export type PersonalMemoryExtractionCompletion = {
  jobId: number;
  leaseToken: string;
  userId: number;
  eventId: number;
  mutations: PersonalMemoryInsightMutation[];
};

export type PersonalMemoryAppliedMutation = {
  mutation: PersonalMemoryInsightMutation;
  outcome: string;
  /**
   * 实际写入／命中的理解行 ID；判 stale 时为 null。
   * 调用方要靠它精确定位这次写了哪条，而不是回头查「最近更新的一条」——
   * 同一毫秒内建两条时那种查法是不稳定的。
   */
  insightId: number | null;
  /** 这条理解的 lineage；判 stale 时为 null。 */
  lineageKey: string | null;
};

export type PersonalMemoryExtractionCompletionResult = {
  /** false = 任务已被别的 runner 抢占完成，本次结果整体丢弃。 */
  jobClaimValid: boolean;
  /** 事件在完成前被删除内容或被抑制，结果被丢弃但任务仍标记成功。 */
  discarded: "content_scrubbed" | "event_suppressed" | null;
  applied: PersonalMemoryAppliedMutation[];
};

/**
 * 提炼完成：在同一个事务／本地聚合锁内验证 lease、按序应用每条 mutation、
 * 把任务标成功。这是「旧任务不能覆盖新纠正」的落地点——
 * 每条 mutation 都在这里重新读一次目标 lineage 的当前状态再判定。
 */
export async function completePersonalMemoryExtractionJob(
  input: PersonalMemoryExtractionCompletion
): Promise<PersonalMemoryExtractionCompletionResult> {
  const db = await getDb();
  if (!db) {
    return withLocalAggregateMutationLock(async () => {
      const before = structuredClone(memoryState.personalMemory);
      try {
        const result = applyExtractionCompletionLocally(
          memoryState.personalMemory,
          input
        );
        if (result.jobClaimValid) await persistMemoryState();
        return result;
      } catch (error) {
        memoryState.personalMemory = before;
        throw error;
      }
    });
  }
  return db.transaction(tx => applyExtractionCompletionMysql(tx, input));
}

/** 本地模式：在给定状态上应用一次提炼完成。原地修改，失败时调用方整份还原。 */
function applyExtractionCompletionLocally(
  state: PersonalMemoryLocalState,
  input: PersonalMemoryExtractionCompletion
): PersonalMemoryExtractionCompletionResult {
  const job = state.jobs.find(item => item.id === input.jobId);
  if (!job || job.leaseToken !== input.leaseToken || job.state !== "claimed") {
    return { jobClaimValid: false, discarded: null, applied: [] };
  }

  const now = new Date().toISOString();
  const finish = (
    discarded: PersonalMemoryExtractionCompletionResult["discarded"],
    applied: PersonalMemoryExtractionCompletionResult["applied"]
  ): PersonalMemoryExtractionCompletionResult => {
    job.state = "succeeded";
    job.leaseToken = null;
    job.leaseExpiresAt = null;
    job.updatedAt = now;
    return { jobClaimValid: true, discarded, applied };
  };

  const event = state.events.find(item => item.id === input.eventId);
  if (!event || event.contentScrubbed) {
    return finish("content_scrubbed", []);
  }
  if (isEventSuppressedLocally(state, input.userId, input.eventId)) {
    return finish("event_suppressed", []);
  }

  const applied: PersonalMemoryExtractionCompletionResult["applied"] = [];
  for (const mutation of input.mutations) {
    applied.push({
      mutation,
      ...applyInsightMutationLocally(state, input.userId, event, mutation),
    });
  }
  return finish(null, applied);
}

function isEventSuppressedLocally(
  state: PersonalMemoryLocalState,
  userId: number,
  eventId: number
): boolean {
  return state.suppressions.some(
    row => row.userId === userId && row.suppressedEventIds.includes(eventId)
  );
}

/**
 * 应用单条 mutation 到本地状态，返回一个人类可读的结果标签（供测试断言）。
 *
 * 按 `mutation.action` 分支（而不是 `decision.kind`）是为了让 TypeScript
 * 的判别联合在分支内正确收窄——`decideInsightMutation` 的返回类型和
 * `mutation` 是分开算出来的两个值，编译器关联不起来，只有判在 `mutation`
 * 自己的判别字段上才能拿到 `mutation.text` 这些字段。
 */
function applyInsightMutationLocally(
  state: PersonalMemoryLocalState,
  userId: number,
  event: PersonalMemoryEventRecord,
  mutation: PersonalMemoryInsightMutation
): Omit<PersonalMemoryAppliedMutation, "mutation"> {
  const now = new Date().toISOString();
  const lineageKey =
    mutation.action === "new" ? randomUUID() : mutation.lineageKey;
  const view: PersonalMemoryInsightLineageView = {
    revisions: state.insights.filter(
      row => row.userId === userId && row.lineageKey === lineageKey
    ),
  };
  const decision = decideInsightMutation(mutation, lineageKey, view);
  if (decision.kind === "stale") {
    return { outcome: `stale: ${decision.reason}`, insightId: null, lineageKey: null };
  }

  if (mutation.action === "new") {
    const insight: PersonalMemoryInsightRecord = {
      id: state.nextIds.insight,
      userId,
      lineageKey,
      revision: 1,
      state: "active",
      origin: mutation.origin,
      category: mutation.category,
      text: mutation.text,
      scope: mutation.scope,
      confidence: mutation.confidence,
      allowProactiveMention: mutation.allowProactiveMention,
      supersededByInsightId: null,
      createdAt: now,
      updatedAt: now,
    };
    state.nextIds.insight += 1;
    state.insights.push(insight);
    addEvidenceLocally(state, userId, insight.id, event.id, event.sourceRevision);
    return { outcome: "created", insightId: insight.id, lineageKey };
  }

  if (mutation.action === "reinforce") {
    if (decision.kind !== "reinforce") {
      throw new Error(`internal invariant: reinforce mutation produced ${decision.kind} decision`);
    }
    decision.target.confidence = reinforceInsightConfidence(
      decision.target.confidence
    );
    decision.target.updatedAt = now;
    addEvidenceLocally(
      state,
      userId,
      decision.target.id,
      event.id,
      event.sourceRevision
    );
    return {
      outcome: "reinforced",
      insightId: decision.target.id,
      lineageKey,
    };
  }

  // supersede
  if (decision.kind !== "supersede") {
    throw new Error(`internal invariant: supersede mutation produced ${decision.kind} decision`);
  }
  decision.target.state = "superseded";
  decision.target.updatedAt = now;
  const next: PersonalMemoryInsightRecord = {
    id: state.nextIds.insight,
    userId,
    lineageKey,
    revision: decision.target.revision + 1,
    state: "active",
    origin: mutation.origin,
    category: mutation.category,
    text: mutation.text,
    scope: mutation.scope,
    confidence: mutation.confidence,
    allowProactiveMention: mutation.allowProactiveMention,
    supersededByInsightId: null,
    createdAt: now,
    updatedAt: now,
  };
  state.nextIds.insight += 1;
  state.insights.push(next);
  decision.target.supersededByInsightId = next.id;
  addEvidenceLocally(state, userId, next.id, event.id, event.sourceRevision);
  return { outcome: "superseded", insightId: next.id, lineageKey };
}

function addEvidenceLocally(
  state: PersonalMemoryLocalState,
  userId: number,
  insightId: number,
  eventId: number,
  sourceRevision: string
): void {
  const existing = state.evidence.find(
    row => row.insightId === insightId && row.eventId === eventId
  );
  if (existing) return; // (insightId, eventId) 唯一，重放幂等
  state.evidence.push({
    id: state.nextIds.evidence,
    userId,
    insightId,
    eventId,
    sourceRevision,
    createdAt: new Date().toISOString(),
  });
  state.nextIds.evidence += 1;
}

/** MySQL 模式：同一事务内完成一次提炼。 */
async function applyExtractionCompletionMysql(
  tx: PersonalMemoryMysqlTx,
  input: PersonalMemoryExtractionCompletion
): Promise<PersonalMemoryExtractionCompletionResult> {
  const [jobRow] = await tx
    .select()
    .from(personalMemoryJobs)
    .where(eq(personalMemoryJobs.id, input.jobId))
    .limit(1);
  if (
    !jobRow ||
    jobRow.leaseToken !== input.leaseToken ||
    jobRow.state !== "claimed"
  ) {
    return { jobClaimValid: false, discarded: null, applied: [] };
  }

  const finish = async (
    discarded: PersonalMemoryExtractionCompletionResult["discarded"],
    applied: PersonalMemoryExtractionCompletionResult["applied"]
  ): Promise<PersonalMemoryExtractionCompletionResult> => {
    await tx
      .update(personalMemoryJobs)
      .set({ state: "succeeded", leaseToken: null, leaseExpiresAt: null })
      .where(eq(personalMemoryJobs.id, input.jobId));
    return { jobClaimValid: true, discarded, applied };
  };

  const [eventRow] = await tx
    .select()
    .from(personalMemoryEvents)
    .where(eq(personalMemoryEvents.id, input.eventId))
    .limit(1);
  if (!eventRow || eventRow.contentScrubbed) {
    return finish("content_scrubbed", []);
  }
  const event = rowToPersonalMemoryEvent(eventRow);

  const [suppressionRow] = await tx
    .select({ suppressedEventIds: personalMemorySuppressions.suppressedEventIds })
    .from(personalMemorySuppressions)
    .where(
      and(
        eq(personalMemorySuppressions.userId, input.userId),
        sql`JSON_CONTAINS(${personalMemorySuppressions.suppressedEventIds}, ${JSON.stringify(input.eventId)})`
      )
    )
    .limit(1);
  if (suppressionRow) return finish("event_suppressed", []);

  const applied: PersonalMemoryExtractionCompletionResult["applied"] = [];
  for (const mutation of input.mutations) {
    applied.push({
      mutation,
      ...(await applyInsightMutationMysql(tx, input.userId, event, mutation)),
    });
  }
  return finish(null, applied);
}

/**
 * 按 `mutation.action` 分支（而不是 `decision.kind`），理由同本地版本：
 * `decision` 与 `mutation` 是分开算出来的两个值，只有判在 `mutation` 自己的
 * 判别字段上，TypeScript 才能在分支内正确收窄出 `mutation.text` 这些字段。
 */
async function applyInsightMutationMysql(
  tx: PersonalMemoryMysqlTx,
  userId: number,
  event: PersonalMemoryEventRecord,
  mutation: PersonalMemoryInsightMutation
): Promise<Omit<PersonalMemoryAppliedMutation, "mutation">> {
  const lineageKey =
    mutation.action === "new" ? randomUUID() : mutation.lineageKey;
  const rows = await tx
    .select()
    .from(personalMemoryInsights)
    .where(
      and(
        eq(personalMemoryInsights.userId, userId),
        eq(personalMemoryInsights.lineageKey, lineageKey)
      )
    )
    .for("update");
  const revisions = rows.map(rowToPersonalMemoryInsight);
  const decision = decideInsightMutation(mutation, lineageKey, { revisions });
  if (decision.kind === "stale") {
    return { outcome: `stale: ${decision.reason}`, insightId: null, lineageKey: null };
  }

  if (mutation.action === "new") {
    await tx.insert(personalMemoryInsights).values({
      userId,
      lineageKey,
      revision: 1,
      state: "active",
      origin: mutation.origin,
      category: mutation.category,
      text: mutation.text,
      scope: mutation.scope,
      confidence: mutation.confidence,
      allowProactiveMention: mutation.allowProactiveMention,
    });
    const [created] = await tx
      .select({ id: personalMemoryInsights.id })
      .from(personalMemoryInsights)
      .where(
        and(
          eq(personalMemoryInsights.userId, userId),
          eq(personalMemoryInsights.lineageKey, lineageKey),
          eq(personalMemoryInsights.revision, 1)
        )
      )
      .limit(1);
    if (created) {
      await addEvidenceMysql(tx, userId, created.id, event.id, event.sourceRevision);
    }
    return { outcome: "created", insightId: created?.id ?? null, lineageKey };
  }

  if (mutation.action === "reinforce") {
    if (decision.kind !== "reinforce") {
      throw new Error(`internal invariant: reinforce mutation produced ${decision.kind} decision`);
    }
    await tx
      .update(personalMemoryInsights)
      .set({
        confidence: reinforceInsightConfidence(decision.target.confidence),
      })
      .where(eq(personalMemoryInsights.id, decision.target.id));
    await addEvidenceMysql(
      tx,
      userId,
      decision.target.id,
      event.id,
      event.sourceRevision
    );
    return {
      outcome: "reinforced",
      insightId: decision.target.id,
      lineageKey,
    };
  }

  // supersede
  if (decision.kind !== "supersede") {
    throw new Error(`internal invariant: supersede mutation produced ${decision.kind} decision`);
  }
  const nextRevision = decision.target.revision + 1;
  await tx.insert(personalMemoryInsights).values({
    userId,
    lineageKey,
    revision: nextRevision,
    state: "active",
    origin: mutation.origin,
    category: mutation.category,
    text: mutation.text,
    scope: mutation.scope,
    confidence: mutation.confidence,
    allowProactiveMention: mutation.allowProactiveMention,
  });
  const [created] = await tx
    .select({ id: personalMemoryInsights.id })
    .from(personalMemoryInsights)
    .where(
      and(
        eq(personalMemoryInsights.userId, userId),
        eq(personalMemoryInsights.lineageKey, lineageKey),
        eq(personalMemoryInsights.revision, nextRevision)
      )
    )
    .limit(1);
  await tx
    .update(personalMemoryInsights)
    .set({
      state: "superseded",
      supersededByInsightId: created?.id ?? null,
    })
    .where(eq(personalMemoryInsights.id, decision.target.id));
  if (created) {
    await addEvidenceMysql(tx, userId, created.id, event.id, event.sourceRevision);
  }
  return { outcome: "superseded", insightId: created?.id ?? null, lineageKey };
}

async function addEvidenceMysql(
  tx: PersonalMemoryMysqlTx,
  userId: number,
  insightId: number,
  eventId: number,
  sourceRevision: string
): Promise<void> {
  await tx
    .insert(personalMemoryEvidence)
    .values({ userId, insightId, eventId, sourceRevision })
    .onDuplicateKeyUpdate({ set: { sourceRevision } }); // (insightId, eventId) 唯一，重放幂等
}

export type FailPersonalMemoryJobInput = {
  jobId: number;
  leaseToken: string;
  errorKind: string;
  /** true：任务永久失败，不再重试。false：退避后重新排队。 */
  permanent: boolean;
  /** 非永久失败时的下次可用时间。 */
  nextAvailableAt?: Date;
};

/**
 * 任务失败处理。条件更新在 leaseToken 上：过期 lease 被别人抢先 claim
 * 后再回来失败，这里直接不生效（affectedRows=0／本地找不到匹配），
 * 不会覆盖新 claim 的状态。
 */
export async function failPersonalMemoryJob(
  input: FailPersonalMemoryJobInput
): Promise<boolean> {
  const nextState = input.permanent ? "permanently_failed" : "pending";
  const db = await getDb();
  if (!db) {
    return withLocalAggregateMutationLock(async () => {
      const job = memoryState.personalMemory.jobs.find(
        item => item.id === input.jobId
      );
      if (!job || job.leaseToken !== input.leaseToken || job.state !== "claimed") {
        return false;
      }
      job.state = nextState;
      job.leaseToken = null;
      job.leaseExpiresAt = null;
      job.lastErrorKind = input.errorKind;
      job.updatedAt = new Date().toISOString();
      if (!input.permanent && input.nextAvailableAt) {
        job.availableAt = input.nextAvailableAt.toISOString();
      }
      await persistMemoryState();
      return true;
    });
  }
  const result = await db
    .update(personalMemoryJobs)
    .set({
      state: nextState,
      leaseToken: null,
      leaseExpiresAt: null,
      lastErrorKind: input.errorKind,
      ...(!input.permanent && input.nextAvailableAt
        ? { availableAt: input.nextAvailableAt }
        : {}),
    })
    .where(
      and(
        eq(personalMemoryJobs.id, input.jobId),
        eq(personalMemoryJobs.leaseToken, input.leaseToken),
        eq(personalMemoryJobs.state, "claimed")
      )
    );
  return result[0].affectedRows === 1;
}

/** 单个任务当前状态；供 runner 的 kill switch 判断残留积压时读取。 */
export async function countPendingPersonalMemoryJobs(): Promise<number> {
  const db = await getDb();
  if (!db) {
    return memoryState.personalMemory.jobs.filter(
      job => job.state === "pending"
    ).length;
  }
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(personalMemoryJobs)
    .where(eq(personalMemoryJobs.state, "pending"));
  return Number(row?.count ?? 0);
}

// ─── 提炼候选与抑制检查 ─────────────────────────────────────────────────

/**
 * 喂给模型的「可能冲突」候选：这个用户当前活跃的理解，最近更新的在前。
 * 数量必须小——「提炼输入只包含单个经历及最少冲突候选」，不是全量召回。
 */
export async function listActivePersonalMemoryInsightCandidates(
  userId: number,
  limit: number
): Promise<PersonalMemoryInsightRecord[]> {
  const safeLimit = Math.max(0, Math.min(20, Math.floor(limit)));
  if (safeLimit === 0) return [];
  const db = await getDb();
  if (!db) {
    return memoryState.personalMemory.insights
      .filter(row => row.userId === userId && row.state === "active")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, safeLimit);
  }
  const rows = await db
    .select()
    .from(personalMemoryInsights)
    .where(
      and(
        eq(personalMemoryInsights.userId, userId),
        eq(personalMemoryInsights.state, "active")
      )
    )
    .orderBy(desc(personalMemoryInsights.updatedAt))
    .limit(safeLimit);
  return rows.map(rowToPersonalMemoryInsight);
}

/** 这条事件的证据是否被某条忘记 tombstone 永久禁止再次生成理解。 */
export async function isPersonalMemoryEventSuppressed(
  userId: number,
  eventId: number
): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    return memoryState.personalMemory.suppressions.some(
      row => row.userId === userId && row.suppressedEventIds.includes(eventId)
    );
  }
  const [row] = await db
    .select({ id: personalMemorySuppressions.id })
    .from(personalMemorySuppressions)
    .where(
      and(
        eq(personalMemorySuppressions.userId, userId),
        sql`JSON_CONTAINS(${personalMemorySuppressions.suppressedEventIds}, ${JSON.stringify(eventId)})`
      )
    )
    .limit(1);
  return Boolean(row);
}

/** 读一条 lineage 的全部修订，按 revision 升序。供测试与展示用。 */
export async function listPersonalMemoryInsightLineage(
  userId: number,
  lineageKey: string
): Promise<PersonalMemoryInsightRecord[]> {
  const db = await getDb();
  if (!db) {
    return memoryState.personalMemory.insights
      .filter(row => row.userId === userId && row.lineageKey === lineageKey)
      .sort((a, b) => a.revision - b.revision);
  }
  const rows = await db
    .select()
    .from(personalMemoryInsights)
    .where(
      and(
        eq(personalMemoryInsights.userId, userId),
        eq(personalMemoryInsights.lineageKey, lineageKey)
      )
    )
    .orderBy(personalMemoryInsights.revision);
  return rows.map(rowToPersonalMemoryInsight);
}

export async function listPersonalMemoryEvidenceForInsight(
  insightId: number
): Promise<PersonalMemoryEvidenceRecord[]> {
  const db = await getDb();
  if (!db) {
    return memoryState.personalMemory.evidence.filter(
      row => row.insightId === insightId
    );
  }
  const rows = await db
    .select()
    .from(personalMemoryEvidence)
    .where(eq(personalMemoryEvidence.insightId, insightId));
  return rows.map(rowToPersonalMemoryEvidence);
}

// ─── 理解状态迁移：归档／恢复／忘记／来源清空 ───────────────────────────
//
// 四个都是**用户可见动作**（或由删除传播触发），所以各自都在同一事务里
// 补一条 `sourceType: "insight"` 的经历，让状态变化本身可追溯——footprint
// 以后能说清楚「这条理解是哪天被归档/恢复/忘记的」。提炼驱动的 reinforce
// 不需要这个：它复用触发它的原始事件作证据，没有「新状态变化」要交代。

export type LineageStateChangeResult =
  | { outcome: "applied"; insightId: number }
  | { outcome: "invalid"; reason: string };

async function recordInsightLifecycleEventInTx(
  scope: PersonalMemoryTxScope,
  input: {
    userId: number;
    lineageKey: string;
    revision: number;
    actionKind: Extract<
      PersonalMemoryEventIdentity["actionKind"],
      | "insight_archived"
      | "insight_restored"
      | "insight_forgotten"
      | "insight_corrected"
    >;
  }
): Promise<void> {
  const now = new Date();
  await capturePersonalMemoryEvent(scope, {
    identity: {
      userId: input.userId,
      sourceType: "insight",
      sourceKey: `insight:${input.lineageKey}`,
      sourceRevision: String(input.revision),
      actionKind: input.actionKind,
      actionId: randomUUID(),
    },
    occurredOn: chinaDateStringLocal(now),
    occurredAt: now.toISOString(),
    snapshot: createEmptyPersonalMemoryEventSnapshot(),
    storyId: null,
    job: null,
  });
}

/** 与 emotionDailyReference302.chinaDateString 同口径，db.ts 不引入该模块避免循环依赖。 */
function chinaDateStringLocal(date: Date): string {
  return new Date(date.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function archivePersonalMemoryInsightLineage(
  userId: number,
  lineageKey: string
): Promise<LineageStateChangeResult> {
  const db = await getDb();
  if (!db) {
    return withLocalAggregateMutationLock(async () => {
      const before = structuredClone(memoryState.personalMemory);
      try {
        const view = localLineageView(userId, lineageKey);
        const decision = decideLineageStateChange(view, "archived");
        if (decision.kind === "invalid") {
          return { outcome: "invalid", reason: decision.reason } as const;
        }
        decision.target.state = "archived";
        decision.target.updatedAt = new Date().toISOString();
        await recordInsightLifecycleEventInTx(
          { mode: "local", state: memoryState.personalMemory },
          {
            userId,
            lineageKey,
            revision: decision.target.revision,
            actionKind: "insight_archived",
          }
        );
        await persistMemoryState();
        return { outcome: "applied", insightId: decision.target.id } as const;
      } catch (error) {
        memoryState.personalMemory = before;
        throw error;
      }
    });
  }
  return db.transaction(async tx => {
    const view = await mysqlLineageView(tx, userId, lineageKey);
    const decision = decideLineageStateChange(view, "archived");
    if (decision.kind === "invalid") {
      return { outcome: "invalid", reason: decision.reason };
    }
    await tx
      .update(personalMemoryInsights)
      .set({ state: "archived" })
      .where(eq(personalMemoryInsights.id, decision.target.id));
    await recordInsightLifecycleEventInTx(
      { mode: "mysql", tx },
      {
        userId,
        lineageKey,
        revision: decision.target.revision,
        actionKind: "insight_archived",
      }
    );
    return { outcome: "applied", insightId: decision.target.id };
  });
}

export async function restorePersonalMemoryInsightLineage(
  userId: number,
  lineageKey: string
): Promise<LineageStateChangeResult> {
  const db = await getDb();
  if (!db) {
    return withLocalAggregateMutationLock(async () => {
      const before = structuredClone(memoryState.personalMemory);
      try {
        const view = localLineageView(userId, lineageKey);
        const decision = decideLineageStateChange(view, "active");
        if (decision.kind === "invalid") {
          return { outcome: "invalid", reason: decision.reason } as const;
        }
        decision.target.state = "active";
        decision.target.updatedAt = new Date().toISOString();
        await recordInsightLifecycleEventInTx(
          { mode: "local", state: memoryState.personalMemory },
          {
            userId,
            lineageKey,
            revision: decision.target.revision,
            actionKind: "insight_restored",
          }
        );
        await persistMemoryState();
        return { outcome: "applied", insightId: decision.target.id } as const;
      } catch (error) {
        memoryState.personalMemory = before;
        throw error;
      }
    });
  }
  return db.transaction(async tx => {
    const view = await mysqlLineageView(tx, userId, lineageKey);
    const decision = decideLineageStateChange(view, "active");
    if (decision.kind === "invalid") {
      return { outcome: "invalid", reason: decision.reason };
    }
    await tx
      .update(personalMemoryInsights)
      .set({ state: "active" })
      .where(eq(personalMemoryInsights.id, decision.target.id));
    await recordInsightLifecycleEventInTx(
      { mode: "mysql", tx },
      {
        userId,
        lineageKey,
        revision: decision.target.revision,
        actionKind: "insight_restored",
      }
    );
    return { outcome: "applied", insightId: decision.target.id };
  });
}

/**
 * 忘记整条 lineage：清除**全部修订**的正文（不只是当前 tip——历史 superseded
 * 版本也是要忘记的「派生内容」的一部分），建立忘记 tombstone 绑定这条 lineage
 * 历史上出现过的全部证据事件，并在同一事务里递增用户隐私 epoch。
 */
export async function forgetPersonalMemoryInsightLineage(
  userId: number,
  lineageKey: string
): Promise<LineageStateChangeResult> {
  const db = await getDb();
  if (!db) {
    return withLocalAggregateMutationLock(async () => {
      const before = structuredClone(memoryState.personalMemory);
      try {
        const view = localLineageView(userId, lineageKey);
        const decision = decideLineageStateChange(view, "forgotten");
        if (decision.kind === "invalid") {
          return { outcome: "invalid", reason: decision.reason } as const;
        }
        const now = new Date().toISOString();
        const insightIds = new Set(view.revisions.map(row => row.id));
        for (const revision of view.revisions) {
          revision.state = "forgotten";
          revision.text = null;
          revision.updatedAt = now;
        }
        const suppressedEventIds = Array.from(
          new Set(
            memoryState.personalMemory.evidence
              .filter(row => insightIds.has(row.insightId))
              .map(row => row.eventId)
          )
        );
        memoryState.personalMemory.evidence =
          memoryState.personalMemory.evidence.filter(
            row => !insightIds.has(row.insightId)
          );
        const existingSuppression =
          memoryState.personalMemory.suppressions.find(
            row => row.userId === userId && row.lineageKey === lineageKey
          );
        if (existingSuppression) {
          existingSuppression.suppressedEventIds = Array.from(
            new Set([
              ...existingSuppression.suppressedEventIds,
              ...suppressedEventIds,
            ])
          );
        } else {
          memoryState.personalMemory.suppressions.push({
            id: memoryState.personalMemory.nextIds.suppression,
            userId,
            lineageKey,
            suppressedEventIds,
            createdAt: now,
          });
          memoryState.personalMemory.nextIds.suppression += 1;
        }
        bumpPrivacyEpochLocally(userId);
        await recordInsightLifecycleEventInTx(
          { mode: "local", state: memoryState.personalMemory },
          {
            userId,
            lineageKey,
            revision: decision.target.revision,
            actionKind: "insight_forgotten",
          }
        );
        await persistMemoryState();
        return { outcome: "applied", insightId: decision.target.id } as const;
      } catch (error) {
        memoryState.personalMemory = before;
        throw error;
      }
    });
  }
  return db.transaction(async tx => {
    const view = await mysqlLineageView(tx, userId, lineageKey);
    const decision = decideLineageStateChange(view, "forgotten");
    if (decision.kind === "invalid") {
      return { outcome: "invalid", reason: decision.reason };
    }
    const insightIds = view.revisions.map(row => row.id);
    await tx
      .update(personalMemoryInsights)
      .set({ state: "forgotten", text: null })
      .where(
        and(
          eq(personalMemoryInsights.userId, userId),
          inArray(personalMemoryInsights.id, insightIds)
        )
      );
    const evidenceRows = await tx
      .select({ eventId: personalMemoryEvidence.eventId })
      .from(personalMemoryEvidence)
      .where(inArray(personalMemoryEvidence.insightId, insightIds));
    const suppressedEventIds = Array.from(
      new Set(evidenceRows.map(row => row.eventId))
    );
    await tx
      .delete(personalMemoryEvidence)
      .where(inArray(personalMemoryEvidence.insightId, insightIds));
    const [existing] = await tx
      .select()
      .from(personalMemorySuppressions)
      .where(
        and(
          eq(personalMemorySuppressions.userId, userId),
          eq(personalMemorySuppressions.lineageKey, lineageKey)
        )
      )
      .limit(1);
    const mergedIds = Array.from(
      new Set([
        ...((existing?.suppressedEventIds as number[] | undefined) ?? []),
        ...suppressedEventIds,
      ])
    );
    if (existing) {
      await tx
        .update(personalMemorySuppressions)
        .set({ suppressedEventIds: mergedIds })
        .where(eq(personalMemorySuppressions.id, existing.id));
    } else {
      await tx.insert(personalMemorySuppressions).values({
        userId,
        lineageKey,
        suppressedEventIds: mergedIds,
      });
    }
    await bumpPrivacyEpochInTx(tx, userId);
    await recordInsightLifecycleEventInTx(
      { mode: "mysql", tx },
      {
        userId,
        lineageKey,
        revision: decision.target.revision,
        actionKind: "insight_forgotten",
      }
    );
    return { outcome: "applied", insightId: decision.target.id };
  });
}

function localLineageView(
  userId: number,
  lineageKey: string
): PersonalMemoryInsightLineageView {
  return {
    revisions: memoryState.personalMemory.insights.filter(
      row => row.userId === userId && row.lineageKey === lineageKey
    ),
  };
}

async function mysqlLineageView(
  tx: PersonalMemoryMysqlTx,
  userId: number,
  lineageKey: string
): Promise<PersonalMemoryInsightLineageView> {
  const rows = await tx
    .select()
    .from(personalMemoryInsights)
    .where(
      and(
        eq(personalMemoryInsights.userId, userId),
        eq(personalMemoryInsights.lineageKey, lineageKey)
      )
    )
    .for("update");
  return { revisions: rows.map(rowToPersonalMemoryInsight) };
}

function bumpPrivacyEpochLocally(userId: number): number {
  const rows = memoryState.personalMemory.privacyEpochs;
  const existing = rows.find(row => row.userId === userId);
  const next = (existing?.epoch ?? 1) + 1;
  const stamp = new Date().toISOString();
  if (existing) {
    existing.epoch = next;
    existing.updatedAt = stamp;
  } else {
    rows.push({ userId, epoch: next, updatedAt: stamp });
  }
  return next;
}

/** 与 bumpPersonalMemoryPrivacyEpoch 语义相同，但在调用方已有的事务里执行。 */
async function bumpPrivacyEpochInTx(
  tx: PersonalMemoryMysqlTx,
  userId: number
): Promise<void> {
  await tx
    .insert(personalMemoryPrivacyEpochs)
    .values({ userId, epoch: 2 })
    .onDuplicateKeyUpdate({
      set: { epoch: sql`${personalMemoryPrivacyEpochs.epoch} + 1` },
    });
}

// ─── 来源清空（删除传播）后重新计算依据 ─────────────────────────────────

export type ScrubEventResult = {
  /** false = 事件已经是 scrubbed（重放安全，幂等），本次没有新动作。 */
  changed: boolean;
  /** 因这次清空而退出召回（active → unsupported）的理解数。 */
  unsupportedInsightIds: number[];
};

/**
 * 明确删除来源时调用：清空事件正文，重新计算把它当证据的活跃理解是否还有
 * 依据，最后一个有效来源没了的理解退出召回并清除正文。同一事务里递增隐私
 * epoch——在途的来信生成即使已经拿到模型结果也不能再用旧输入提交。
 *
 * 多来源理解删掉其中一个仍然有依据：这里只处理**这一个事件**波及到的理解，
 * 判定用 shared 的 decideEvidenceLossOutcome，不在这里重新发明规则。
 */
export async function scrubPersonalMemoryEventAndRecompute(
  userId: number,
  eventId: number
): Promise<ScrubEventResult> {
  const db = await getDb();
  if (!db) {
    return withLocalAggregateMutationLock(async () => {
      const before = structuredClone(memoryState.personalMemory);
      try {
        const state = memoryState.personalMemory;
        const event = state.events.find(
          item => item.id === eventId && item.userId === userId
        );
        if (!event) return { changed: false, unsupportedInsightIds: [] };
        if (event.contentScrubbed) {
          return { changed: false, unsupportedInsightIds: [] };
        }
        event.contentScrubbed = true;
        event.snapshot = createEmptyPersonalMemoryEventSnapshot();

        const affectedInsightIds = new Set(
          state.evidence
            .filter(row => row.eventId === eventId && row.userId === userId)
            .map(row => row.insightId)
        );
        const unsupported: number[] = [];
        for (const insightId of affectedInsightIds) {
          const insight = state.insights.find(row => row.id === insightId);
          if (!insight) continue;
          const remaining = state.evidence.filter(row => {
            if (row.insightId !== insightId) return false;
            const evidenceEvent = state.events.find(e => e.id === row.eventId);
            return Boolean(evidenceEvent) && !evidenceEvent!.contentScrubbed;
          }).length;
          const outcome = decideEvidenceLossOutcome(insight, remaining);
          if (outcome === "unsupported") {
            insight.state = "unsupported";
            insight.text = null;
            insight.updatedAt = new Date().toISOString();
            unsupported.push(insight.id);
          }
        }
        bumpPrivacyEpochLocally(userId);
        await persistMemoryState();
        return { changed: true, unsupportedInsightIds: unsupported };
      } catch (error) {
        memoryState.personalMemory = before;
        throw error;
      }
    });
  }

  return db.transaction(async tx => {
    const [eventRow] = await tx
      .select()
      .from(personalMemoryEvents)
      .where(
        and(
          eq(personalMemoryEvents.id, eventId),
          eq(personalMemoryEvents.userId, userId)
        )
      )
      .limit(1)
      .for("update");
    if (!eventRow) return { changed: false, unsupportedInsightIds: [] };
    if (eventRow.contentScrubbed) {
      return { changed: false, unsupportedInsightIds: [] };
    }
    await tx
      .update(personalMemoryEvents)
      .set({ contentScrubbed: true, excerpt: null, contentHash: null, display: null })
      .where(eq(personalMemoryEvents.id, eventId));

    const affectedRows = await tx
      .select({ insightId: personalMemoryEvidence.insightId })
      .from(personalMemoryEvidence)
      .where(
        and(
          eq(personalMemoryEvidence.eventId, eventId),
          eq(personalMemoryEvidence.userId, userId)
        )
      );
    const affectedInsightIds = Array.from(
      new Set(affectedRows.map(row => row.insightId))
    );
    const unsupported: number[] = [];
    for (const insightId of affectedInsightIds) {
      const [insightRow] = await tx
        .select()
        .from(personalMemoryInsights)
        .where(eq(personalMemoryInsights.id, insightId))
        .limit(1)
        .for("update");
      if (!insightRow) continue;
      const insight = rowToPersonalMemoryInsight(insightRow);
      const evidenceRows = await tx
        .select({ eventId: personalMemoryEvidence.eventId })
        .from(personalMemoryEvidence)
        .where(eq(personalMemoryEvidence.insightId, insightId));
      let remaining = 0;
      for (const row of evidenceRows) {
        const [ev] = await tx
          .select({ contentScrubbed: personalMemoryEvents.contentScrubbed })
          .from(personalMemoryEvents)
          .where(eq(personalMemoryEvents.id, row.eventId))
          .limit(1);
        if (ev && !ev.contentScrubbed) remaining += 1;
      }
      const outcome = decideEvidenceLossOutcome(insight, remaining);
      if (outcome === "unsupported") {
        await tx
          .update(personalMemoryInsights)
          .set({ state: "unsupported", text: null })
          .where(eq(personalMemoryInsights.id, insightId));
        unsupported.push(insightId);
      }
    }
    await bumpPrivacyEpochInTx(tx, userId);
    return { changed: true, unsupportedInsightIds: unsupported };
  });
}

// ─── 手动纠正 ───────────────────────────────────────────────────────────

/**
 * 用户在足迹里直接纠正一条理解（U7 的 UI 动作，这里先建好底层机制）。
 * 可信级别永远是 user_corrected——这不是可配置项。
 *
 * 纠正没有天然的「触发事件」，所以先在同一事务里补一条 sourceType=insight
 * 的经历（actionKind: insight_corrected），把它当作这次纠正唯一的证据。
 * 目标 lineage 必须当前是 active（与提炼的 supersede 同一条门槛）；
 * lineage 不存在时视为对一个新理解的直接陈述，走 create。
 */
function buildCorrectionMutation(
  input: {
    lineageKey: string | null;
    category: PersonalMemoryInsightRecord["category"];
    text: string;
    scope: Record<string, unknown> | null;
    allowProactiveMention: boolean;
  },
  tipRevision: number | undefined
): PersonalMemoryInsightMutation {
  return input.lineageKey
    ? {
        action: "supersede",
        lineageKey: input.lineageKey,
        // 纠正是一次读了当前内容之后做出的动作：expectedRevision 就是刚读到
        // 的这个 tip 版本号。真正防「陈旧覆盖」的检查发生在 decideInsightMutation
        // 里；这里给不出版本号（tip 不存在）时传 -1，保证必然判 stale 而不是
        // 侥幸通过。
        expectedRevision: tipRevision ?? -1,
        origin: "user_corrected",
        category: input.category,
        text: input.text,
        scope: input.scope,
        confidence: 1,
        allowProactiveMention: input.allowProactiveMention,
      }
    : {
        action: "new",
        origin: "user_corrected",
        category: input.category,
        text: input.text,
        scope: input.scope,
        confidence: 1,
        allowProactiveMention: input.allowProactiveMention,
      };
}

export async function correctPersonalMemoryInsight(input: {
  userId: number;
  lineageKey: string | null;
  category: PersonalMemoryInsightRecord["category"];
  text: string;
  scope: Record<string, unknown> | null;
  allowProactiveMention: boolean;
}): Promise<LineageStateChangeResult> {
  const lineageKey = input.lineageKey ?? randomUUID();

  const db = await getDb();
  if (!db) {
    return withLocalAggregateMutationLock(async () => {
      const before = structuredClone(memoryState.personalMemory);
      try {
        const state = memoryState.personalMemory;
        const view = localLineageView(input.userId, lineageKey);
        const mutation = buildCorrectionMutation(
          input,
          insightLineageTip(view)?.revision
        );
        const decision = decideInsightMutation(mutation, lineageKey, view);
        if (decision.kind === "stale") {
          return { outcome: "invalid", reason: decision.reason } as const;
        }
        const eventNow = new Date();
        const eventCapture = correctionEventCapture(
          input.userId,
          lineageKey,
          view,
          eventNow
        );
        const captured = applyPersonalMemoryCapture(state, eventCapture);
        const result = applyInsightMutationLocally(
          state,
          input.userId,
          captured.event,
          mutation
        );
        if (result.insightId === null) {
          return { outcome: "invalid", reason: result.outcome } as const;
        }
        await persistMemoryState();
        return { outcome: "applied", insightId: result.insightId } as const;
      } catch (error) {
        memoryState.personalMemory = before;
        throw error;
      }
    });
  }

  return db.transaction(async tx => {
    const view = await mysqlLineageView(tx, input.userId, lineageKey);
    const mutation = buildCorrectionMutation(
      input,
      insightLineageTip(view)?.revision
    );
    const decision = decideInsightMutation(mutation, lineageKey, view);
    if (decision.kind === "stale") {
      return { outcome: "invalid", reason: decision.reason };
    }
    const eventNow = new Date();
    const eventCapture = correctionEventCapture(
      input.userId,
      lineageKey,
      view,
      eventNow
    );
    await capturePersonalMemoryEvent({ mode: "mysql", tx }, eventCapture);
    const event = await findPersonalMemoryEventInTx(
      tx,
      eventCapture.identity
    );
    if (!event) throw new Error("纠正经历写入后读不回");
    const result = await applyInsightMutationMysql(
      tx,
      input.userId,
      event,
      mutation
    );
    if (result.insightId === null) {
      return { outcome: "invalid", reason: result.outcome };
    }
    const tipView = await mysqlLineageView(tx, input.userId, lineageKey);
    const tip = insightLineageTip(tipView);
    return { outcome: "applied", insightId: tip!.id };
  });
}

function correctionEventCapture(
  userId: number,
  lineageKey: string,
  view: PersonalMemoryInsightLineageView,
  now: Date
): PersonalMemoryCapture {
  const nextRevision = (insightLineageTip(view)?.revision ?? 0) + 1;
  return {
    identity: {
      userId,
      sourceType: "insight",
      sourceKey: `insight:${lineageKey}`,
      sourceRevision: String(nextRevision),
      actionKind: "insight_corrected",
      actionId: randomUUID(),
    },
    occurredOn: chinaDateStringLocal(now),
    occurredAt: now.toISOString(),
    snapshot: createEmptyPersonalMemoryEventSnapshot(),
    storyId: null,
    job: null,
  };
}

/** 读一个 lineage 的忘记 tombstone（若存在）。供测试与展示用。 */
export async function getPersonalMemorySuppression(
  userId: number,
  lineageKey: string
): Promise<PersonalMemorySuppressionRecord | null> {
  const db = await getDb();
  if (!db) {
    return (
      memoryState.personalMemory.suppressions.find(
        row => row.userId === userId && row.lineageKey === lineageKey
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(personalMemorySuppressions)
    .where(
      and(
        eq(personalMemorySuppressions.userId, userId),
        eq(personalMemorySuppressions.lineageKey, lineageKey)
      )
    )
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    lineageKey: row.lineageKey,
    suppressedEventIds: row.suppressedEventIds as number[],
    createdAt: row.createdAt.toISOString(),
  };
}

// ─── 提炼的完整正文回源（U5）───────────────────────────────────────────

/**
 * 按 messageId + userId 直接读一条聊天消息的完整正文，用于提炼。
 *
 * 聊天消息事件的快照只存 200 字展示摘录（见 personalMemoryEvents.ts 的
 * chatSnapshotFor）——那是有意的：这条来源有稳定不变的权威修订，截断摘录
 * 不丢东西，完整正文永远从这里回源解析。`story_conversation_messages` 行上
 * 直接带 userId，不需要经过 storyId 才能验证归属。
 *
 * 消息已被删除或不属于这个用户时返回 null——调用方（提炼）据此把它当作
 * 内容已清空处理，不編造正文。
 */
export async function getChatMessageContentForPersonalMemory(
  messageId: number,
  userId: number
): Promise<string | null> {
  const db = await getDb();
  if (!db) {
    await ensureLocalPromptLineageLoaded();
    const message = memoryState.promptLineage.messages.find(
      row => row.id === messageId && row.userId === userId
    );
    return message?.content ?? null;
  }
  const [row] = await db
    .select({ content: storyConversationMessages.content })
    .from(storyConversationMessages)
    .where(
      and(
        eq(storyConversationMessages.id, messageId),
        eq(storyConversationMessages.userId, userId)
      )
    )
    .limit(1);
  return row?.content ?? null;
}

/** 按事件 ID 读一条经历，供提炼取 sourceType／snapshot 用。 */
export async function getPersonalMemoryEventById(
  eventId: number,
  userId: number
): Promise<PersonalMemoryEventRecord | null> {
  const db = await getDb();
  if (!db) {
    return (
      memoryState.personalMemory.events.find(
        event => event.id === eventId && event.userId === userId
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(personalMemoryEvents)
    .where(
      and(
        eq(personalMemoryEvents.id, eventId),
        eq(personalMemoryEvents.userId, userId)
      )
    )
    .limit(1);
  return row ? rowToPersonalMemoryEvent(row) : null;
}
