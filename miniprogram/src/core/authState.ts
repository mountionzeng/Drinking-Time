/**
 * 纯客户端认证状态机。
 *
 * 它只保存界面与安全门控所需的最小元数据。凭据、微信身份原文、完整邮箱
 * 必须留在会话/传输边界，不能进入这里，也就不会被意外序列化进页面状态。
 */

export type AccountMetadata = {
  accountScope: string;
  maskedEmail?: string;
  displayName?: string;
  accessExpiresAt?: number;
};

export type ReauthReason =
  | "unauthorized"
  | "expired"
  | "refresh-rejected"
  | "identity-mismatch";

type ResumeLogoutPhase =
  | "none"
  | "pending-revoke"
  | "revoke-reauth"
  | "cleanup";

export type AuthState =
  | {
      status: "privacy-blocked";
      reason: "unseen" | "rejected" | "withdrawn" | "stale-version";
      accountScope?: string;
      resumeLogout: ResumeLogoutPhase;
      deviceSessionId?: string;
    }
  | { status: "signed-out" }
  | ({ status: "refreshing"; expectedAccountScope?: string } &
      Partial<Omit<AccountMetadata, "accountScope">>)
  | ({ status: "authenticated" } & AccountMetadata)
  | {
      status: "reauth-required";
      reason: ReauthReason;
      expectedAccountScope: string;
      maskedEmail?: string;
      displayName?: string;
    }
  | {
      status: "rotation-unknown";
      reason: string;
      expectedAccountScope: string;
      maskedEmail?: string;
      displayName?: string;
    }
  | {
      status: "logout-revoking";
      accountScope?: string;
      deviceSessionId?: string;
    }
  | {
      status: "locked-pending-revoke";
      reason: string;
      accountScope?: string;
      deviceSessionId?: string;
    }
  | {
      status: "locked-revoke-reauth";
      reason: string;
      accountScope?: string;
      deviceSessionId?: string;
    }
  | {
      status: "locked-cleanup";
      reason?: "cleanup-failed";
      accountScope?: string;
    }
  | { status: "safely-signed-out" };

export type AuthEvent =
  | {
      type: "privacy-invalidated";
      reason: "unseen" | "rejected" | "withdrawn" | "stale-version";
    }
  | { type: "privacy-restored" }
  | { type: "refresh-began"; expectedAccountScope?: string }
  | ({ type: "refresh-succeeded" } & AccountMetadata)
  | { type: "refresh-rejected" }
  | { type: "refresh-unknown"; reason: string }
  | { type: "unauthorized" }
  | { type: "access-expired" }
  | {
      type: "logout-requested";
      accountScope?: string;
      deviceSessionId?: string;
    }
  | { type: "revoke-retry" }
  | { type: "revoke-failed"; reason: string }
  | { type: "revoke-reauth-required"; reason: string }
  | { type: "revoke-reauth-failed"; reason: string }
  | { type: "revoke-reauth-succeeded" }
  | { type: "revoke-succeeded" }
  | { type: "cleanup-failed" }
  | { type: "cleanup-succeeded" };

export function createInitialAuthState(privacyAllowed: boolean): AuthState {
  return privacyAllowed
    ? { status: "signed-out" }
    : {
        status: "privacy-blocked",
        reason: "unseen",
        resumeLogout: "none",
      };
}

function accountScopeOf(state: AuthState): string | undefined {
  switch (state.status) {
    case "authenticated":
    case "logout-revoking":
    case "locked-pending-revoke":
    case "locked-revoke-reauth":
    case "locked-cleanup":
    case "privacy-blocked":
      return state.accountScope;
    case "refreshing":
    case "reauth-required":
    case "rotation-unknown":
      return state.expectedAccountScope;
    case "signed-out":
    case "safely-signed-out":
      return undefined;
    default:
      return assertNever(state);
  }
}

function presentationOf(
  state: AuthState,
): Pick<AccountMetadata, "maskedEmail" | "displayName"> {
  if (
    state.status === "authenticated" ||
    state.status === "refreshing" ||
    state.status === "reauth-required" ||
    state.status === "rotation-unknown"
  ) {
    return { maskedEmail: state.maskedEmail, displayName: state.displayName };
  }
  return {};
}

function needsReauth(
  state: AuthState,
  reason: Extract<ReauthReason, "unauthorized" | "expired">,
): AuthState {
  const expectedAccountScope = accountScopeOf(state);
  if (!expectedAccountScope) return state;
  return { status: "reauth-required", reason, expectedAccountScope, ...presentationOf(state) };
}

function resumeLogoutPhase(state: AuthState): ResumeLogoutPhase {
  switch (state.status) {
    case "logout-revoking":
    case "locked-pending-revoke":
      return "pending-revoke";
    case "locked-revoke-reauth":
      return "revoke-reauth";
    case "locked-cleanup":
      return "cleanup";
    default:
      return "none";
  }
}

export function reduceAuthState(state: AuthState, event: AuthEvent): AuthState {
  switch (event.type) {
    case "privacy-invalidated":
      return {
        status: "privacy-blocked",
        reason: event.reason,
        accountScope: accountScopeOf(state),
        resumeLogout: resumeLogoutPhase(state),
        deviceSessionId:
          state.status === "logout-revoking" ||
          state.status === "locked-pending-revoke" ||
          state.status === "locked-revoke-reauth"
            ? state.deviceSessionId
            : undefined,
      };
    case "privacy-restored":
      if (state.status !== "privacy-blocked") return state;
      if (state.resumeLogout === "pending-revoke") {
        return {
          status: "locked-pending-revoke",
          reason: "privacy-restored-after-logout",
          accountScope: state.accountScope,
          deviceSessionId: state.deviceSessionId,
        };
      }
      if (state.resumeLogout === "revoke-reauth") {
        return {
          status: "locked-revoke-reauth",
          reason: "privacy-restored-before-revoke-reauth",
          accountScope: state.accountScope,
          deviceSessionId: state.deviceSessionId,
        };
      }
      if (state.resumeLogout === "cleanup") {
        return {
          status: "locked-cleanup",
          reason: "cleanup-failed",
          accountScope: state.accountScope,
        };
      }
      return state.accountScope
        ? {
            status: "reauth-required",
            reason: "unauthorized",
            expectedAccountScope: state.accountScope,
          }
        : { status: "signed-out" };
    case "refresh-began": {
      if (
        state.status === "privacy-blocked" ||
        state.status === "logout-revoking" ||
        state.status === "locked-pending-revoke" ||
        state.status === "locked-revoke-reauth" ||
        state.status === "locked-cleanup"
      ) return state;
      const expectedAccountScope = accountScopeOf(state) ?? event.expectedAccountScope;
      return { status: "refreshing", expectedAccountScope, ...presentationOf(state) };
    }
    case "refresh-succeeded": {
      if (state.status !== "refreshing") return state;
      const expected = state.expectedAccountScope;
      if (expected && expected !== event.accountScope) {
        return {
          status: "reauth-required",
          reason: "identity-mismatch",
          expectedAccountScope: expected,
          ...presentationOf(state),
        };
      }
      return {
        status: "authenticated",
        accountScope: event.accountScope,
        maskedEmail: event.maskedEmail,
        displayName: event.displayName,
        accessExpiresAt: event.accessExpiresAt,
      };
    }
    case "refresh-rejected": {
      if (state.status !== "refreshing" || !state.expectedAccountScope) return state;
      return {
        status: "reauth-required",
        reason: "refresh-rejected",
        expectedAccountScope: state.expectedAccountScope,
        ...presentationOf(state),
      };
    }
    case "refresh-unknown": {
      if (state.status !== "refreshing" || !state.expectedAccountScope) return state;
      return {
        status: "rotation-unknown",
        reason: event.reason,
        expectedAccountScope: state.expectedAccountScope,
        ...presentationOf(state),
      };
    }
    case "unauthorized":
      return needsReauth(state, "unauthorized");
    case "access-expired":
      return needsReauth(state, "expired");
    case "logout-requested":
      if (state.status === "privacy-blocked") return state;
      return {
        status: "logout-revoking",
        accountScope: event.accountScope ?? accountScopeOf(state),
        deviceSessionId: event.deviceSessionId,
      };
    case "revoke-retry":
      return state.status === "locked-pending-revoke"
        ? {
            status: "logout-revoking",
            accountScope: state.accountScope,
            deviceSessionId: state.deviceSessionId,
          }
        : state;
    case "revoke-failed":
      return state.status === "logout-revoking"
        ? {
            status: "locked-pending-revoke",
            reason: event.reason,
            accountScope: state.accountScope,
            deviceSessionId: state.deviceSessionId,
          }
        : state;
    case "revoke-reauth-required":
      return state.status === "logout-revoking"
        ? {
            status: "locked-revoke-reauth",
            reason: event.reason,
            accountScope: state.accountScope,
            deviceSessionId: state.deviceSessionId,
          }
        : state;
    case "revoke-reauth-failed":
      return state.status === "locked-revoke-reauth"
        ? { ...state, reason: event.reason }
        : state;
    case "revoke-succeeded":
      return state.status === "logout-revoking"
        ? { status: "locked-cleanup", accountScope: state.accountScope }
        : state;
    case "revoke-reauth-succeeded":
      return state.status === "locked-revoke-reauth"
        ? { status: "locked-cleanup", accountScope: state.accountScope }
        : state;
    case "cleanup-failed":
      return {
        status: "locked-cleanup",
        reason: "cleanup-failed",
        accountScope: accountScopeOf(state),
      };
    case "cleanup-succeeded":
      return state.status === "locked-cleanup"
        ? { status: "safely-signed-out" }
        : state;
    default:
      return assertNever(event);
  }
}

/** 允许登录、刷新、撤销会话等身份网络动作。 */
export function canUseIdentityNetwork(state: AuthState): boolean {
  return state.status !== "privacy-blocked" && state.status !== "locked-cleanup";
}

/** 只有确认身份且令牌尚未自然过期时才可渲染账号业务内容。 */
export function canRenderWorkspace(state: AuthState, now: number = Date.now()): boolean {
  return (
    state.status === "authenticated" &&
    (state.accessExpiresAt === undefined || state.accessExpiresAt > now)
  );
}

export function canWriteWorkspace(state: AuthState, now: number = Date.now()): boolean {
  return canRenderWorkspace(state, now);
}

export function canSwitchAccount(state: AuthState): boolean {
  return (
    state.status === "signed-out" ||
    state.status === "safely-signed-out"
  );
}

function assertNever(value: never): never {
  throw new Error(`Unhandled auth state/event: ${JSON.stringify(value)}`);
}
