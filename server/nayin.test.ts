import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Helper to create a public (unauthenticated) context for testing public procedures
function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

describe("nayin.today", () => {
  it("returns valid nayin element for today", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.nayin.today();

    expect(result).toBeDefined();
    expect(result.element).toBeDefined();
    expect(["metal", "wood", "water", "fire", "earth"]).toContain(result.element);
    expect(result.ganzhi).toBeDefined();
    expect(result.ganzhi.length).toBe(2);
    expect(result.stem).toBeDefined();
    expect(result.branch).toBeDefined();
  });

  it("returns correct nayin for a known date (2000-01-07 = 甲子 = 海中金/metal)", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    // 2000-01-07 is our reference date: 甲子日 (海中金)
    const result = await caller.nayin.today({ date: "2000-01-07" });

    expect(result.ganzhi).toBe("甲子");
    expect(result.stem).toBe("甲");
    expect(result.branch).toBe("子");
    expect(result.element).toBe("metal");
  });

  it("returns correct nayin for 2000-01-08 = 乙丑 = metal", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.nayin.today({ date: "2000-01-08" });

    expect(result.ganzhi).toBe("乙丑");
    expect(result.stem).toBe("乙");
    expect(result.branch).toBe("丑");
    // 乙丑 = 海中金
    expect(result.element).toBe("metal");
  });

  it("returns correct nayin for 2000-01-09 = 丙寅 = fire", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.nayin.today({ date: "2000-01-09" });

    expect(result.ganzhi).toBe("丙寅");
    expect(result.stem).toBe("丙");
    expect(result.branch).toBe("寅");
    // 丙寅 = 炉中火
    expect(result.element).toBe("fire");
  });

  it("returns earth for 2026-03-27 (庚子 = 壁上土)", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.nayin.today({ date: "2026-03-27" });

    expect(result.ganzhi).toBe("庚子");
    expect(result.element).toBe("earth");
  });

  it("handles different dates consistently", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    // Call twice with same date should return same result
    const result1 = await caller.nayin.today({ date: "2026-03-26" });
    const result2 = await caller.nayin.today({ date: "2026-03-26" });

    expect(result1).toEqual(result2);
  });

  it("returns different results for consecutive dates", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result1 = await caller.nayin.today({ date: "2026-03-26" });
    const result2 = await caller.nayin.today({ date: "2026-03-27" });

    // Consecutive days should have different ganzhi
    expect(result1.ganzhi).not.toBe(result2.ganzhi);
  });
});

describe("auth.me (public)", () => {
  it("returns null for unauthenticated users", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.me();
    expect(result).toBeNull();
  });
});
