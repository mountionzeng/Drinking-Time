import {
  canUseIdentityNetwork,
  createInitialAuthState,
  reduceAuthState,
  type AuthState,
} from "../core/authState";
import { isRecoveryScope, type RecoveryScope } from "../core/types";
import {
  readStorageItemObserved,
  removeStorageItemVerified,
  writeStorageItemVerified,
  type MiniProgramStorage,
} from "./storage";

/**
 * 小程序认证凭据的唯一持有者。
 *
 * - access token 只驻留在这个闭包的内存中；
 * - refresh token 只出现在 active / pending-revoke 两个私有存储槽；
 * - refresh 发出前先用无 token 的 rotation-unknown 标记覆盖 active 槽；
 * - 页面和 AuthState 永远只拿脱敏账号摘要，不拿任何凭据原文。
 */

export const AUTH_SESSION_STORAGE_KEYS = {
  active: "dt:mp:auth-session:v1:active",
  pendingRevoke: "dt:mp:auth-session:v1:pending-revoke",
} as const;

export type AuthAccountPresentation = {
  maskedEmail?: string;
  displayName?: string;
};

export type IssuedAuthSession = {
  accessToken: string;
  accessExpiresAt: number;
  refreshToken: string;
  refreshExpiresAt: number;
  deviceSessionId: string;
  familyId: string;
  generation: number;
  accountScope: RecoveryScope;
  account: AuthAccountPresentation;
};

/** 仅在 authSession 与 live transport 调用栈中流动，绝不进入页面状态。 */
export type AccessCredential = Readonly<{
  token: string;
  epoch: number;
  expiresAt: number;
}>;

export type RefreshRotationResult =
  | { ok: true; session: IssuedAuthSession }
  | { ok: false; kind: "rejected" | "unknown-result" };

export type RevokeDeviceResult =
  | { ok: true }
  | { ok: false; kind: "rejected" | "unknown-result" };

/**
 * 服务端只为“撤销未知轮换的旧设备”签发的一次性证明；它不是业务 access
 * 或 refresh，会在本次闭包内立即用于撤销，既不落盘也不交给页面。
 */
export type RevokeReauthAuthorization = {
  proof: string;
  expiresAt: number;
  accountScope: RecoveryScope;
};

export type RefreshRotationRequest = {
  refreshToken: string;
  deviceSessionId: string;
  familyId: string;
  generation: number;
};

export type RevokeDeviceRequest = RefreshRotationRequest;

export type RevokeDeviceAfterReauthRequest = {
  proof: string;
  targetDeviceSessionId: string;
  targetFamilyId: string;
};

export type AuthSessionAdapter = {
  rotateRefresh(
    request: RefreshRotationRequest,
  ): Promise<RefreshRotationResult>;
  revokeDevice(request: RevokeDeviceRequest): Promise<RevokeDeviceResult>;
  revokeDeviceAfterReauth(
    request: RevokeDeviceAfterReauthRequest,
  ): Promise<RevokeDeviceResult>;
};

export type WechatLoginAttempt = {
  attemptId: number;
  epoch: number;
  purpose: "session" | "revoke";
  expectedAccountScope?: RecoveryScope;
};

export type AuthSessionService = {
  getState(): AuthState;
  getAccessCredential(): AccessCredential | null;
  bootstrap(allowsIdentityFlow: boolean): Promise<AuthState>;
  beginWechatLogin(): WechatLoginAttempt | null;
  beginRevokeReauth(): WechatLoginAttempt | null;
  completeWechatLogin(
    attempt: WechatLoginAttempt,
    session: IssuedAuthSession,
  ): boolean;
  completeRevokeReauth(
    attempt: WechatLoginAttempt,
    authorization: RevokeReauthAuthorization,
  ): Promise<AuthState>;
  ensureAccessCredential(): Promise<AccessCredential | null>;
  handleUnauthorized(
    failedAccessEpoch: number,
  ): Promise<AccessCredential | null>;
  handleAccessExpired(expiredAccessEpoch: number): void;
  logoutCurrentDevice(): Promise<AuthState>;
  retryPendingRevoke(): Promise<AuthState>;
};

export type CreateAuthSessionOptions = {
  storage: MiniProgramStorage;
  adapter: AuthSessionAdapter;
  now?: () => number;
  /** 立即隐藏并清理 Story、余额、草稿与 turn；false 表示无法确认清理。 */
  lockAndClearWorkspace?: () => boolean;
};

type StoredCredential = {
  version: 1;
  kind: "active-refresh";
  refreshToken: string;
  refreshExpiresAt: number;
  deviceSessionId: string;
  familyId: string;
  generation: number;
  accountScope: RecoveryScope;
  account: AuthAccountPresentation;
};

type RotationUnknownMarker = {
  version: 1;
  kind: "rotation-unknown";
  refreshExpiresAt: number;
  deviceSessionId: string;
  familyId: string;
  generation: number;
  accountScope: RecoveryScope;
  account: AuthAccountPresentation;
  markedAt: number;
};

type LogoutReauthMarker = {
  version: 1;
  kind: "logout-revoke-reauth";
  refreshExpiresAt: number;
  deviceSessionId: string;
  familyId: string;
  generation: number;
  accountScope: RecoveryScope;
  account: AuthAccountPresentation;
  requestedAt: number;
};

type PendingRevokeCredential = {
  version: 1;
  kind: "pending-revoke";
  refreshToken: string;
  refreshExpiresAt: number;
  deviceSessionId: string;
  familyId: string;
  generation: number;
  accountScope: RecoveryScope;
  account: AuthAccountPresentation;
  requestedAt: number;
};

type StoredActive =
  | StoredCredential
  | RotationUnknownMarker
  | LogoutReauthMarker;

type StoredRead<T> =
  | { kind: "missing" }
  | { kind: "valid"; value: T }
  | { kind: "invalid" }
  | { kind: "unavailable" };

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isOpaque(value: unknown, minimum = 4, maximum = 2_048): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum &&
    !/\s/.test(value)
  );
}

function normalizePresentation(value: unknown): AuthAccountPresentation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<AuthAccountPresentation>;
  if (
    candidate.maskedEmail !== undefined &&
    (typeof candidate.maskedEmail !== "string" ||
      candidate.maskedEmail.length > 160 ||
      !candidate.maskedEmail.includes("*"))
  ) {
    return null;
  }
  if (
    candidate.displayName !== undefined &&
    (typeof candidate.displayName !== "string" || candidate.displayName.length > 80)
  ) {
    return null;
  }
  return {
    maskedEmail: candidate.maskedEmail,
    displayName: candidate.displayName,
  };
}

function normalizeStoredBase(value: unknown):
  | (Omit<StoredCredential, "kind" | "version" | "refreshToken"> & {
      account: AuthAccountPresentation;
    })
  | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<StoredCredential>;
  const account = normalizePresentation(candidate.account);
  if (
    !isFiniteTimestamp(candidate.refreshExpiresAt) ||
    !isOpaque(candidate.deviceSessionId) ||
    !isOpaque(candidate.familyId) ||
    typeof candidate.generation !== "number" ||
    !Number.isSafeInteger(candidate.generation) ||
    candidate.generation < 0 ||
    !isRecoveryScope(candidate.accountScope) ||
    !account
  ) {
    return null;
  }
  return {
    refreshExpiresAt: candidate.refreshExpiresAt,
    deviceSessionId: candidate.deviceSessionId,
    familyId: candidate.familyId,
    generation: candidate.generation,
    accountScope: candidate.accountScope,
    account,
  };
}

function normalizeActive(value: unknown): StoredActive | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<StoredActive> & { refreshToken?: unknown };
  if (candidate.version !== 1) return null;
  const base = normalizeStoredBase(candidate);
  if (!base) return null;
  if (candidate.kind === "active-refresh" && isOpaque(candidate.refreshToken, 16)) {
    return {
      version: 1,
      kind: "active-refresh",
      refreshToken: candidate.refreshToken,
      ...base,
    };
  }
  if (
    candidate.kind === "rotation-unknown" &&
    isFiniteTimestamp(candidate.markedAt)
  ) {
    return {
      version: 1,
      kind: "rotation-unknown",
      ...base,
      markedAt: candidate.markedAt,
    };
  }
  if (
    candidate.kind === "logout-revoke-reauth" &&
    isFiniteTimestamp((candidate as Partial<LogoutReauthMarker>).requestedAt)
  ) {
    return {
      version: 1,
      kind: "logout-revoke-reauth",
      ...base,
      requestedAt: (candidate as Partial<LogoutReauthMarker>).requestedAt!,
    };
  }
  return null;
}

function normalizePendingRevoke(value: unknown): PendingRevokeCredential | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<PendingRevokeCredential>;
  if (candidate.version !== 1 || candidate.kind !== "pending-revoke") return null;
  const base = normalizeStoredBase(candidate);
  if (
    !base ||
    !isOpaque(candidate.refreshToken, 16) ||
    !isFiniteTimestamp(candidate.requestedAt)
  ) {
    return null;
  }
  return {
    version: 1,
    kind: "pending-revoke",
    refreshToken: candidate.refreshToken,
    ...base,
    requestedAt: candidate.requestedAt,
  };
}

function readStored<T>(
  storage: MiniProgramStorage,
  key: string,
  normalize: (value: unknown) => T | null,
): StoredRead<T> {
  const observed = readStorageItemObserved(storage, key);
  if (observed.kind === "unavailable") return { kind: "unavailable" };
  if (observed.kind === "invalid") return { kind: "invalid" };
  if (observed.kind === "missing" || observed.value === "") {
    return { kind: "missing" };
  }
  try {
    const value = normalize(JSON.parse(observed.value));
    return value ? { kind: "valid", value } : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}

function serialize(value: StoredActive | PendingRevokeCredential): string {
  return JSON.stringify(value);
}

function credentialFromIssued(session: IssuedAuthSession): StoredCredential {
  return {
    version: 1,
    kind: "active-refresh",
    refreshToken: session.refreshToken,
    refreshExpiresAt: session.refreshExpiresAt,
    deviceSessionId: session.deviceSessionId,
    familyId: session.familyId,
    generation: session.generation,
    accountScope: session.accountScope,
    account: session.account,
  };
}

function validateIssued(session: IssuedAuthSession, now: number): boolean {
  return (
    isOpaque(session.accessToken, 16) &&
    isOpaque(session.refreshToken, 16) &&
    isFiniteTimestamp(session.accessExpiresAt) &&
    session.accessExpiresAt > now &&
    isFiniteTimestamp(session.refreshExpiresAt) &&
    session.refreshExpiresAt > now &&
    isOpaque(session.deviceSessionId) &&
    isOpaque(session.familyId) &&
    Number.isSafeInteger(session.generation) &&
    session.generation >= 0 &&
    isRecoveryScope(session.accountScope) &&
    normalizePresentation(session.account) !== null
  );
}

function expectedScope(state: AuthState): RecoveryScope | undefined {
  switch (state.status) {
    case "authenticated":
      return state.accountScope;
    case "refreshing":
    case "reauth-required":
    case "rotation-unknown":
      return state.expectedAccountScope;
    case "privacy-blocked":
    case "logout-revoking":
    case "locked-pending-revoke":
    case "locked-revoke-reauth":
    case "locked-cleanup":
      return state.accountScope;
    case "signed-out":
    case "safely-signed-out":
      return undefined;
  }
}

function requestFromCredential(
  credential: StoredCredential | PendingRevokeCredential,
): RefreshRotationRequest {
  return {
    refreshToken: credential.refreshToken,
    deviceSessionId: credential.deviceSessionId,
    familyId: credential.familyId,
    generation: credential.generation,
  };
}

export function createAuthSession(
  options: CreateAuthSessionOptions,
): AuthSessionService {
  const { storage, adapter } = options;
  const now = options.now ?? (() => Date.now());
  const lockAndClearWorkspace = options.lockAndClearWorkspace ?? (() => true);

  let state: AuthState = createInitialAuthState(false);
  let privacyAllowed = false;
  let accessCredential: AccessCredential | null = null;
  let nextAccessEpoch = 0;
  let refreshInFlight: Promise<AccessCredential | null> | null = null;
  let rotatingCredential: StoredCredential | null = null;
  let epoch = 0;
  let nextLoginAttemptId = 0;
  let currentLoginAttemptId: number | null = null;
  let logoutInFlight: Promise<AuthState> | null = null;
  let pendingRevokeInFlight: Promise<AuthState> | null = null;

  function transition(event: Parameters<typeof reduceAuthState>[1]): void {
    state = reduceAuthState(state, event);
  }

  function clearAccess(): void {
    accessCredential = null;
    nextAccessEpoch += 1;
  }

  function clearAccessIfCurrent(expectedAccessEpoch: number): boolean {
    if (
      accessCredential === null ||
      accessCredential.epoch !== expectedAccessEpoch
    ) {
      return false;
    }
    clearAccess();
    return true;
  }

  function installAccess(session: IssuedAuthSession): AccessCredential {
    const installed: AccessCredential = {
      token: session.accessToken,
      epoch: (nextAccessEpoch += 1),
      expiresAt: session.accessExpiresAt,
    };
    accessCredential = installed;
    return installed;
  }

  function clearWorkspaceOrLock(): boolean {
    try {
      if (lockAndClearWorkspace()) return true;
    } catch {
      // 清理依赖本地适配器；任意异常都不能让下一账号继续进入。
    }
    transition({ type: "cleanup-failed" });
    return false;
  }

  function failStorageClosed(accountScope?: RecoveryScope): void {
    clearAccess();
    if (state.status !== "locked-cleanup") {
      transition({ type: "logout-requested", accountScope });
      transition({ type: "revoke-succeeded" });
    }
    transition({ type: "cleanup-failed" });
  }

  function markRefreshUnknown(marker: RotationUnknownMarker): void {
    transition({
      type: "refresh-began",
      expectedAccountScope: marker.accountScope,
    });
    transition({ type: "refresh-unknown", reason: "refresh-result-unknown" });
  }

  async function performRefresh(): Promise<AccessCredential | null> {
    if (!privacyAllowed || !canUseIdentityNetwork(state)) return null;
    if (
      state.status === "rotation-unknown" ||
      state.status === "logout-revoking" ||
      state.status === "locked-pending-revoke" ||
      state.status === "locked-revoke-reauth" ||
      state.status === "locked-cleanup"
    ) {
      return null;
    }

    const stored = readStored(
      storage,
      AUTH_SESSION_STORAGE_KEYS.active,
      normalizeActive,
    );
    if (stored.kind === "unavailable") {
      failStorageClosed(expectedScope(state));
      return null;
    }
    if (stored.kind === "invalid") {
      const removed = removeStorageItemVerified(
        storage,
        AUTH_SESSION_STORAGE_KEYS.active,
      );
      if (!removed) failStorageClosed(expectedScope(state));
      return null;
    }
    if (stored.kind === "missing") return null;
    if (stored.value.kind === "rotation-unknown") {
      markRefreshUnknown(stored.value);
      return null;
    }
    if (stored.value.kind === "logout-revoke-reauth") {
      transition({
        type: "logout-requested",
        accountScope: stored.value.accountScope,
        deviceSessionId: stored.value.deviceSessionId,
      });
      if (!clearWorkspaceOrLock()) return null;
      transition({
        type: "revoke-reauth-required",
        reason: "reauth-required-for-revoke",
      });
      return null;
    }

    const credential = stored.value;
    transition({
      type: "refresh-began",
      expectedAccountScope: credential.accountScope,
    });
    if (credential.refreshExpiresAt <= now()) {
      if (
        !removeStorageItemVerified(storage, AUTH_SESSION_STORAGE_KEYS.active)
      ) {
        failStorageClosed(credential.accountScope);
        return null;
      }
      transition({ type: "refresh-rejected" });
      return null;
    }

    const marker: RotationUnknownMarker = {
      version: 1,
      kind: "rotation-unknown",
      refreshExpiresAt: credential.refreshExpiresAt,
      deviceSessionId: credential.deviceSessionId,
      familyId: credential.familyId,
      generation: credential.generation,
      accountScope: credential.accountScope,
      account: credential.account,
      markedAt: now(),
    };
    if (
      !writeStorageItemVerified(
        storage,
        AUTH_SESSION_STORAGE_KEYS.active,
        serialize(marker),
      )
    ) {
      failStorageClosed(credential.accountScope);
      return null;
    }

    rotatingCredential = credential;
    const attemptEpoch = epoch;
    try {
      let result: RefreshRotationResult;
      try {
        result = await adapter.rotateRefresh(requestFromCredential(credential));
      } catch {
        if (attemptEpoch === epoch) {
          transition({
            type: "refresh-unknown",
            reason: "refresh-result-unknown",
          });
        }
        return null;
      }
      if (attemptEpoch !== epoch) return null;
      if (!result.ok) {
        if (result.kind === "rejected") {
          if (
            !removeStorageItemVerified(storage, AUTH_SESSION_STORAGE_KEYS.active)
          ) {
            failStorageClosed(credential.accountScope);
            return null;
          }
          transition({ type: "refresh-rejected" });
        } else {
          transition({ type: "refresh-unknown", reason: "refresh-result-unknown" });
        }
        return null;
      }

      const next = result.session;
      const validRotation =
        validateIssued(next, now()) &&
        next.accountScope === credential.accountScope &&
        next.deviceSessionId === credential.deviceSessionId &&
        next.familyId === credential.familyId &&
        next.generation === credential.generation + 1;
      if (!validRotation) {
        transition({ type: "refresh-unknown", reason: "invalid-refresh-response" });
        return null;
      }
      const nextCredential = credentialFromIssued(next);
      if (
        !writeStorageItemVerified(
          storage,
          AUTH_SESSION_STORAGE_KEYS.active,
          serialize(nextCredential),
        )
      ) {
        failStorageClosed(credential.accountScope);
        return null;
      }
      const installed = installAccess(next);
      transition({
        type: "refresh-succeeded",
        accountScope: next.accountScope,
        maskedEmail: next.account.maskedEmail,
        displayName: next.account.displayName,
        accessExpiresAt: next.accessExpiresAt,
      });
      return installed;
    } finally {
      if (rotatingCredential === credential) rotatingCredential = null;
    }
  }

  function refreshSingleFlight(): Promise<AccessCredential | null> {
    if (refreshInFlight) return refreshInFlight;
    const operation = performRefresh();
    refreshInFlight = operation;
    const clear = () => {
      if (refreshInFlight === operation) refreshInFlight = null;
    };
    void operation.then(clear, clear);
    return operation;
  }

  async function finishRevoke(
    pending: PendingRevokeCredential,
  ): Promise<AuthState> {
    const attemptEpoch = epoch;
    let result: RevokeDeviceResult;
    try {
      result = await adapter.revokeDevice(requestFromCredential(pending));
    } catch {
      if (attemptEpoch === epoch) {
        transition({ type: "revoke-failed", reason: "device-revoke-pending" });
      }
      return state;
    }
    if (attemptEpoch !== epoch) return state;
    if (!result.ok) {
      transition({ type: "revoke-failed", reason: "device-revoke-pending" });
      return state;
    }
    if (
      !removeStorageItemVerified(
        storage,
        AUTH_SESSION_STORAGE_KEYS.pendingRevoke,
      )
    ) {
      failStorageClosed(pending.accountScope);
      return state;
    }
    transition({ type: "revoke-succeeded" });
    transition({ type: "cleanup-succeeded" });
    return state;
  }

  function revokePendingSingleFlight(
    pending: PendingRevokeCredential,
  ): Promise<AuthState> {
    if (pendingRevokeInFlight) return pendingRevokeInFlight;
    const operation = finishRevoke(pending);
    pendingRevokeInFlight = operation;
    const clear = () => {
      if (pendingRevokeInFlight === operation) pendingRevokeInFlight = null;
    };
    void operation.then(clear, clear);
    return operation;
  }

  return {
    getState: () => state,

    getAccessCredential() {
      if (
        state.status !== "authenticated" ||
        accessCredential === null ||
        accessCredential.expiresAt <= now()
      ) {
        return null;
      }
      return accessCredential;
    },

    async bootstrap(allowsIdentityFlow) {
      if (!allowsIdentityFlow) {
        privacyAllowed = false;
        epoch += 1;
        clearAccess();
        transition({ type: "privacy-invalidated", reason: "unseen" });
        return state;
      }
      privacyAllowed = true;
      transition({ type: "privacy-restored" });

      const pending = readStored(
        storage,
        AUTH_SESSION_STORAGE_KEYS.pendingRevoke,
        normalizePendingRevoke,
      );
      if (pending.kind === "unavailable") {
        failStorageClosed(expectedScope(state));
        return state;
      }
      if (pending.kind === "invalid") {
        if (
          !removeStorageItemVerified(
            storage,
            AUTH_SESSION_STORAGE_KEYS.pendingRevoke,
          )
        ) {
          failStorageClosed(expectedScope(state));
          return state;
        }
      } else if (pending.kind === "valid") {
        transition({
          type: "logout-requested",
          accountScope: pending.value.accountScope,
          deviceSessionId: pending.value.deviceSessionId,
        });
        if (!clearWorkspaceOrLock()) return state;
        transition({ type: "revoke-failed", reason: "device-revoke-pending" });
        return state;
      }

      await refreshSingleFlight();
      return state;
    },

    beginWechatLogin() {
      if (
        !privacyAllowed ||
        !(
          state.status === "signed-out" ||
          state.status === "safely-signed-out" ||
          state.status === "reauth-required" ||
          state.status === "rotation-unknown"
        )
      ) {
        return null;
      }
      const attempt: WechatLoginAttempt = {
        attemptId: (nextLoginAttemptId += 1),
        epoch,
        purpose: "session",
        expectedAccountScope: expectedScope(state),
      };
      currentLoginAttemptId = attempt.attemptId;
      return attempt;
    },

    completeWechatLogin(attempt, session) {
      if (
        !privacyAllowed ||
        attempt.purpose !== "session" ||
        attempt.epoch !== epoch ||
        attempt.attemptId !== currentLoginAttemptId ||
        !validateIssued(session, now())
      ) {
        return false;
      }
      currentLoginAttemptId = null;
      transition({
        type: "refresh-began",
        expectedAccountScope: attempt.expectedAccountScope,
      });
      if (
        attempt.expectedAccountScope &&
        attempt.expectedAccountScope !== session.accountScope
      ) {
        transition({
          type: "refresh-succeeded",
          accountScope: session.accountScope,
          maskedEmail: session.account.maskedEmail,
          displayName: session.account.displayName,
          accessExpiresAt: session.accessExpiresAt,
        });
        return false;
      }
      const credential = credentialFromIssued(session);
      if (
        !writeStorageItemVerified(
          storage,
          AUTH_SESSION_STORAGE_KEYS.active,
          serialize(credential),
        )
      ) {
        failStorageClosed(session.accountScope);
        return false;
      }
      installAccess(session);
      transition({
        type: "refresh-succeeded",
        accountScope: session.accountScope,
        maskedEmail: session.account.maskedEmail,
        displayName: session.account.displayName,
        accessExpiresAt: session.accessExpiresAt,
      });
      return state.status === "authenticated";
    },

    beginRevokeReauth() {
      if (
        !privacyAllowed ||
        state.status !== "locked-revoke-reauth" ||
        !isRecoveryScope(state.accountScope)
      ) {
        return null;
      }
      const attempt: WechatLoginAttempt = {
        attemptId: (nextLoginAttemptId += 1),
        epoch,
        purpose: "revoke",
        expectedAccountScope: state.accountScope,
      };
      currentLoginAttemptId = attempt.attemptId;
      return attempt;
    },

    async completeRevokeReauth(attempt, authorization) {
      if (
        !privacyAllowed ||
        attempt.purpose !== "revoke" ||
        attempt.epoch !== epoch ||
        attempt.attemptId !== currentLoginAttemptId ||
        !isOpaque(authorization.proof, 16) ||
        !isFiniteTimestamp(authorization.expiresAt) ||
        authorization.expiresAt <= now() ||
        !isRecoveryScope(authorization.accountScope)
      ) {
        return state;
      }
      currentLoginAttemptId = null;
      const stored = readStored(
        storage,
        AUTH_SESSION_STORAGE_KEYS.active,
        normalizeActive,
      );
      if (
        stored.kind !== "valid" ||
        stored.value.kind !== "logout-revoke-reauth"
      ) {
        failStorageClosed(expectedScope(state));
        return state;
      }
      const marker = stored.value;
      if (
        authorization.accountScope !== marker.accountScope ||
        attempt.expectedAccountScope !== marker.accountScope
      ) {
        transition({ type: "revoke-reauth-failed", reason: "identity-mismatch" });
        return state;
      }
      const attemptEpoch = epoch;
      let result: RevokeDeviceResult;
      try {
        result = await adapter.revokeDeviceAfterReauth({
          proof: authorization.proof,
          targetDeviceSessionId: marker.deviceSessionId,
          targetFamilyId: marker.familyId,
        });
      } catch {
        if (attemptEpoch === epoch) {
          transition({
            type: "revoke-reauth-failed",
            reason: "device-revoke-pending",
          });
        }
        return state;
      }
      if (attemptEpoch !== epoch) return state;
      if (!result.ok) {
        transition({
          type: "revoke-reauth-failed",
          reason: "device-revoke-pending",
        });
        return state;
      }
      if (
        !removeStorageItemVerified(storage, AUTH_SESSION_STORAGE_KEYS.active)
      ) {
        failStorageClosed(marker.accountScope);
        return state;
      }
      transition({ type: "revoke-reauth-succeeded" });
      transition({ type: "cleanup-succeeded" });
      return state;
    },

    ensureAccessCredential() {
      const current = this.getAccessCredential();
      if (current) return Promise.resolve(current);
      if (accessCredential !== null) {
        this.handleAccessExpired(accessCredential.epoch);
      }
      return refreshSingleFlight();
    },

    handleUnauthorized(failedAccessEpoch) {
      const current = accessCredential;
      if (current === null || current.epoch !== failedAccessEpoch) {
        return refreshInFlight ?? Promise.resolve(this.getAccessCredential());
      }
      clearAccessIfCurrent(failedAccessEpoch);
      transition({ type: "unauthorized" });
      return refreshSingleFlight();
    },

    handleAccessExpired(expiredAccessEpoch) {
      if (clearAccessIfCurrent(expiredAccessEpoch)) {
        transition({ type: "access-expired" });
      }
    },

    logoutCurrentDevice() {
      if (
        state.status === "locked-pending-revoke" ||
        state.status === "locked-revoke-reauth" ||
        state.status === "locked-cleanup" ||
        state.status === "privacy-blocked"
      ) {
        return Promise.resolve(state);
      }
      if (logoutInFlight) return logoutInFlight;
      const operation = (async (): Promise<AuthState> => {
        epoch += 1;
        currentLoginAttemptId = null;
        clearAccess();

        const pendingRead = readStored(
          storage,
          AUTH_SESSION_STORAGE_KEYS.pendingRevoke,
          normalizePendingRevoke,
        );
        if (pendingRead.kind === "unavailable") {
          failStorageClosed(expectedScope(state));
          return state;
        }
        if (pendingRead.kind === "invalid") {
          if (
            !removeStorageItemVerified(
              storage,
              AUTH_SESSION_STORAGE_KEYS.pendingRevoke,
            )
          ) {
            failStorageClosed(expectedScope(state));
            return state;
          }
        } else if (pendingRead.kind === "valid") {
          transition({
            type: "logout-requested",
            accountScope: pendingRead.value.accountScope,
            deviceSessionId: pendingRead.value.deviceSessionId,
          });
          if (!clearWorkspaceOrLock()) return state;
          transition({ type: "revoke-failed", reason: "device-revoke-pending" });
          return state;
        }

        const stored = readStored(
          storage,
          AUTH_SESSION_STORAGE_KEYS.active,
          normalizeActive,
        );
        if (stored.kind === "unavailable") {
          failStorageClosed(expectedScope(state));
          return state;
        }
        if (stored.kind === "invalid") {
          if (!removeStorageItemVerified(storage, AUTH_SESSION_STORAGE_KEYS.active)) {
            failStorageClosed(expectedScope(state));
            return state;
          }
        }
        const credential =
          rotatingCredential ??
          (stored.kind === "valid" && stored.value.kind === "active-refresh"
            ? stored.value
            : null);
        const marker =
          stored.kind === "valid" && stored.value.kind !== "active-refresh"
            ? stored.value
            : null;
        transition({
          type: "logout-requested",
          accountScope:
            credential?.accountScope ?? marker?.accountScope ?? expectedScope(state),
          deviceSessionId: credential?.deviceSessionId ?? marker?.deviceSessionId,
        });

        let pending: PendingRevokeCredential | null = null;
        if (credential) {
          pending = {
            version: 1,
            kind: "pending-revoke",
            refreshToken: credential.refreshToken,
            refreshExpiresAt: credential.refreshExpiresAt,
            deviceSessionId: credential.deviceSessionId,
            familyId: credential.familyId,
            generation: credential.generation,
            accountScope: credential.accountScope,
            account: credential.account,
            requestedAt: now(),
          };
          if (
            !writeStorageItemVerified(
              storage,
              AUTH_SESSION_STORAGE_KEYS.pendingRevoke,
              serialize(pending),
            )
          ) {
            failStorageClosed(credential.accountScope);
            return state;
          }
        } else if (marker?.kind === "rotation-unknown") {
          const logoutMarker: LogoutReauthMarker = {
            ...marker,
            kind: "logout-revoke-reauth",
            requestedAt: now(),
          };
          if (
            !writeStorageItemVerified(
              storage,
              AUTH_SESSION_STORAGE_KEYS.active,
              serialize(logoutMarker),
            )
          ) {
            failStorageClosed(marker.accountScope);
            return state;
          }
        }

        if (!clearWorkspaceOrLock()) return state;
        if (pending) {
          if (!removeStorageItemVerified(storage, AUTH_SESSION_STORAGE_KEYS.active)) {
            failStorageClosed(pending.accountScope);
            return state;
          }
          return revokePendingSingleFlight(pending);
        }
        if (marker) {
          transition({
            type: "revoke-reauth-required",
            reason: "reauth-required-for-revoke",
          });
          return state;
        }
        transition({ type: "revoke-succeeded" });
        transition({ type: "cleanup-succeeded" });
        return state;
      })();
      logoutInFlight = operation;
      const clear = () => {
        if (logoutInFlight === operation) logoutInFlight = null;
      };
      void operation.then(clear, clear);
      return operation;
    },

    async retryPendingRevoke() {
      if (!privacyAllowed || state.status !== "locked-pending-revoke") return state;
      if (logoutInFlight) return logoutInFlight;
      const pending = readStored(
        storage,
        AUTH_SESSION_STORAGE_KEYS.pendingRevoke,
        normalizePendingRevoke,
      );
      if (pending.kind !== "valid") {
        failStorageClosed(expectedScope(state));
        return state;
      }
      transition({ type: "revoke-retry" });
      return revokePendingSingleFlight(pending.value);
    },
  };
}
