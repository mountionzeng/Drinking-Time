import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { TrpcContext } from "./_core/context";
import { resetMemoryStateForTesting } from "./db";
import { appRouter } from "./routers";
import { utcCalendarDayBounds } from "./routers/chapterDelivery";

function context(userId: number | null): TrpcContext {
  return {
    user: userId ? {
      id: userId, openId: `chapter-delivery-${userId}`, email: null, name: "测试作者",
      loginMethod: "test", role: "user", sessionVersion: 0, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } : null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("chapterDelivery router gates", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("CHAPTER_PACKAGE_ENABLED", "true");
    vi.stubEnv("CHAPTER_DELIVERY_ENABLED", "false");
    resetMemoryStateForTesting();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("uses UTC calendar-day boundaries for the per-account delivery quota", () => {
    expect(utcCalendarDayBounds(new Date("2026-10-24T23:59:59.999Z"))).toEqual({
      since: new Date("2026-10-24T00:00:00.000Z"),
      until: new Date("2026-10-25T00:00:00.000Z"),
    });
    expect(utcCalendarDayBounds(new Date("2026-10-25T00:00:00.000Z"))).toEqual({
      since: new Date("2026-10-25T00:00:00.000Z"),
      until: new Date("2026-10-26T00:00:00.000Z"),
    });
  });

  it("requires both chapter and delivery switches and rejects anonymous callers", async () => {
    await expect(appRouter.createCaller(context(null)).chapterDelivery.inbox())
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(appRouter.createCaller(context(17)).chapterDelivery.inbox())
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(appRouter.createCaller(context(17)).chapterDelivery.contacts())
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    vi.stubEnv("CHAPTER_PACKAGE_ENABLED", "false");
    vi.stubEnv("CHAPTER_DELIVERY_ENABLED", "true");
    await expect(appRouter.createCaller(context(17)).chapterDelivery.inbox())
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("does not let a caller target an account outside established story contacts", async () => {
    vi.stubEnv("CHAPTER_DELIVERY_ENABLED", "true");
    await expect(appRouter.createCaller(context(17)).chapterDelivery.send({
      package: {}, recipientContactId: "x".repeat(43), requestId: "b5472c85-3caa-4b45-b5f1-0f1488043899",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("creates a claim link, assigns it to one account, and exposes only the safe package projection", async () => {
    vi.stubEnv("CHAPTER_DELIVERY_ENABLED", "true");
    const caller = appRouter.createCaller(context(17));
    const pkg = JSON.parse(readFileSync(new URL("../tests/fixtures/chapter-package/valid-01-text-only.json", import.meta.url), "utf8"));
    const created = await caller.chapterDelivery.createClaimLink({ package: pkg, requestId: "49158c72-8522-4cc2-a813-a2fb6742be3c" });
    expect(created.claimUrl).toMatch(/^\/chapter\/claim\/[\w-]{43}$/);
    const token = created.claimUrl!.split("/").at(-1)!;
    await expect(caller.chapterDelivery.claim({ token })).resolves.toEqual({ deliveryId: created.deliveryId });
    await expect(caller.chapterDelivery.claim({ token })).resolves.toEqual({ deliveryId: created.deliveryId });
    const read = await caller.chapterDelivery.read({ deliveryId: created.deliveryId });
    expect(read.package.sender).toEqual({ platform: "web", displayName: "测试作者" });
    expect(read.delivery).not.toHaveProperty("senderUserId");
    expect(read.delivery).not.toHaveProperty("claimTokenHash");
    await expect(caller.chapterDelivery.resolve({ deliveryId: created.deliveryId, status: "kept" }))
      .resolves.toEqual({ status: "kept" });
  });

  it("limits new sends to 20 per UTC day but allows an idempotent retry at the limit", async () => {
    vi.stubEnv("CHAPTER_DELIVERY_ENABLED", "true");
    const caller = appRouter.createCaller(context(29));
    const pkg = JSON.parse(readFileSync(new URL("../tests/fixtures/chapter-package/valid-01-text-only.json", import.meta.url), "utf8"));
    const requestIds = Array.from({ length: 20 }, (_, index) =>
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
    );
    for (const [index, requestId] of requestIds.entries()) {
      await caller.chapterDelivery.createClaimLink({
        package: { ...pkg, packageId: `cp_quota-${String(index).padStart(8, "0")}` }, requestId,
      });
    }
    const lastPackage = { ...pkg, packageId: "cp_quota-00000019" };
    await expect(caller.chapterDelivery.createClaimLink({ package: lastPackage, requestId: requestIds[19] }))
      .resolves.toMatchObject({ repeated: true });
    await expect(caller.chapterDelivery.createClaimLink({
      package: { ...pkg, packageId: "cp_quota-over" }, requestId: "00000000-0000-4000-8000-000000000021",
    })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});
