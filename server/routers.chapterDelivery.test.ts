import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { TrpcContext } from "./_core/context";
import { resetMemoryStateForTesting } from "./db";
import { appRouter } from "./routers";

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
});
