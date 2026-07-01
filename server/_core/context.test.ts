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
});
