import {
  isPublishingPlatformId,
  type PublishingPlatformId,
} from "@shared/publishingDraft";

export type MobilePublishingBodyDocument = {
  storyId: number;
  storyRevision: number;
  versionId: string;
  platform: PublishingPlatformId;
  body: string;
  bodyRevision: number;
  draftRevision: number;
  versionRevision: number;
  containerRevision: number;
  publishingRevision: number;
  updatedAt: number;
};

export type MobileDocumentStatus =
  | "loading"
  | "clean"
  | "dirty"
  | "saving"
  | "saved"
  | "failed"
  | "uncertain"
  | "conflict";

export type MobileDocumentConflictReason =
  | "body_changed"
  | "scope_changed"
  | "target_missing"
  | "retry_exhausted";

export type MobileDocumentRecoveryRecord = {
  userId: number;
  storyId: number;
  scopeKey: string;
  versionId: string;
  platform: PublishingPlatformId;
  baseBodyRevision: number;
  baseStoryRevision: number;
  body: string;
  updatedAt: number;
  expiresAt: number;
};

export type MobileDocumentConflict = {
  reason: MobileDocumentConflictReason;
  localBody: string;
  latestDocument: MobilePublishingBodyDocument | null;
};

export type MobileDocumentState = {
  userId: number;
  storyId: number;
  status: MobileDocumentStatus;
  document: MobilePublishingBodyDocument | null;
  body: string;
  recovery: MobileDocumentRecoveryRecord | null;
  conflict: MobileDocumentConflict | null;
  error: string | null;
};

export type MobileDocumentStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

const RECOVERY_PREFIX = "dt:mobile:document:v1:";
export const MOBILE_DOCUMENT_RECOVERY_TTL_MS = 7 * 24 * 60 * 60_000;
export const MOBILE_DOCUMENT_RECOVERY_MAX_RECORDS = 8;
export const MOBILE_DOCUMENT_RECOVERY_MAX_BYTES = 256_000;

export function mobileDocumentRecoveryKey(
  userId: number,
  storyId: number
): string {
  return `${RECOVERY_PREFIX}${userId}:${storyId}`;
}

export function mobileDocumentScopeKey(input: {
  userId: number;
  storyId: number;
  versionId: string;
  platform: PublishingPlatformId;
  bodyRevision: number;
}): string {
  return [
    input.userId,
    input.storyId,
    input.versionId,
    input.platform,
    input.bodyRevision,
  ].join(":");
}

function documentScopeKey(
  userId: number,
  document: MobilePublishingBodyDocument
): string {
  return mobileDocumentScopeKey({
    userId,
    storyId: document.storyId,
    versionId: document.versionId,
    platform: document.platform,
    bodyRevision: document.bodyRevision,
  });
}

function recoveryFromDocument(input: {
  userId: number;
  document: MobilePublishingBodyDocument;
  body: string;
  now: number;
}): MobileDocumentRecoveryRecord {
  return {
    userId: input.userId,
    storyId: input.document.storyId,
    scopeKey: documentScopeKey(input.userId, input.document),
    versionId: input.document.versionId,
    platform: input.document.platform,
    baseBodyRevision: input.document.bodyRevision,
    baseStoryRevision: input.document.storyRevision,
    body: input.body,
    updatedAt: input.now,
    expiresAt: input.now + MOBILE_DOCUMENT_RECOVERY_TTL_MS,
  };
}

function conflictReasonForScope(
  recovery: MobileDocumentRecoveryRecord,
  document: MobilePublishingBodyDocument
): MobileDocumentConflictReason {
  return recovery.versionId !== document.versionId ||
    recovery.platform !== document.platform
    ? "scope_changed"
    : "body_changed";
}

function conflictState(input: {
  state: MobileDocumentState;
  reason: MobileDocumentConflictReason;
  latestDocument: MobilePublishingBodyDocument | null;
}): MobileDocumentState {
  return {
    ...input.state,
    status: "conflict",
    document: input.latestDocument,
    conflict: {
      reason: input.reason,
      localBody: input.state.body,
      latestDocument: input.latestDocument,
    },
    error: "正文已在其他设备或发布范围中变化",
  };
}

export function hydrateMobileDocumentState(input: {
  userId: number;
  storyId: number;
  document: MobilePublishingBodyDocument;
  recoveryRecords: readonly MobileDocumentRecoveryRecord[];
}): MobileDocumentState {
  const recovery = [...input.recoveryRecords]
    .filter(
      record =>
        record.userId === input.userId && record.storyId === input.storyId
    )
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];
  const clean: MobileDocumentState = {
    userId: input.userId,
    storyId: input.storyId,
    status: "clean",
    document: input.document,
    body: input.document.body,
    recovery: null,
    conflict: null,
    error: null,
  };
  if (!recovery || recovery.body === input.document.body) return clean;
  if (recovery.scopeKey === documentScopeKey(input.userId, input.document)) {
    return {
      ...clean,
      status: "dirty",
      body: recovery.body,
      recovery,
    };
  }
  return conflictState({
    state: { ...clean, body: recovery.body, recovery },
    reason: conflictReasonForScope(recovery, input.document),
    latestDocument: input.document,
  });
}

export function editMobileDocumentBody(
  state: MobileDocumentState,
  body: string,
  now = Date.now()
): MobileDocumentState {
  if (!state.document) return state;
  if (body === state.document.body) {
    return {
      ...state,
      status: "clean",
      body,
      recovery: null,
      conflict: null,
      error: null,
    };
  }
  return {
    ...state,
    status: "dirty",
    body,
    recovery: recoveryFromDocument({
      userId: state.userId,
      document: state.document,
      body,
      now,
    }),
    conflict: null,
    error: null,
  };
}

export function beginMobileDocumentSave(
  state: MobileDocumentState
): MobileDocumentState {
  if (!state.document || !state.recovery) return state;
  if (state.status !== "dirty" && state.status !== "failed") return state;
  return { ...state, status: "saving", conflict: null, error: null };
}

export function applyMobileDocumentSaveSuccess(
  state: MobileDocumentState,
  input: {
    expectedScopeKey: string;
    expectedBody: string;
    document: MobilePublishingBodyDocument;
  }
): MobileDocumentState {
  if (
    !state.recovery ||
    state.recovery.scopeKey !== input.expectedScopeKey ||
    state.body !== input.expectedBody ||
    state.recovery.versionId !== input.document.versionId ||
    state.recovery.platform !== input.document.platform ||
    input.document.body !== input.expectedBody
  ) {
    return state;
  }
  return {
    ...state,
    status: "saved",
    document: input.document,
    body: input.document.body,
    recovery: null,
    conflict: null,
    error: null,
  };
}

export function applyMobileDocumentSaveConflict(
  state: MobileDocumentState,
  input: {
    reason: MobileDocumentConflictReason;
    latestDocument: MobilePublishingBodyDocument | null;
  }
): MobileDocumentState {
  return conflictState({
    state,
    reason: input.reason,
    latestDocument: input.latestDocument,
  });
}

export function applyMobileDocumentSaveFailure(
  state: MobileDocumentState,
  input: { error: string; uncertain: boolean }
): MobileDocumentState {
  if (!state.recovery) return state;
  return {
    ...state,
    status: input.uncertain ? "uncertain" : "failed",
    error: input.error,
  };
}

export function applyMobileDocumentAuthority(
  state: MobileDocumentState,
  document: MobilePublishingBodyDocument
): MobileDocumentState {
  if (document.storyId !== state.storyId) return state;
  if (!state.recovery) {
    return {
      ...state,
      status: state.status === "loading" ? "clean" : state.status,
      document,
      body: document.body,
      conflict: null,
      error: null,
    };
  }
  if (state.body === document.body) {
    return {
      ...state,
      status: "saved",
      document,
      body: document.body,
      recovery: null,
      conflict: null,
      error: null,
    };
  }
  if (
    state.recovery.versionId !== document.versionId ||
    state.recovery.platform !== document.platform ||
    state.recovery.baseBodyRevision !== document.bodyRevision
  ) {
    return conflictState({
      state,
      reason: conflictReasonForScope(state.recovery, document),
      latestDocument: document,
    });
  }
  if (state.status === "uncertain") {
    return {
      ...state,
      status: "failed",
      document,
      error: "未在服务端看到本次保存，正文仍保留在本机",
    };
  }
  if (state.status === "conflict") {
    return conflictState({
      state,
      reason: state.conflict?.reason ?? "body_changed",
      latestDocument: document,
    });
  }
  return { ...state, document };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function normalizeRecoveryRecord(
  value: unknown,
  userId: number,
  storyId: number,
  now: number
): MobileDocumentRecoveryRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<MobileDocumentRecoveryRecord>;
  if (
    record.userId !== userId ||
    record.storyId !== storyId ||
    !isPositiveInteger(record.userId) ||
    !isPositiveInteger(record.storyId) ||
    typeof record.scopeKey !== "string" ||
    typeof record.versionId !== "string" ||
    !record.versionId.trim() ||
    !isPublishingPlatformId(record.platform) ||
    !isPositiveInteger(record.baseBodyRevision) ||
    !isNonNegativeInteger(record.baseStoryRevision) ||
    typeof record.body !== "string" ||
    record.body.length > 20_000 ||
    typeof record.updatedAt !== "number" ||
    !Number.isFinite(record.updatedAt) ||
    typeof record.expiresAt !== "number" ||
    !Number.isFinite(record.expiresAt) ||
    record.expiresAt <= now
  ) {
    return null;
  }
  if (
    record.scopeKey !==
    mobileDocumentScopeKey({
      userId,
      storyId,
      versionId: record.versionId,
      platform: record.platform,
      bodyRevision: record.baseBodyRevision,
    })
  ) {
    return null;
  }
  return record as MobileDocumentRecoveryRecord;
}

export function loadMobileDocumentRecovery(
  storage: Pick<MobileDocumentStorage, "getItem">,
  userId: number,
  storyId: number,
  options: { now?: number } = {}
): MobileDocumentRecoveryRecord[] {
  const now = options.now ?? Date.now();
  try {
    const raw = storage.getItem(mobileDocumentRecoveryKey(userId, storyId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .flatMap(value => {
        const record = normalizeRecoveryRecord(value, userId, storyId, now);
        return record ? [record] : [];
      })
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MOBILE_DOCUMENT_RECOVERY_MAX_RECORDS);
  } catch {
    return [];
  }
}

export function saveMobileDocumentRecovery(
  storage: Pick<MobileDocumentStorage, "setItem" | "removeItem">,
  userId: number,
  storyId: number,
  records: readonly MobileDocumentRecoveryRecord[],
  options: { now?: number } = {}
): void {
  const now = options.now ?? Date.now();
  const byScope = new Map<string, MobileDocumentRecoveryRecord>();
  records.forEach(value => {
    const record = normalizeRecoveryRecord(value, userId, storyId, now);
    if (!record) return;
    const existing = byScope.get(record.scopeKey);
    if (!existing || existing.updatedAt < record.updatedAt) {
      byScope.set(record.scopeKey, record);
    }
  });
  const retained = Array.from(byScope.values())
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MOBILE_DOCUMENT_RECOVERY_MAX_RECORDS);
  let serialized = JSON.stringify(retained);
  while (
    retained.length > 0 &&
    serialized.length * 2 > MOBILE_DOCUMENT_RECOVERY_MAX_BYTES
  ) {
    retained.pop();
    serialized = JSON.stringify(retained);
  }
  const key = mobileDocumentRecoveryKey(userId, storyId);
  if (retained.length === 0) {
    storage.removeItem(key);
    return;
  }
  storage.setItem(key, serialized);
}
