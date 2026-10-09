import { readFile, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

// Persisted field names from the pre-refactor format, independent of the registry.
const legacyCollections = [
  ["user", "users"],
  ["accessSession", "accessSessions"],
  ["project", "projects"],
  ["reference", "references"],
  ["shot", "shots"],
  ["analysisResult", "analysisResults"],
  ["emotionAnalysisProfile", "emotionAnalysisProfiles"],
  ["emotionDailyLetter", "emotionDailyLetters"],
  ["story", "stories"],
  ["storySoundWorkspace", "storySoundWorkspaces"],
  ["storySoundPlanVersion", "storySoundPlanVersions"],
  ["storySoundRowOperation", "storySoundRowOperations"],
  ["storyVoiceProfile", "storyVoiceProfiles"],
  ["storyVoiceActivationOperation", "storyVoiceActivationOperations"],
  ["editSnapshot", "editSnapshots"],
  ["semanticAnnotation", "semanticAnnotations"],
  ["generatedImage", "generatedImages"],
  ["previewMaskedImageOperation", "previewMaskedImageOperations"],
  ["timelineFrameExtractionOperation", "timelineFrameExtractionOperations"],
  ["imageSignal", "imageSignals"],
  ["videoTake", "videoTakes"],
  ["videoTakeRange", "videoTakeRanges"],
  ["videoTimelineSelection", "videoTimelineSelections"],
  ["storyTimeline", "storyTimelines"],
  ["storyAudioAsset", "storyAudioAssets"],
  ["storyAudioImportOperation", "storyAudioImportOperations"],
  ["shotDerivationDraft", "shotDerivationDrafts"],
  ["storyOperation", "storyOperations"],
  ["inviteCode", "inviteCodes"],
  ["creditAccount", "creditAccounts"],
  ["creditLedgerEntry", "creditLedgerEntries"],
  ["creditHold", "creditHolds"],
  ["billingOperation", "billingOperations"],
  ["providerAttempt", "providerAttempts"],
  ["accountIdentity", "accountIdentities"],
  ["accountCredential", "accountCredentials"],
  ["accountVerificationChallenge", "accountVerificationChallenges"],
  ["devicePairingCode", "devicePairingCodes"],
  ["accountRateLimit", "accountRateLimits"],
] as const;

const persistPath = process.env.LOCAL_PERSIST_PATH!;
afterEach(() => vi.unstubAllEnvs());

describe("local state schema compatibility", () => {
  it("reloads phone challenges with expiration, delivery and consumption state intact", async () => {
    vi.resetModules();
    const file = persistPath + ".phone-login";
    vi.stubEnv("LOCAL_PERSIST_PATH", file);
    vi.stubEnv("DATABASE_URL", "");
    const row = { phone: "+8613800000000", challengeId: "test-challenge", codeHash: "a".repeat(64),
      expiresAt: "2026-10-09T10:05:00.000Z", sentAt: "2026-10-09T10:00:00.000Z",
      consumedAt: "2026-10-09T10:01:00.000Z", attemptCount: 2 };
    await writeFile(file, JSON.stringify({ phoneLoginChallenges: [row] }));
    const runtime = await import("./runtime");
    await runtime.ensureMemoryLoaded();
    expect(runtime.memoryState.phoneLoginChallenges[0]).toEqual({ ...row, expiresAt: new Date(row.expiresAt), sentAt: new Date(row.sentAt), consumedAt: new Date(row.consumedAt) });
    await runtime.persistMemoryState();
    expect(JSON.parse(await readFile(file, "utf8")).phoneLoginChallenges).toEqual([row]);
  });
  it("reloads share snapshots, revocation dates and import receipts from disk", async () => {
    vi.resetModules();
    const file = persistPath + ".story-sharing";
    vi.stubEnv("LOCAL_PERSIST_PATH", file);
    vi.stubEnv("DATABASE_URL", "");
    const { createStoryContextSnapshot } = await import("../services/storyContextSnapshot");
    const snapshot = createStoryContextSnapshot({ title: "分享测试", logline: null, theme: null, arc: null, summary: null, body: {} }, { includeConversation: false });
    const share = { tokenHash: "a".repeat(64), storyId: 7, userId: 8, snapshot, createdAt: "2026-10-02T10:00:00.000Z", revokedAt: "2026-10-02T11:00:00.000Z" };
    const receipt = { tokenHash: share.tokenHash, userId: 9, storyId: 10 };
    await writeFile(file, JSON.stringify({ storyContextShares: [share], storyContextShareImports: [receipt] }));
    const runtime = await import("./runtime");
    await runtime.ensureMemoryLoaded();
    expect(runtime.memoryState.storyContextShares).toEqual([{ ...share, createdAt: new Date(share.createdAt), revokedAt: new Date(share.revokedAt) }]);
    expect(runtime.memoryState.storyContextShareImports).toEqual([receipt]);
    await runtime.persistMemoryState();
    const saved = JSON.parse(await readFile(file, "utf8"));
    expect(saved.storyContextShares).toEqual([share]);
    expect(saved.storyContextShareImports).toEqual([receipt]);
  });

  it.each(["missing", "stale", "ahead"] as const)(
    "loads every legacy collection with %s counters without reusing IDs",
    async mode => {
      vi.resetModules();
      const file = persistPath + "." + mode;
      vi.stubEnv("LOCAL_PERSIST_PATH", file);
      vi.stubEnv("DATABASE_URL", "");
      const runtime = await import("./runtime");
      const stateReference = runtime.memoryState;
      const pristine = structuredClone(runtime.memoryState);
      const date = "2026-09-17T10:00:00.000Z";
      const rows = Object.fromEntries(legacyCollections.map(([, collection], index) => [
        collection,
        [{ id: 100 + index * 10, userId: 7, createdAt: date, updatedAt: date, timestamp: date,
          body: { marker: collection, cards: [], shots: [], characters: [] } }],
      ]));
      const counters = Object.fromEntries(legacyCollections.map(([key], index) => [
        key, mode === "ahead" ? 500 + index * 10 : 1,
      ]));
      await writeFile(file, JSON.stringify({
        ...rows, ...(mode === "missing" ? {} : { nextIds: counters }),
      }));

      await runtime.ensureMemoryLoaded();
      // Edit history is loaded lazily from its sidecar or the legacy fallback.
      await runtime.ensureLocalEditSnapshotsLoaded();
      await runtime.ensureLocalPromptLineageLoaded();
      expect(Object.keys(runtime.memoryState.nextIds).sort()).toEqual(
        legacyCollections.map(([key]) => key).sort()
      );
      expect(Object.keys(runtime.memoryState).filter(key =>
        Array.isArray(runtime.memoryState[key as keyof typeof runtime.memoryState])
      ).sort()).toEqual([...legacyCollections.map(([, collection]) => collection), "storyContextShares", "storyContextShareImports", "phoneLoginChallenges"].sort());

      for (const [index, [key, collection]] of legacyCollections.entries()) {
        expect(JSON.parse(JSON.stringify(runtime.memoryState[collection]))).toMatchObject(rows[collection]);
        const next = mode === "ahead" ? 500 + index * 10 : 101 + index * 10;
        expect(runtime.nextMemoryId(key)).toBe(next);
        expect(runtime.nextMemoryId(key)).toBe(next + 1);
      }
      await runtime.persistMemoryState();
      const saved = JSON.parse(await readFile(file, "utf8"));
      expect(saved.nextIds).toEqual(runtime.memoryState.nextIds);
      for (const [, collection] of legacyCollections) {
        if (collection === "editSnapshots") continue;
        expect(saved[collection]).toMatchObject(rows[collection]);
      }
      const snapshots = JSON.parse(await readFile(file + ".edit-snapshots.json", "utf8"));
      expect(snapshots).toMatchObject(rows.editSnapshots);

      runtime.resetMemoryStateForTesting();
      expect(runtime.memoryState).toBe(stateReference);
      expect(runtime.memoryState).toEqual(pristine);
      const firstReset = { ...runtime.memoryState };
      runtime.resetMemoryStateForTesting();
      for (const key of Object.keys(firstReset) as Array<keyof typeof firstReset>) {
        expect(runtime.memoryState[key]).not.toBe(firstReset[key]);
      }
    }
  );
});
