import { describe, expect, it } from "vitest";

import {
  canRenderWorkspace,
  canSwitchAccount,
  canUseIdentityNetwork,
  canWriteWorkspace,
  createInitialAuthState,
  reduceAuthState,
  type AuthState,
} from "../src/core/authState";

const SCOPE = "acct_scope_A7";
const NOW = 1_780_000_000_000;

function authenticated(): AuthState {
  return {
    status: "authenticated",
    accountScope: SCOPE,
    maskedEmail: "y***@example.com",
    displayName: "小宇",
    accessExpiresAt: NOW + 60_000,
  };
}

describe("客户端认证状态机", () => {
  it("隐私未同意或失效时封锁所有身份与业务能力", () => {
    const initial = createInitialAuthState(false);
    expect(initial.status).toBe("privacy-blocked");
    expect(canUseIdentityNetwork(initial)).toBe(false);

    const blocked = reduceAuthState(authenticated(), {
      type: "privacy-invalidated",
      reason: "withdrawn",
    });
    expect(blocked).toMatchObject({ status: "privacy-blocked", accountScope: SCOPE });
    expect(canRenderWorkspace(blocked, NOW)).toBe(false);
    expect(canWriteWorkspace(blocked, NOW)).toBe(false);
  });

  it("refresh 成功认证；明确拒绝要求重认证；结果未知进入 rotation-unknown", () => {
    const refreshing = reduceAuthState(createInitialAuthState(true), {
      type: "refresh-began",
      expectedAccountScope: SCOPE,
    });
    expect(refreshing.status).toBe("refreshing");

    expect(
      reduceAuthState(refreshing, {
        type: "refresh-succeeded",
        accountScope: SCOPE,
        accessExpiresAt: NOW + 60_000,
      }),
    ).toMatchObject({ status: "authenticated", accountScope: SCOPE });
    expect(reduceAuthState(refreshing, { type: "refresh-rejected" })).toMatchObject({
      status: "reauth-required",
      reason: "refresh-rejected",
      expectedAccountScope: SCOPE,
    });
    expect(
      reduceAuthState(refreshing, { type: "refresh-unknown", reason: "timeout" }),
    ).toMatchObject({ status: "rotation-unknown", expectedAccountScope: SCOPE });
  });

  it("401 与自然过期保留预期 scope，并且在状态尚未归约时 selector 也拒绝过期访问", () => {
    expect(reduceAuthState(authenticated(), { type: "unauthorized" })).toMatchObject({
      status: "reauth-required",
      reason: "unauthorized",
      expectedAccountScope: SCOPE,
    });
    expect(reduceAuthState(authenticated(), { type: "access-expired" })).toMatchObject({
      status: "reauth-required",
      reason: "expired",
      expectedAccountScope: SCOPE,
    });
    expect(canSwitchAccount(reduceAuthState(authenticated(), { type: "access-expired" }))).toBe(
      false,
    );
    expect(canRenderWorkspace(authenticated(), NOW)).toBe(true);
    expect(canWriteWorkspace(authenticated(), NOW + 60_001)).toBe(false);
  });

  it("同 scope 重认证恢复，不同 scope 保持锁定为 identity mismatch", () => {
    const required = reduceAuthState(authenticated(), { type: "unauthorized" });
    const refreshing = reduceAuthState(required, { type: "refresh-began" });
    expect(
      reduceAuthState(refreshing, {
        type: "refresh-succeeded",
        accountScope: SCOPE,
        accessExpiresAt: NOW + 60_000,
      }).status,
    ).toBe("authenticated");
    expect(
      reduceAuthState(refreshing, {
        type: "refresh-succeeded",
        accountScope: "acct_scope_B9",
      }),
    ).toMatchObject({
      status: "reauth-required",
      reason: "identity-mismatch",
      expectedAccountScope: SCOPE,
    });
  });

  it("显式退出从请求起锁定，撤销失败可重试，清理完成才安全退出", () => {
    const revoking = reduceAuthState(authenticated(), {
      type: "logout-requested",
      deviceSessionId: "device_session_3",
    });
    expect(revoking.status).toBe("logout-revoking");
    expect(canRenderWorkspace(revoking, NOW)).toBe(false);
    expect(canSwitchAccount(revoking)).toBe(false);

    const pending = reduceAuthState(revoking, {
      type: "revoke-failed",
      reason: "offline",
    });
    expect(pending.status).toBe("locked-pending-revoke");
    const retrying = reduceAuthState(pending, { type: "revoke-retry" });
    const cleanup = reduceAuthState(retrying, { type: "revoke-succeeded" });
    expect(cleanup.status).toBe("locked-cleanup");
    expect(reduceAuthState(cleanup, { type: "cleanup-failed" })).toMatchObject({
      status: "locked-cleanup",
      reason: "cleanup-failed",
    });
    const done = reduceAuthState(cleanup, { type: "cleanup-succeeded" });
    expect(done.status).toBe("safely-signed-out");
    expect(canSwitchAccount(done)).toBe(true);
  });

  it("退出中隐私失效仍保留锁，恢复隐私后回到待撤销而非普通登出", () => {
    const revoking = reduceAuthState(authenticated(), { type: "logout-requested" });
    const blocked = reduceAuthState(revoking, {
      type: "privacy-invalidated",
      reason: "stale-version",
    });
    expect(blocked).toMatchObject({
      status: "privacy-blocked",
      resumeLogout: "pending-revoke",
    });
    expect(reduceAuthState(blocked, { type: "privacy-restored" }).status).toBe(
      "locked-pending-revoke",
    );
  });

  it("隐私撤回与恢复不会把 cleanup 或仅撤销重认证阶段降级成普通待撤销", () => {
    const cleanupBlocked = reduceAuthState(
      { status: "locked-cleanup", accountScope: SCOPE },
      { type: "privacy-invalidated", reason: "withdrawn" },
    );
    expect(cleanupBlocked).toMatchObject({
      status: "privacy-blocked",
      resumeLogout: "cleanup",
    });
    expect(reduceAuthState(cleanupBlocked, { type: "privacy-restored" }).status).toBe(
      "locked-cleanup",
    );

    const reauthBlocked = reduceAuthState(
      {
        status: "locked-revoke-reauth",
        reason: "reauth-required-for-revoke",
        accountScope: SCOPE,
        deviceSessionId: "device_session_3",
      },
      { type: "privacy-invalidated", reason: "stale-version" },
    );
    expect(reauthBlocked).toMatchObject({
      status: "privacy-blocked",
      resumeLogout: "revoke-reauth",
    });
    expect(reduceAuthState(reauthBlocked, { type: "privacy-restored" }).status).toBe(
      "locked-revoke-reauth",
    );
  });

  it("非认证及所有不确定/锁定状态都不能渲染或写业务", () => {
    const states: AuthState[] = [
      createInitialAuthState(true),
      { status: "refreshing", expectedAccountScope: SCOPE },
      { status: "reauth-required", reason: "expired", expectedAccountScope: SCOPE },
      { status: "rotation-unknown", reason: "timeout", expectedAccountScope: SCOPE },
      { status: "logout-revoking", accountScope: SCOPE },
      { status: "locked-pending-revoke", reason: "offline", accountScope: SCOPE },
      {
        status: "locked-revoke-reauth",
        reason: "reauth-required-for-revoke",
        accountScope: SCOPE,
      },
      { status: "locked-cleanup", accountScope: SCOPE },
      { status: "safely-signed-out" },
    ];
    for (const state of states) {
      expect(canRenderWorkspace(state, NOW)).toBe(false);
      expect(canWriteWorkspace(state, NOW)).toBe(false);
    }
  });

  it("任意阶段发现本机清理不可确认都会进入 locked-cleanup", () => {
    expect(
      reduceAuthState(authenticated(), { type: "cleanup-failed" }),
    ).toMatchObject({
      status: "locked-cleanup",
      reason: "cleanup-failed",
      accountScope: SCOPE,
    });
  });

  it("序列化状态不包含凭据字段、openid 或完整邮箱原文", () => {
    const serialized = JSON.stringify(authenticated());
    expect(serialized).not.toMatch(/accessToken|refreshToken|openid/i);
    expect(serialized).not.toContain("yuan.dai@example.com");
    expect(serialized).toContain("y***@example.com");
  });
});
