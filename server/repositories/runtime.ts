/** Shared storage runtime: one connection, one local state, one set of write queues. */
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
import { createKeyedSerialLock } from "../utils/keyedSerialLock";
import {
  User,
  AccessSession,
  Project,
  Reference,
  Shot,
  AnalysisResult,
  EmotionAnalysisProfile,
  EmotionDailyLetter,
  Story,
  StorySoundWorkspaceRecord,
  StorySoundPlanVersionRecord,
  StorySoundRowOperationRecord,
  StoryVoiceProfileRecord,
  StoryVoiceActivationOperationRecord,
  EditSnapshot,
  SemanticAnnotation,
  GeneratedImage,
  PreviewMaskedImageOperation,
  TimelineFrameExtractionOperation,
  StoryAudioAsset,
  StoryAudioImportOperation,
  ImageSignal,
  VideoTake,
  VideoTakeRange,
  VideoTimelineSelection,
  StoryTimeline,
  ShotDerivationDraft,
  StoryOperation,
  EmailOtp,
  InviteCode,
  CreditAccount,
  CreditLedgerEntry,
  CreditHold,
  BillingOperation,
  ProviderAttempt,
  AccountIdentity,
  AccountCredential,
  DevicePairingCode,
  AccountVerificationChallenge,
  AccountRateLimit,
} from "../../drizzle/schema";
import {
  createEmptyPromptLineageLocalState,
  normalizePromptLineageLocalState,
  type PromptLineageLocalState,
  type PromptCompilationHead,
} from "../../shared/promptLineage";
import {
  createEmptyPersonalMemoryLocalState,
  normalizePersonalMemoryLocalState,
  type PersonalMemoryLocalState,
} from "../../shared/personalMemory";
export const transientState = {
  memoryVideoTakeSubmissionClaimQueue: Promise.resolve() as Promise<void>,
  memoryInviteClaimQueue: Promise.resolve() as Promise<void>,
  memoryEmailOtps: [] as EmailOtp[],
  nextMemoryEmailOtpId: 1,
};

let _db: ReturnType<typeof drizzle> | null = null;

let mysqlModeLogged = false;

let localPersistModeLogged = false;

export const LEGACY_GUEST_OPEN_ID = "local-guest";

export type MemoryState = {
  users: User[];
  accessSessions: AccessSession[];
  projects: Project[];
  references: Reference[];
  shots: Shot[];
  analysisResults: AnalysisResult[];
  emotionAnalysisProfiles: EmotionAnalysisProfile[];
  emotionDailyLetters: EmotionDailyLetter[];
  stories: Story[];
  storySoundWorkspaces: StorySoundWorkspaceRecord[];
  storySoundPlanVersions: StorySoundPlanVersionRecord[];
  storySoundRowOperations: StorySoundRowOperationRecord[];
  storyVoiceProfiles: StoryVoiceProfileRecord[];
  storyVoiceActivationOperations: StoryVoiceActivationOperationRecord[];
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
  devicePairingCodes: DevicePairingCode[];
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
    storySoundWorkspace: number;
    storySoundPlanVersion: number;
    storySoundRowOperation: number;
    storyVoiceProfile: number;
    storyVoiceActivationOperation: number;
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
    devicePairingCode: number;
    accountRateLimit: number;
  };
};

export const memoryState: MemoryState = {
  users: [],
  accessSessions: [],
  projects: [],
  references: [],
  shots: [],
  analysisResults: [],
  emotionAnalysisProfiles: [],
  emotionDailyLetters: [],
  stories: [],
  storySoundWorkspaces: [],
  storySoundPlanVersions: [],
  storySoundRowOperations: [],
  storyVoiceProfiles: [],
  storyVoiceActivationOperations: [],
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
  devicePairingCodes: [],
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
    storySoundWorkspace: 1,
    storySoundPlanVersion: 1,
    storySoundRowOperation: 1,
    storyVoiceProfile: 1,
    storyVoiceActivationOperation: 1,
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
    devicePairingCode: 1,
    accountRateLimit: 1,
  },
};

export function nextMemoryId(type: keyof MemoryState["nextIds"]): number {
  const id = memoryState.nextIds[type];
  memoryState.nextIds[type] += 1;
  return id;
}

export function now(): Date {
  return new Date();
}

function localTempPath(targetPath: string): string {
  const suffix = `${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
  return `${targetPath}.${suffix}.tmp`;
}

export function applyDefinedValues(
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

const BACKUP_THROTTLE_MS = 60_000;
// 例行备份最密一分钟一次，避免高频写时刷屏
const BACKUP_KEEP = 50;
// 备份目录只留最近 50 份
const SHRINK_MIN_BYTES = 4096;
// 盘上原文件够大才判骤减，避免小→小误报
const SHRINK_RATIO = 0.4;
// 新内容 < 原文件 40% 视为骤减
let lastBackupAt = 0;

let testWriteBlockedWarned = false;

// vitest 会自动设 VITEST=true；NODE_ENV=test 兜底。运行时读，避免模块加载快照过期。
const isTestEnv = () =>
  Boolean(process.env.VITEST) || process.env.NODE_ENV === "test";

let memoryLoaded = false;

let memoryLoadPromise: Promise<void> | null = null;

let promptLineageLoaded = false;

let promptLineageLoadFallback:
  | Partial<PromptLineageLocalState>
  | null
  | undefined;

let editSnapshotsLoaded = false;

let editSnapshotsLoadFallback: Partial<EditSnapshot>[] | undefined;

export function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return now();
}

export function nextIdFromRows(rows: Array<{ id: number }>): number {
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
  memoryState.storySoundWorkspaces = (raw.storySoundWorkspaces ?? []).map(
    item => ({
      ...item,
      createdAt: toDate(item.createdAt),
      updatedAt: toDate(item.updatedAt),
    })
  ) as StorySoundWorkspaceRecord[];
  memoryState.storySoundPlanVersions = (raw.storySoundPlanVersions ?? []).map(
    item => ({ ...item, createdAt: toDate(item.createdAt) })
  ) as StorySoundPlanVersionRecord[];
  memoryState.storySoundRowOperations = (raw.storySoundRowOperations ?? []).map(
    item => ({
      ...item,
      tombstonedAt: item.tombstonedAt ? toDate(item.tombstonedAt) : null,
      createdAt: toDate(item.createdAt),
      updatedAt: toDate(item.updatedAt),
    })
  ) as StorySoundRowOperationRecord[];
  memoryState.storyVoiceProfiles = (raw.storyVoiceProfiles ?? []).map(item => ({
    ...item,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as StoryVoiceProfileRecord[];
  memoryState.storyVoiceActivationOperations = (
    raw.storyVoiceActivationOperations ?? []
  ).map(item => ({
    ...item,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as StoryVoiceActivationOperationRecord[];

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
  memoryState.devicePairingCodes = (raw.devicePairingCodes ?? []).map(item => ({
    ...item,
    expiresAt: toDate(item.expiresAt),
    consumedAt: item.consumedAt ? toDate(item.consumedAt) : null,
    invalidatedAt: item.invalidatedAt ? toDate(item.invalidatedAt) : null,
    createdAt: toDate(item.createdAt),
  })) as DevicePairingCode[];
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
    storySoundWorkspace: Math.max(
      raw.nextIds?.storySoundWorkspace ?? 0,
      nextIdFromRows(memoryState.storySoundWorkspaces)
    ),
    storySoundPlanVersion: Math.max(
      raw.nextIds?.storySoundPlanVersion ?? 0,
      nextIdFromRows(memoryState.storySoundPlanVersions)
    ),
    storySoundRowOperation: Math.max(
      raw.nextIds?.storySoundRowOperation ?? 0,
      nextIdFromRows(memoryState.storySoundRowOperations)
    ),
    storyVoiceProfile: Math.max(
      raw.nextIds?.storyVoiceProfile ?? 0,
      nextIdFromRows(memoryState.storyVoiceProfiles)
    ),
    storyVoiceActivationOperation: Math.max(
      raw.nextIds?.storyVoiceActivationOperation ?? 0,
      nextIdFromRows(memoryState.storyVoiceActivationOperations)
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
    devicePairingCode: Math.max(
      raw.nextIds?.devicePairingCode ?? 0,
      nextIdFromRows(memoryState.devicePairingCodes)
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

export async function persistLocalPromptLineageStateToDisk(
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

export async function ensureMemoryLoaded() {
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

export async function ensureLocalPromptLineageLoaded() {
  await ensureMemoryLoaded();
  if (promptLineageLoaded) return;
  memoryState.promptLineage = await loadLocalPromptLineageState(
    promptLineageLoadFallback
  );
  promptLineageLoadFallback = undefined;
  promptLineageLoaded = true;
}

export async function ensureLocalEditSnapshotsLoaded() {
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

export async function persistMemoryStateToDisk(
  state: MemoryState = memoryState
) {
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

export function enqueueLocalPersistenceWrite<T>(
  action: () => Promise<T>
): Promise<T> {
  const previous = localPersistenceWriteTail;
  const result = previous.catch(() => {}).then(action);
  localPersistenceWriteTail = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

export function frozenMemoryStateSnapshot(state: MemoryState): MemoryState {
  return structuredClone(state);
}

export const persistMemoryState = createWriteCoalescer(() => {
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

export async function withLocalBodyMutation<T>(
  action: () => Promise<T>
): Promise<T> {
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

export async function withLocalAggregateMutationLock<T>(
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

export async function withLocalStoryLock<T>(
  storyId: number,
  userId: number,
  action: () => Promise<T>
): Promise<T> {
  const key = `${userId}:${storyId}`;
  return localStoryLock.run(key, action);
}

export async function withLocalTimelineLock<T>(
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
export const persistLocalEditSnapshots = createWriteCoalescer(() =>
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

export const defaultProjectLocks = new Map<number, Promise<Project>>();

export const previewMaskedImageMemoryLock = createKeyedSerialLock<string>();

export const timelineFrameExtractionMemoryLock =
  createKeyedSerialLock<string>();

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
  memoryState.storySoundWorkspaces = [];
  memoryState.storySoundPlanVersions = [];
  memoryState.storySoundRowOperations = [];
  memoryState.storyVoiceProfiles = [];
  memoryState.storyVoiceActivationOperations = [];
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
  memoryState.devicePairingCodes = [];
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
    storySoundWorkspace: 1,
    storySoundPlanVersion: 1,
    storySoundRowOperation: 1,
    storyVoiceProfile: 1,
    storyVoiceActivationOperation: 1,
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
    devicePairingCode: 1,
    accountRateLimit: 1,
  };
  defaultProjectLocks.clear();
  timelineFrameExtractionMemoryLock.clear();
  previewMaskedImageMemoryLock.clear();
  transientState.memoryVideoTakeSubmissionClaimQueue = Promise.resolve();
  transientState.memoryInviteClaimQueue = Promise.resolve();
  transientState.memoryEmailOtps = [];
  transientState.nextMemoryEmailOtpId = 1;
  // Mark as loaded so subsequent calls don't reload stale data from disk.
  memoryLoaded = true;
  memoryLoadPromise = null;
}
