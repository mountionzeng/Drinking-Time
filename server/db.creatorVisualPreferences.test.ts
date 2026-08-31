import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});

const previousDatabaseUrl = process.env.DATABASE_URL;
const previousLocalPersistPath = process.env.LOCAL_PERSIST_PATH;
const tempDir = await mkdtemp(path.join(os.tmpdir(), "dt-creator-visual-pref-"));
process.env.DATABASE_URL = "";
process.env.LOCAL_PERSIST_PATH = path.join(tempDir, "local-persist.json");

const fs = await import("node:fs/promises");
let db = await import("./db");

describe("creator visual preference persistence", () => {
  beforeEach(() => {
    db.resetMemoryStateForTesting();
  });

  afterEach(() => {
    vi.mocked(fs.writeFile).mockClear();
  });

  afterAll(async () => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousLocalPersistPath === undefined) delete process.env.LOCAL_PERSIST_PATH;
    else process.env.LOCAL_PERSIST_PATH = previousLocalPersistPath;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates one owner-scoped row and enforces revision CAS", async () => {
    const created = await db.writeCreatorVisualPreferenceIfRevision({
      userId: 41,
      seasonalProfile: "northern_four_seasons",
      timeZone: "Asia/Shanghai",
      source: "browser_confirmed",
      expectedRevision: 0,
    });
    expect(created).toMatchObject({ userId: 41, revision: 1 });
    expect(await db.getCreatorVisualPreference(42)).toBeNull();
    expect(
      await db.writeCreatorVisualPreferenceIfRevision({
        userId: 41,
        seasonalProfile: "southern_four_seasons",
        timeZone: "Australia/Sydney",
        source: "manual",
        expectedRevision: 0,
      })
    ).toBeNull();

    const updated = await db.writeCreatorVisualPreferenceIfRevision({
      userId: 41,
      seasonalProfile: "southern_four_seasons",
      timeZone: "Australia/Sydney",
      source: "manual",
      expectedRevision: 1,
    });
    expect(updated).toMatchObject({
      seasonalProfile: "southern_four_seasons",
      revision: 2,
    });
  });

  it("persists across reload and clear increments revision", async () => {
    await db.writeCreatorVisualPreferenceIfRevision({
      userId: 51,
      seasonalProfile: "northern_four_seasons",
      timeZone: "Asia/Shanghai",
      source: "manual",
      expectedRevision: 0,
    });
    vi.resetModules();
    db = await import("./db");
    expect(await db.getCreatorVisualPreference(51)).toMatchObject({ revision: 1 });

    const cleared = await db.clearCreatorVisualPreferenceIfRevision({
      userId: 51,
      expectedRevision: 1,
    });
    expect(cleared).toMatchObject({
      seasonalProfile: "unknown",
      timeZone: null,
      source: "cleared",
      revision: 2,
    });
  });

  it("rolls local memory back when atomic persistence fails", async () => {
    await db.writeCreatorVisualPreferenceIfRevision({
      userId: 61,
      seasonalProfile: "northern_four_seasons",
      timeZone: "Asia/Shanghai",
      source: "manual",
      expectedRevision: 0,
    });
    vi.mocked(fs.writeFile).mockRejectedValueOnce(new Error("disk full"));

    await expect(
      db.writeCreatorVisualPreferenceIfRevision({
        userId: 61,
        seasonalProfile: "southern_four_seasons",
        timeZone: "Australia/Sydney",
        source: "manual",
        expectedRevision: 1,
      })
    ).rejects.toMatchObject({ name: "LocalPersistenceWriteError" });
    expect(await db.getCreatorVisualPreference(61)).toMatchObject({
      seasonalProfile: "northern_four_seasons",
      revision: 1,
    });
  });

  it("deletes on account lifecycle and reassigns only during merge", async () => {
    await db.writeCreatorVisualPreferenceIfRevision({
      userId: 71,
      seasonalProfile: "northern_four_seasons",
      timeZone: null,
      source: "manual",
      expectedRevision: 0,
    });
    expect(
      await db.reassignCreatorVisualPreference({
        sourceUserId: 71,
        targetUserId: 72,
      })
    ).toMatchObject({ userId: 72, seasonalProfile: "northern_four_seasons" });
    expect(await db.getCreatorVisualPreference(71)).toBeNull();

    await db.deleteCreatorVisualPreferenceForUser(72);
    expect(await db.getCreatorVisualPreference(72)).toBeNull();
  });

  it("keeps an existing target preference during account merge", async () => {
    await db.writeCreatorVisualPreferenceIfRevision({
      userId: 81,
      seasonalProfile: "northern_four_seasons",
      timeZone: null,
      source: "manual",
      expectedRevision: 0,
    });
    await db.writeCreatorVisualPreferenceIfRevision({
      userId: 82,
      seasonalProfile: "tropical_or_non_four_season",
      timeZone: null,
      source: "manual",
      expectedRevision: 0,
    });
    expect(
      await db.reassignCreatorVisualPreference({
        sourceUserId: 81,
        targetUserId: 82,
      })
    ).toMatchObject({ seasonalProfile: "tropical_or_non_four_season" });
    expect(await db.getCreatorVisualPreference(81)).toBeNull();
  });
});
