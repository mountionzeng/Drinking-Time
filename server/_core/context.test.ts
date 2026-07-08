import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../../drizzle/schema";

const verifySession = vi.fn();
const authenticateRequest = vi.fn();
const createSessionToken = vi.fn();
const upsertUser = vi.fn();
const getUserByOpenId = vi.fn();
const getSessionCookieOptions = vi.fn(() => ({
  httpOnly: true,
  path: "/",
  sameSite: "lax" as const,
  secure: false,
}));

vi.mock("./sdk", () => ({
  sdk: {
    verifySession,
    authenticateRequest,
    createSessionToken,
  },
}));

vi.mock("../db", () => ({
  upsertUser,
  getUserByOpenId,
}));

vi.mock("./cookies", () => ({
  getSessionCookieOptions,
}));

function makeUser(overrides: Partial<User> = {}): User {
  const now = new Date("2026-07-01T00:00:00.000Z");
  return {
    id: 7,
    openId: "guest:sample",
    name: "Guest",
    email: null,
    loginMethod: "guest",
    role: "user",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
    ...overrides,
  };
}

describe("createContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.DISABLE_AUTH = "true";
    process.env.NODE_ENV = "production";
    delete process.env.DEV_FIXED_GUEST_OPEN_ID;
  });

  it("creates a browser-scoped guest session when auth is disabled", async () => {
    verifySession.mockResolvedValue(null);
    createSessionToken.mockResolvedValue("guest-session-token");
    getUserByOpenId.mockResolvedValue(
      makeUser({ openId: "guest:test-browser" }),
    );

    const { createContext } = await import("./context");

    const cookieCalls: Array<{ name: string; value: string }> = [];
    const ctx = await createContext({
      req: {
        headers: {},
      } as any,
      res: {
        cookie: (name: string, value: string) => {
          cookieCalls.push({ name, value });
        },
      } as any,
    });

    expect(createSessionToken).toHaveBeenCalledTimes(1);
    expect(upsertUser).toHaveBeenCalledWith(
      expect.objectContaining({
        openId: expect.stringMatching(/^guest:/),
        loginMethod: "guest",
        name: "Guest",
      }),
    );
    expect(cookieCalls).toEqual([
      { name: "app_session_id", value: "guest-session-token" },
    ]);
    expect(ctx.user?.openId).toBe("guest:test-browser");
  });

  it("reuses a signed-in real user when an auth session already exists", async () => {
    const realUser = makeUser({
      id: 99,
      openId: "google:real-user",
      name: "Real User",
      loginMethod: "google",
      email: "real@example.com",
    });
    verifySession.mockResolvedValue({
      openId: "google:real-user",
      appId: "app-id",
      name: "Real User",
    });
    authenticateRequest.mockResolvedValue(realUser);

    const { createContext } = await import("./context");

    const cookieCalls: Array<{ name: string; value: string }> = [];
    const ctx = await createContext({
      req: {
        headers: { cookie: "app_session_id=real-cookie" },
      } as any,
      res: {
        cookie: (name: string, value: string) => {
          cookieCalls.push({ name, value });
        },
      } as any,
    });

    expect(authenticateRequest).toHaveBeenCalledTimes(1);
    expect(createSessionToken).not.toHaveBeenCalled();
    expect(cookieCalls).toHaveLength(0);
    expect(ctx.user).toEqual(realUser);
  });

  it("upgrades a legacy local-guest session into a browser-scoped guest", async () => {
    verifySession.mockResolvedValue({
      openId: "local-guest",
      appId: "app-id",
      name: "Local Guest",
    });
    createSessionToken.mockResolvedValue("upgraded-guest-session-token");
    getUserByOpenId.mockResolvedValue(
      makeUser({ openId: "guest:upgraded-browser" }),
    );

    const { createContext } = await import("./context");

    const cookieCalls: Array<{ name: string; value: string }> = [];
    const ctx = await createContext({
      req: {
        headers: { cookie: "app_session_id=legacy-cookie" },
      } as any,
      res: {
        cookie: (name: string, value: string) => {
          cookieCalls.push({ name, value });
        },
      } as any,
    });

    expect(createSessionToken).toHaveBeenCalledTimes(1);
    expect(upsertUser).toHaveBeenCalledWith(
      expect.objectContaining({
        openId: expect.stringMatching(/^guest:/),
      }),
    );
    expect(cookieCalls).toEqual([
      { name: "app_session_id", value: "upgraded-guest-session-token" },
    ]);
    expect(ctx.user?.openId).toBe("guest:upgraded-browser");
  });

  describe("DEV_FIXED_GUEST_OPEN_ID 固定身份", () => {
    const FIXED_OPEN_ID = "guest:fixed-dev-user";

    it("无 cookie 请求解析成固定身份，并按固定 openId 签发 cookie", async () => {
      process.env.DEV_FIXED_GUEST_OPEN_ID = FIXED_OPEN_ID;
      verifySession.mockResolvedValue(null);
      createSessionToken.mockResolvedValue("fixed-session-token");
      getUserByOpenId.mockResolvedValue(makeUser({ openId: FIXED_OPEN_ID }));

      const { createContext } = await import("./context");

      const cookieCalls: Array<{ name: string; value: string }> = [];
      const ctx = await createContext({
        req: {
          headers: {},
        } as any,
        res: {
          cookie: (name: string, value: string) => {
            cookieCalls.push({ name, value });
          },
        } as any,
      });

      expect(createSessionToken).toHaveBeenCalledTimes(1);
      expect(createSessionToken).toHaveBeenCalledWith(
        FIXED_OPEN_ID,
        expect.objectContaining({ name: "Guest" }),
      );
      expect(upsertUser).toHaveBeenCalledWith(
        expect.objectContaining({ openId: FIXED_OPEN_ID }),
      );
      expect(cookieCalls).toEqual([
        { name: "app_session_id", value: "fixed-session-token" },
      ]);
      expect(ctx.user?.openId).toBe(FIXED_OPEN_ID);
    });

    it("带着别的访客 cookie 也收敛到固定身份并重签 cookie", async () => {
      process.env.DEV_FIXED_GUEST_OPEN_ID = FIXED_OPEN_ID;
      verifySession.mockResolvedValue({
        openId: "guest:some-other-browser",
        appId: "app-id",
        name: "Guest",
      });
      createSessionToken.mockResolvedValue("fixed-session-token");
      getUserByOpenId.mockResolvedValue(makeUser({ openId: FIXED_OPEN_ID }));

      const { createContext } = await import("./context");

      const cookieCalls: Array<{ name: string; value: string }> = [];
      const ctx = await createContext({
        req: {
          headers: { cookie: "app_session_id=stray-guest-cookie" },
        } as any,
        res: {
          cookie: (name: string, value: string) => {
            cookieCalls.push({ name, value });
          },
        } as any,
      });

      expect(createSessionToken).toHaveBeenCalledWith(
        FIXED_OPEN_ID,
        expect.objectContaining({ name: "Guest" }),
      );
      expect(cookieCalls).toEqual([
        { name: "app_session_id", value: "fixed-session-token" },
      ]);
      expect(ctx.user?.openId).toBe(FIXED_OPEN_ID);
    });

    it("cookie 已指向固定身份时直接复用，不重复签发", async () => {
      process.env.DEV_FIXED_GUEST_OPEN_ID = FIXED_OPEN_ID;
      verifySession.mockResolvedValue({
        openId: FIXED_OPEN_ID,
        appId: "app-id",
        name: "Guest",
      });
      getUserByOpenId.mockResolvedValue(makeUser({ openId: FIXED_OPEN_ID }));

      const { createContext } = await import("./context");

      const cookieCalls: Array<{ name: string; value: string }> = [];
      const ctx = await createContext({
        req: {
          headers: { cookie: "app_session_id=fixed-cookie" },
        } as any,
        res: {
          cookie: (name: string, value: string) => {
            cookieCalls.push({ name, value });
          },
        } as any,
      });

      expect(createSessionToken).not.toHaveBeenCalled();
      expect(cookieCalls).toHaveLength(0);
      expect(upsertUser).toHaveBeenCalledWith(
        expect.objectContaining({ openId: FIXED_OPEN_ID }),
      );
      expect(ctx.user?.openId).toBe(FIXED_OPEN_ID);
    });
  });
});
