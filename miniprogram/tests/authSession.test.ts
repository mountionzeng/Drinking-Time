import { afterEach, describe, expect, it, vi } from "vitest";

import { recoveryKey } from "../src/core/recoveryState";
import {
  AUTH_SESSION_STORAGE_KEYS,
  createAuthSession,
  type AuthSessionAdapter,
  type IssuedAuthSession,
  type RefreshRotationResult,
  type RevokeReauthAuthorization,
  type RevokeDeviceResult,
} from "../src/services/authSession";
import {
  createMemoryStorage,
  createWxStorage,
  type MiniProgramStorage,
} from "../src/services/storage";

const NOW = 1_780_000_000_000;
const SCOPE_A = "account-scope-a1";
const SCOPE_B = "account-scope-b2";

function opaque(label: string): string {
  return `${label}-${"z".repeat(32)}`;
}

function issued(
  overrides: Partial<IssuedAuthSession> = {},
): IssuedAuthSession {
  const accessToken = opaque("access");
  const refreshToken = opaque("refresh");
  return {
    accessToken,
    accessExpiresAt: NOW + 15 * 60_000,
    refreshToken,
    refreshExpiresAt: NOW + 30 * 24 * 60 * 60_000,
    deviceSessionId: "device-session-a1",
    familyId: "family-a1",
    generation: 1,
    accountScope: SCOPE_A,
    account: {
      maskedEmail: "m***@example.com",
      displayName: "山",
    },
    ...overrides,
  };
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

function adapter(overrides: Partial<AuthSessionAdapter> = {}) {
  const calls = { refresh: 0, revoke: 0, reauthRevoke: 0 };
  const next = issued({
    accessToken: opaque("next-access"),
    refreshToken: opaque("next-refresh"),
    generation: 2,
  });
  const value: AuthSessionAdapter = {
    async rotateRefresh(): Promise<RefreshRotationResult> {
      calls.refresh += 1;
      return { ok: true, session: next };
    },
    async revokeDevice(): Promise<RevokeDeviceResult> {
      calls.revoke += 1;
      return { ok: true };
    },
    async revokeDeviceAfterReauth(): Promise<RevokeDeviceResult> {
      calls.reauthRevoke += 1;
      return { ok: true };
    },
    ...overrides,
  };
  return { value, calls, next };
}

function revokeAuthorization(
  overrides: Partial<RevokeReauthAuthorization> = {},
): RevokeReauthAuthorization {
  return {
    proof: opaque("revoke-proof"),
    expiresAt: NOW + 5 * 60_000,
    accountScope: SCOPE_A,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function seedActiveSession(
  storage: MiniProgramStorage,
  session: IssuedAuthSession = issued(),
): Promise<void> {
  const fake = adapter();
  const auth = createAuthSession({ storage, adapter: fake.value, now: () => NOW });
  await auth.bootstrap(true);
  const attempt = auth.beginWechatLogin();
  expect(attempt).not.toBeNull();
  expect(auth.completeWechatLogin(attempt!, session)).toBe(true);
}

function storedText(storage: MiniProgramStorage): string {
  return storage
    .keys()
    .map(key => `${key}\n${storage.getItem(key) ?? ""}`)
    .join("\n");
}

describe("小程序认证会话", () => {
  it("隐私未同意时不读取或使用 refresh，也不发身份网络", async () => {
    let reads = 0;
    const base = createMemoryStorage();
    await seedActiveSession(base);
    const guarded: MiniProgramStorage = {
      getItem(key) {
        reads += 1;
        return base.getItem(key);
      },
      setItem: (key, value) => base.setItem(key, value),
      removeItem: key => base.removeItem(key),
      keys: () => base.keys(),
    };
    const fake = adapter();
    const auth = createAuthSession({
      storage: guarded,
      adapter: fake.value,
      now: () => NOW,
    });

    await auth.bootstrap(false);

    expect(auth.getState().status).toBe("privacy-blocked");
    expect(reads).toBe(0);
    expect(fake.calls).toEqual({ refresh: 0, revoke: 0, reauthRevoke: 0 });
    expect(auth.beginWechatLogin()).toBeNull();
  });

  it("登录后的 access 只在内存，进程重建后只用持久 refresh 恢复", async () => {
    const storage = createMemoryStorage();
    const firstAdapter = adapter();
    const first = createAuthSession({
      storage,
      adapter: firstAdapter.value,
      now: () => NOW,
    });
    await first.bootstrap(true);
    const attempt = first.beginWechatLogin();
    const firstSession = issued();
    expect(first.completeWechatLogin(attempt!, firstSession)).toBe(true);
    expect(first.getAccessCredential()?.token).toBe(firstSession.accessToken);
    expect(storedText(storage)).not.toContain(firstSession.accessToken);
    expect(storedText(storage)).toContain(firstSession.refreshToken);

    const nextAdapter = adapter();
    const restarted = createAuthSession({
      storage,
      adapter: nextAdapter.value,
      now: () => NOW,
    });
    expect(restarted.getAccessCredential()).toBeNull();
    await restarted.bootstrap(true);

    expect(nextAdapter.calls.refresh).toBe(1);
    expect(restarted.getAccessCredential()?.token).toBe(nextAdapter.next.accessToken);
    const active = JSON.parse(
      storage.getItem(AUTH_SESSION_STORAGE_KEYS.active) ?? "null",
    ) as { refreshToken?: string } | null;
    expect(active?.refreshToken).toBe(nextAdapter.next.refreshToken);
    expect(active?.refreshToken).not.toBe(firstSession.refreshToken);
  });

  it("bootstrap 与 onShow 共用一次 refresh", async () => {
    const storage = createMemoryStorage();
    await seedActiveSession(storage);
    const control = deferred<RefreshRotationResult>();
    const fake = adapter({
      rotateRefresh: async () => {
        fake.calls.refresh += 1;
        return control.promise;
      },
    });
    const auth = createAuthSession({ storage, adapter: fake.value, now: () => NOW });

    const bootstrap = auth.bootstrap(true);
    const onShow = auth.ensureAccessCredential();
    await Promise.resolve();
    expect(fake.calls.refresh).toBe(1);

    control.resolve({ ok: true, session: fake.next });
    await Promise.all([bootstrap, onShow]);
    expect(fake.calls.refresh).toBe(1);
    expect(auth.getAccessCredential()?.token).toBe(fake.next.accessToken);
  });

  it("同一 access 的并发 401 共用一次 refresh", async () => {
    const storage = createMemoryStorage();
    const control = deferred<RefreshRotationResult>();
    const fake = adapter({
      rotateRefresh: async () => {
        fake.calls.refresh += 1;
        return control.promise;
      },
    });
    const auth = createAuthSession({ storage, adapter: fake.value, now: () => NOW });
    await auth.bootstrap(true);
    const attempt = auth.beginWechatLogin();
    expect(auth.completeWechatLogin(attempt!, issued())).toBe(true);
    const failed = auth.getAccessCredential();
    expect(failed).not.toBeNull();

    const first = auth.handleUnauthorized(failed!.epoch);
    const second = auth.handleUnauthorized(failed!.epoch);
    await Promise.resolve();
    expect(fake.calls.refresh).toBe(1);

    control.resolve({ ok: true, session: fake.next });
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult?.token).toBe(fake.next.accessToken);
    expect(secondResult?.token).toBe(fake.next.accessToken);
    expect(fake.calls.refresh).toBe(1);
  });

  it("旧 access 的迟到 401 和过期回调不会清除新 access 或再次轮换", async () => {
    const storage = createMemoryStorage();
    const fake = adapter();
    const auth = createAuthSession({ storage, adapter: fake.value, now: () => NOW });
    await auth.bootstrap(true);
    const attempt = auth.beginWechatLogin();
    expect(auth.completeWechatLogin(attempt!, issued())).toBe(true);
    const oldAccess = auth.getAccessCredential();
    expect(oldAccess).not.toBeNull();

    const refreshed = await auth.handleUnauthorized(oldAccess!.epoch);
    expect(refreshed?.token).toBe(fake.next.accessToken);
    expect(fake.calls.refresh).toBe(1);

    const late401 = await auth.handleUnauthorized(oldAccess!.epoch);
    auth.handleAccessExpired(oldAccess!.epoch);

    expect(late401).toEqual(refreshed);
    expect(auth.getAccessCredential()).toEqual(refreshed);
    expect(fake.calls.refresh).toBe(1);
    expect(auth.getState().status).toBe("authenticated");
  });

  it("refresh 结果未知后持久槽不含旧 token，当前与重启实例都不重放", async () => {
    const storage = createMemoryStorage();
    const old = issued();
    await seedActiveSession(storage, old);
    const fake = adapter({
      rotateRefresh: async () => {
        fake.calls.refresh += 1;
        return { ok: false, kind: "unknown-result" };
      },
    });
    const auth = createAuthSession({ storage, adapter: fake.value, now: () => NOW });

    await auth.bootstrap(true);
    expect(auth.getState().status).toBe("rotation-unknown");
    expect(storedText(storage)).not.toContain(old.refreshToken);
    expect(storedText(storage)).toContain("rotation-unknown");
    await auth.ensureAccessCredential();
    expect(fake.calls.refresh).toBe(1);

    const restartedAdapter = adapter();
    const restarted = createAuthSession({
      storage,
      adapter: restartedAdapter.value,
      now: () => NOW,
    });
    await restarted.bootstrap(true);
    expect(restarted.getState().status).toBe("rotation-unknown");
    expect(restartedAdapter.calls.refresh).toBe(0);
  });

  it("refresh transport 抛异常也收敛为结果未知，不恢复旧 token", async () => {
    const storage = createMemoryStorage();
    const old = issued();
    await seedActiveSession(storage, old);
    const fake = adapter({
      rotateRefresh: async () => {
        fake.calls.refresh += 1;
        throw new Error("simulated transport crash");
      },
    });
    const auth = createAuthSession({ storage, adapter: fake.value, now: () => NOW });

    await expect(auth.bootstrap(true)).resolves.toMatchObject({
      status: "rotation-unknown",
    });
    expect(storedText(storage)).not.toContain(old.refreshToken);
    expect(fake.calls.refresh).toBe(1);
  });

  it("轮换请求发出后进程被杀，新实例看见哨兵并且不会重放", async () => {
    const storage = createMemoryStorage();
    await seedActiveSession(storage);
    const rotation = deferred<RefreshRotationResult>();
    const firstAdapter = adapter({
      rotateRefresh: async () => {
        firstAdapter.calls.refresh += 1;
        return rotation.promise;
      },
    });
    const first = createAuthSession({
      storage,
      adapter: firstAdapter.value,
      now: () => NOW,
    });
    const abandoned = first.bootstrap(true);
    await Promise.resolve();
    expect(firstAdapter.calls.refresh).toBe(1);

    const secondAdapter = adapter();
    const restarted = createAuthSession({
      storage,
      adapter: secondAdapter.value,
      now: () => NOW,
    });
    await restarted.bootstrap(true);

    expect(restarted.getState().status).toBe("rotation-unknown");
    expect(secondAdapter.calls.refresh).toBe(0);
    rotation.resolve({ ok: false, kind: "unknown-result" });
    await abandoned;
  });

  it("refresh 明确拒绝时丢弃旧凭据并要求同账号重认证", async () => {
    const storage = createMemoryStorage();
    await seedActiveSession(storage);
    const fake = adapter({
      rotateRefresh: async () => {
        fake.calls.refresh += 1;
        return { ok: false, kind: "rejected" };
      },
    });
    const auth = createAuthSession({ storage, adapter: fake.value, now: () => NOW });

    await auth.bootstrap(true);

    expect(auth.getState()).toMatchObject({
      status: "reauth-required",
      expectedAccountScope: SCOPE_A,
    });
    expect(storage.getItem(AUTH_SESSION_STORAGE_KEYS.active)).toBeNull();
  });

  it("自然过期只允许同 scope 恢复，不同账号不会覆盖旧恢复作用域", async () => {
    const storage = createMemoryStorage();
    const fake = adapter();
    const auth = createAuthSession({ storage, adapter: fake.value, now: () => NOW });
    await auth.bootstrap(true);
    const firstAttempt = auth.beginWechatLogin();
    expect(auth.completeWechatLogin(firstAttempt!, issued())).toBe(true);
    auth.handleAccessExpired(auth.getAccessCredential()!.epoch);

    const wrongAttempt = auth.beginWechatLogin();
    expect(
      auth.completeWechatLogin(
        wrongAttempt!,
        issued({ accountScope: SCOPE_B, deviceSessionId: "device-session-b2" }),
      ),
    ).toBe(false);
    expect(auth.getState()).toMatchObject({
      status: "reauth-required",
      reason: "identity-mismatch",
      expectedAccountScope: SCOPE_A,
    });

    const sameAttempt = auth.beginWechatLogin();
    expect(auth.completeWechatLogin(sameAttempt!, issued())).toBe(true);
    expect(auth.getState()).toMatchObject({
      status: "authenticated",
      accountScope: SCOPE_A,
    });
  });

  it("显式退出先隐藏并清内容；撤销失败保持锁定，重试成功才安全退出", async () => {
    const storage = createMemoryStorage();
    const session = issued();
    await seedActiveSession(storage, session);
    const draftKey = recoveryKey("document", SCOPE_A, 1);
    storage.setItem(draftKey, "不能留给下个账号的正文");
    let clearCalls = 0;
    const fake = adapter({
      revokeDevice: async () => {
        fake.calls.revoke += 1;
        return fake.calls.revoke === 1
          ? { ok: false, kind: "unknown-result" }
          : { ok: true };
      },
    });
    const auth = createAuthSession({
      storage,
      adapter: fake.value,
      now: () => NOW,
      lockAndClearWorkspace: () => {
        clearCalls += 1;
        storage.removeItem(draftKey);
        return storage.getItem(draftKey) === null;
      },
    });
    await auth.bootstrap(true);

    await auth.logoutCurrentDevice();

    expect(clearCalls).toBe(1);
    expect(auth.getAccessCredential()).toBeNull();
    expect(auth.getState().status).toBe("locked-pending-revoke");
    expect(auth.beginWechatLogin()).toBeNull();
    expect(storage.getItem(draftKey)).toBeNull();
    expect(storage.getItem(AUTH_SESSION_STORAGE_KEYS.active)).toBeNull();
    expect(storage.getItem(AUTH_SESSION_STORAGE_KEYS.pendingRevoke)).toContain(
      session.refreshToken,
    );

    const pendingBefore = storage.getItem(AUTH_SESSION_STORAGE_KEYS.pendingRevoke);
    await auth.logoutCurrentDevice();
    expect(auth.getState().status).toBe("locked-pending-revoke");
    expect(storage.getItem(AUTH_SESSION_STORAGE_KEYS.pendingRevoke)).toBe(
      pendingBefore,
    );
    expect(fake.calls.revoke).toBe(1);

    await auth.retryPendingRevoke();

    expect(fake.calls.revoke).toBe(2);
    expect(auth.getState().status).toBe("safely-signed-out");
    expect(storage.getItem(AUTH_SESSION_STORAGE_KEYS.pendingRevoke)).toBeNull();
  });

  it("本机清理无法确认时失败关闭，不能登录第二账号或宣称安全退出", async () => {
    const storage = createMemoryStorage();
    await seedActiveSession(storage);
    const fake = adapter();
    const auth = createAuthSession({
      storage,
      adapter: fake.value,
      now: () => NOW,
      lockAndClearWorkspace: () => false,
    });
    await auth.bootstrap(true);

    await auth.logoutCurrentDevice();

    expect(auth.getState().status).toBe("locked-cleanup");
    expect(auth.beginWechatLogin()).toBeNull();
    expect(fake.calls.revoke).toBe(0);
  });

  it("生产 wx 存储读取失败时 bootstrap 锁定清理，不伪装成无凭据", async () => {
    vi.stubGlobal("wx", {
      getStorageSync() {
        throw new Error("simulated wx storage outage");
      },
      setStorageSync() {},
      removeStorageSync() {},
      getStorageInfoSync() {
        return { keys: [] };
      },
    });
    const fake = adapter();
    const auth = createAuthSession({
      storage: createWxStorage(),
      adapter: fake.value,
      now: () => NOW,
    });

    await auth.bootstrap(true);

    expect(auth.getState().status).toBe("locked-cleanup");
    expect(auth.beginWechatLogin()).toBeNull();
    expect(fake.calls.refresh).toBe(0);
  });

  it("rotation unknown 后退出会持久锁定，并可在重启后仅重认证完成撤销", async () => {
    const storage = createMemoryStorage();
    await seedActiveSession(storage);
    const unknownAdapter = adapter({
      rotateRefresh: async () => {
        unknownAdapter.calls.refresh += 1;
        return { ok: false, kind: "unknown-result" };
      },
    });
    const first = createAuthSession({
      storage,
      adapter: unknownAdapter.value,
      now: () => NOW,
    });
    await first.bootstrap(true);
    expect(first.getState().status).toBe("rotation-unknown");

    await first.logoutCurrentDevice();
    expect(first.getState().status).toBe("locked-revoke-reauth");
    expect(storage.getItem(AUTH_SESSION_STORAGE_KEYS.active)).toContain(
      "logout-revoke-reauth",
    );
    expect(first.beginWechatLogin()).toBeNull();

    const recoveryAdapter = adapter();
    const restarted = createAuthSession({
      storage,
      adapter: recoveryAdapter.value,
      now: () => NOW,
    });
    await restarted.bootstrap(true);
    expect(restarted.getState().status).toBe("locked-revoke-reauth");
    const reauth = restarted.beginRevokeReauth();
    expect(reauth).not.toBeNull();

    await restarted.completeRevokeReauth(reauth!, revokeAuthorization());

    expect(recoveryAdapter.calls.reauthRevoke).toBe(1);
    expect(restarted.getState().status).toBe("safely-signed-out");
    expect(restarted.getAccessCredential()).toBeNull();
    expect(storage.getItem(AUTH_SESSION_STORAGE_KEYS.active)).toBeNull();
    expect(storedText(storage)).not.toContain(opaque("revoke-proof"));
  });

  it("仅撤销重认证必须是原账号，错 scope 不调用撤销也不解锁", async () => {
    const storage = createMemoryStorage();
    await seedActiveSession(storage);
    const unknownAdapter = adapter({
      rotateRefresh: async () => ({ ok: false, kind: "unknown-result" }),
    });
    const first = createAuthSession({
      storage,
      adapter: unknownAdapter.value,
      now: () => NOW,
    });
    await first.bootstrap(true);
    await first.logoutCurrentDevice();

    const recoveryAdapter = adapter();
    const restarted = createAuthSession({
      storage,
      adapter: recoveryAdapter.value,
      now: () => NOW,
    });
    await restarted.bootstrap(true);
    const reauth = restarted.beginRevokeReauth();
    await restarted.completeRevokeReauth(
      reauth!,
      revokeAuthorization({ accountScope: SCOPE_B }),
    );

    expect(recoveryAdapter.calls.reauthRevoke).toBe(0);
    expect(restarted.getState()).toMatchObject({
      status: "locked-revoke-reauth",
      reason: "identity-mismatch",
      accountScope: SCOPE_A,
    });
    expect(storage.getItem(AUTH_SESSION_STORAGE_KEYS.active)).toContain(
      "logout-revoke-reauth",
    );
  });

  it("revoke transport 抛异常时保留只可撤销的凭据并锁定账号切换", async () => {
    const storage = createMemoryStorage();
    const session = issued();
    await seedActiveSession(storage, session);
    const fake = adapter({
      revokeDevice: async () => {
        fake.calls.revoke += 1;
        throw new Error("simulated revoke disconnect");
      },
    });
    const auth = createAuthSession({ storage, adapter: fake.value, now: () => NOW });
    await auth.bootstrap(true);

    await expect(auth.logoutCurrentDevice()).resolves.toMatchObject({
      status: "locked-pending-revoke",
    });
    expect(auth.beginWechatLogin()).toBeNull();
    expect(storage.getItem(AUTH_SESSION_STORAGE_KEYS.pendingRevoke)).toContain(
      session.refreshToken,
    );
  });

  it("退出在写入凭据后被杀，新实例先清工作区并保持待撤销锁", async () => {
    const storage = createMemoryStorage();
    await seedActiveSession(storage);
    const revoke = deferred<RevokeDeviceResult>();
    const firstAdapter = adapter({
      revokeDevice: async () => {
        firstAdapter.calls.revoke += 1;
        return revoke.promise;
      },
    });
    const first = createAuthSession({
      storage,
      adapter: firstAdapter.value,
      now: () => NOW,
    });
    await first.bootstrap(true);
    const abandoned = first.logoutCurrentDevice();
    await Promise.resolve();
    expect(storage.getItem(AUTH_SESSION_STORAGE_KEYS.pendingRevoke)).not.toBeNull();

    let cleared = 0;
    const secondAdapter = adapter();
    const restarted = createAuthSession({
      storage,
      adapter: secondAdapter.value,
      now: () => NOW,
      lockAndClearWorkspace: () => {
        cleared += 1;
        return true;
      },
    });
    await restarted.bootstrap(true);

    expect(cleared).toBe(1);
    expect(restarted.getState().status).toBe("locked-pending-revoke");
    expect(secondAdapter.calls.refresh).toBe(0);
    revoke.resolve({ ok: false, kind: "unknown-result" });
    await abandoned;
  });

  it("迟到的微信登录结果在退出后失效，不能重新写入凭据", async () => {
    const storage = createMemoryStorage();
    const fake = adapter();
    const auth = createAuthSession({ storage, adapter: fake.value, now: () => NOW });
    await auth.bootstrap(true);
    const attempt = auth.beginWechatLogin();

    await auth.logoutCurrentDevice();

    expect(auth.completeWechatLogin(attempt!, issued())).toBe(false);
    expect(auth.getState().status).toBe("safely-signed-out");
    expect(storage.getItem(AUTH_SESSION_STORAGE_KEYS.active)).toBeNull();
  });

  it("退出期间迟到的 refresh 结果不能重建 token 或持久凭据", async () => {
    const storage = createMemoryStorage();
    await seedActiveSession(storage);
    const rotation = deferred<RefreshRotationResult>();
    const fake = adapter({
      rotateRefresh: async () => {
        fake.calls.refresh += 1;
        return rotation.promise;
      },
    });
    const auth = createAuthSession({ storage, adapter: fake.value, now: () => NOW });
    const refreshing = auth.bootstrap(true);
    await Promise.resolve();

    await auth.logoutCurrentDevice();
    expect(auth.getState().status).toBe("safely-signed-out");
    rotation.resolve({ ok: true, session: fake.next });
    await refreshing;

    expect(auth.getState().status).toBe("safely-signed-out");
    expect(auth.getAccessCredential()).toBeNull();
    expect(storedText(storage)).not.toContain(fake.next.refreshToken);
  });
});
