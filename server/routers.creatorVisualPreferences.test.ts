import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { TrpcContext } from "./_core/context";

const previousDatabaseUrl = process.env.DATABASE_URL;
const previousLocalPersistPath = process.env.LOCAL_PERSIST_PATH;
const tempDir = await mkdtemp(path.join(os.tmpdir(), "dt-creator-pref-router-"));
process.env.DATABASE_URL = "";
process.env.LOCAL_PERSIST_PATH = path.join(tempDir, "local-persist.json");

const db = await import("./db");
const { creatorVisualPreferencesRouter } = await import(
  "./routers/creatorVisualPreferences"
);

function context(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `creator-pref-${userId}`,
      email: `creator-pref-${userId}@example.com`,
      name: `Creator ${userId}`,
      loginMethod: "test",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

describe("creatorVisualPreferences router", () => {
  beforeEach(() => db.resetMemoryStateForTesting());

  afterAll(async () => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousLocalPersistPath === undefined) delete process.env.LOCAL_PERSIST_PATH;
    else process.env.LOCAL_PERSIST_PATH = previousLocalPersistPath;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("starts unknown and scopes every read/write to the authenticated owner", async () => {
    const owner = creatorVisualPreferencesRouter.createCaller(context(91));
    const other = creatorVisualPreferencesRouter.createCaller(context(92));
    await expect(owner.read()).resolves.toMatchObject({
      seasonalProfile: "unknown",
      revision: 0,
      saved: false,
    });
    await owner.save({
      expectedRevision: 0,
      seasonalProfile: "northern_four_seasons",
      timeZone: "Asia/Shanghai",
      source: "browser_confirmed",
    });
    await expect(other.read()).resolves.toMatchObject({
      seasonalProfile: "unknown",
      saved: false,
    });
  });

  it("rejects invalid zones and stale revisions", async () => {
    const caller = creatorVisualPreferencesRouter.createCaller(context(93));
    await expect(
      caller.save({
        expectedRevision: 0,
        seasonalProfile: "northern_four_seasons",
        timeZone: "Mars/Olympus",
        source: "manual",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await caller.save({
      expectedRevision: 0,
      seasonalProfile: "northern_four_seasons",
      timeZone: null,
      source: "manual",
    });
    await expect(
      caller.save({
        expectedRevision: 0,
        seasonalProfile: "southern_four_seasons",
        timeZone: null,
        source: "manual",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("clears to explicit unknown and increments revision", async () => {
    const caller = creatorVisualPreferencesRouter.createCaller(context(94));
    await caller.save({
      expectedRevision: 0,
      seasonalProfile: "southern_four_seasons",
      timeZone: "Australia/Sydney",
      source: "manual",
    });
    await expect(caller.clear({ expectedRevision: 1 })).resolves.toMatchObject({
      seasonalProfile: "unknown",
      timeZone: null,
      source: "cleared",
      revision: 2,
      saved: true,
    });
  });
});
