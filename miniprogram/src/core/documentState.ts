import { RECOVERY_TTL_MS } from "./recoveryState";
import {
  isPublishingPlatformId,
  type PublishingBodyDocument,
  type PublishingPlatformId,
  type RecoveryScope,
} from "./types";

/**
 * 「正文」的状态机（当前版本／当前平台，body-only）。
 *
 * 与 `client/src/features/mobileWorkspace/mobileDocumentStore.ts` 是同一份合同：
 * 保存必须带服务端给的 versionId / platform / bodyRevision 做 CAS；
 * 冲突时**保留本地和服务端两份文本**，绝不自动覆盖，也绝不自动合并。
 */

export type DocumentStatus =
  | "loading"
  | "clean"
  | "dirty"
  | "saving"
  | "saved"
  | "failed"
  | "uncertain"
  | "conflict";

export type DocumentConflictReason =
  | "body_changed"
  | "scope_changed"
  | "target_missing"
  | "retry_exhausted";

export type DocumentRecoveryRecord = {
  scope: RecoveryScope;
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

export type DocumentConflict = {
  reason: DocumentConflictReason;
  /** 本机这份：永远不会被服务端那份悄悄顶掉。 */
  localBody: string;
  /** 服务端那份：可能为 null（目标已不存在）。 */
  latestDocument: PublishingBodyDocument | null;
};

export type DocumentState = {
  scope: RecoveryScope;
  storyId: number;
  status: DocumentStatus;
  document: PublishingBodyDocument | null;
  body: string;
  recovery: DocumentRecoveryRecord | null;
  conflict: DocumentConflict | null;
  error: string | null;
};

export const MAX_DOCUMENT_BODY_LENGTH = 20_000;

export function documentScopeKey(input: {
  scope: RecoveryScope;
  storyId: number;
  versionId: string;
  platform: PublishingPlatformId;
  bodyRevision: number;
}): string {
  return [
    input.scope,
    input.storyId,
    input.versionId,
    input.platform,
    input.bodyRevision,
  ].join(":");
}

function scopeKeyOf(
  scope: RecoveryScope,
  document: PublishingBodyDocument,
): string {
  return documentScopeKey({
    scope,
    storyId: document.storyId,
    versionId: document.versionId,
    platform: document.platform,
    bodyRevision: document.bodyRevision,
  });
}

function recoveryFromDocument(input: {
  scope: RecoveryScope;
  document: PublishingBodyDocument;
  body: string;
  now: number;
}): DocumentRecoveryRecord {
  return {
    scope: input.scope,
    storyId: input.document.storyId,
    scopeKey: scopeKeyOf(input.scope, input.document),
    versionId: input.document.versionId,
    platform: input.document.platform,
    baseBodyRevision: input.document.bodyRevision,
    baseStoryRevision: input.document.storyRevision,
    body: input.body,
    updatedAt: input.now,
    expiresAt: input.now + RECOVERY_TTL_MS,
  };
}

function conflictReasonForScope(
  recovery: DocumentRecoveryRecord,
  document: PublishingBodyDocument,
): DocumentConflictReason {
  return recovery.versionId !== document.versionId ||
    recovery.platform !== document.platform
    ? "scope_changed"
    : "body_changed";
}

function conflictState(input: {
  state: DocumentState;
  reason: DocumentConflictReason;
  latestDocument: PublishingBodyDocument | null;
}): DocumentState {
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

export function createLoadingDocumentState(
  scope: RecoveryScope,
  storyId: number,
): DocumentState {
  return {
    scope,
    storyId,
    status: "loading",
    document: null,
    body: "",
    recovery: null,
    conflict: null,
    error: null,
  };
}

export function hydrateDocumentState(input: {
  scope: RecoveryScope;
  storyId: number;
  document: PublishingBodyDocument;
  recoveryRecords: readonly DocumentRecoveryRecord[];
}): DocumentState {
  const recovery = input.recoveryRecords
    .filter(
      record => record.scope === input.scope && record.storyId === input.storyId,
    )
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];
  const clean: DocumentState = {
    scope: input.scope,
    storyId: input.storyId,
    status: "clean",
    document: input.document,
    body: input.document.body,
    recovery: null,
    conflict: null,
    error: null,
  };
  if (!recovery || recovery.body === input.document.body) return clean;
  if (recovery.scopeKey === scopeKeyOf(input.scope, input.document)) {
    return { ...clean, status: "dirty", body: recovery.body, recovery };
  }
  return conflictState({
    state: { ...clean, body: recovery.body, recovery },
    reason: conflictReasonForScope(recovery, input.document),
    latestDocument: input.document,
  });
}

export function editDocumentBody(
  state: DocumentState,
  body: string,
  now = Date.now(),
): DocumentState {
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
      scope: state.scope,
      document: state.document,
      body,
      now,
    }),
    conflict: null,
    error: null,
  };
}

export function beginDocumentSave(state: DocumentState): DocumentState {
  if (!state.document || !state.recovery) return state;
  if (state.status !== "dirty" && state.status !== "failed") return state;
  return { ...state, status: "saving", conflict: null, error: null };
}

export function applyDocumentSaveSuccess(
  state: DocumentState,
  input: {
    expectedScopeKey: string;
    expectedBody: string;
    document: PublishingBodyDocument;
  },
): DocumentState {
  // 迟到的成功响应不能顶掉用户后来的编辑：范围或文本对不上就原样返回。
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

export function applyDocumentSaveConflict(
  state: DocumentState,
  input: {
    reason: DocumentConflictReason;
    latestDocument: PublishingBodyDocument | null;
  },
): DocumentState {
  return conflictState({
    state,
    reason: input.reason,
    latestDocument: input.latestDocument,
  });
}

export function applyDocumentSaveFailure(
  state: DocumentState,
  input: { error: string; uncertain: boolean },
): DocumentState {
  if (!state.recovery) return state;
  return {
    ...state,
    status: input.uncertain ? "uncertain" : "failed",
    error: input.error,
  };
}

/**
 * 收到服务端权威正文（onShow 刷新、冲突后重新拉取）。
 * 铁律：**不覆盖 dirty 正文**。
 */
export function applyDocumentAuthority(
  state: DocumentState,
  document: PublishingBodyDocument,
): DocumentState {
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

/** 用户明确放弃本地草稿（冲突或切 Story 时的破坏性出路，不能是默认动作）。 */
export function discardLocalDraft(state: DocumentState): DocumentState {
  if (!state.document) return state;
  return {
    ...state,
    status: "clean",
    body: state.document.body,
    recovery: null,
    conflict: null,
    error: null,
  };
}

/** 冲突时给用户的两份文本：本机的和服务端的，一份都不丢。 */
export function documentConflictCopies(state: DocumentState): {
  localBody: string;
  serverBody: string | null;
} {
  return {
    localBody: state.conflict?.localBody ?? state.body,
    serverBody: state.conflict?.latestDocument?.body ?? null,
  };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function normalizeDocumentRecoveryRecord(
  value: unknown,
  scope: RecoveryScope,
  storyId: number,
): DocumentRecoveryRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<DocumentRecoveryRecord>;
  if (
    record.scope !== scope ||
    record.storyId !== storyId ||
    !isPositiveInteger(record.storyId) ||
    typeof record.scopeKey !== "string" ||
    typeof record.versionId !== "string" ||
    !record.versionId.trim() ||
    !isPublishingPlatformId(record.platform) ||
    !isPositiveInteger(record.baseBodyRevision) ||
    !isNonNegativeInteger(record.baseStoryRevision) ||
    typeof record.body !== "string" ||
    record.body.length > MAX_DOCUMENT_BODY_LENGTH ||
    typeof record.updatedAt !== "number" ||
    !Number.isFinite(record.updatedAt) ||
    typeof record.expiresAt !== "number" ||
    !Number.isFinite(record.expiresAt)
  ) {
    return null;
  }
  if (
    record.scopeKey !==
    documentScopeKey({
      scope,
      storyId,
      versionId: record.versionId,
      platform: record.platform,
      bodyRevision: record.baseBodyRevision,
    })
  ) {
    return null;
  }
  return record as DocumentRecoveryRecord;
}
