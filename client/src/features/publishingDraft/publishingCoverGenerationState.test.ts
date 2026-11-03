import { describe, expect, it } from "vitest";
import {
  claimAutoCoverRecoveryAttempt,
  MAX_AUTO_COVER_RECOVERY_ATTEMPTS,
  getCoverGenerationPresentation,
  shouldRecoverCoverGeneration,
} from "./publishingCoverGenerationState";
import {
  isPublishingCoverGenerationExpired,
  PUBLISHING_COVER_ABSOLUTE_LIMIT_MS,
} from "@shared/publishingDraft";

describe("getCoverGenerationPresentation", () => {
  it("only marks the fresh action as loading when creating a new round", () => {
    expect(getCoverGenerationPresentation("fresh")).toMatchObject({
      freshLoading: true,
      reviseLoading: false,
    });
  });

  it("only marks the revision action as loading when revising a candidate", () => {
    expect(getCoverGenerationPresentation("revise")).toMatchObject({
      freshLoading: false,
      reviseLoading: true,
    });
  });

  it("has no loading state once a request has settled", () => {
    expect(getCoverGenerationPresentation(null)).toEqual({
      freshLoading: false,
      reviseLoading: false,
      message: null,
    });
  });
});

describe("shouldRecoverCoverGeneration", () => {
  const generation = {
    operationToken: "cover-op-1",
    versionId: "v1",
    status: "failed" as const,
    platform: "xiaohongshu" as const,
    referenceAssetId: null,
    feedback: "",
    prompt: "durable prompt",
    roundId: "round-1",
    taskId: "302-task-1",
    claimedAt: Date.now() - 60_000,
    updatedAt: Date.now() - 30_000,
    expiresAt: Date.now() - 1,
    error: "302 Midjourney task timeout",
  };

  it("stops recovering once the round is 24 h past its first claim", () => {
    const claimedAt = Date.now() - PUBLISHING_COVER_ABSOLUTE_LIMIT_MS - 1;
    for (const status of ["pending", "failed", "unknown"] as const) {
      const stale = { ...generation, status, claimedAt };
      expect(isPublishingCoverGenerationExpired(stale)).toBe(true);
      expect(shouldRecoverCoverGeneration(stale)).toBe(false);
    }
    expect(
      isPublishingCoverGenerationExpired({ ...generation, status: "completed", claimedAt })
    ).toBe(false);
    // Moving expiresAt forward (an old resume) never revives an expired round.
    expect(
      shouldRecoverCoverGeneration({
        ...generation,
        status: "pending",
        claimedAt,
        expiresAt: Date.now() + 3_600_000,
      })
    ).toBe(false);
  });

  it("keeps the limit absolute from claimedAt, just inside the window", () => {
    const now = 10 * PUBLISHING_COVER_ABSOLUTE_LIMIT_MS;
    const g = { ...generation, claimedAt: now - PUBLISHING_COVER_ABSOLUTE_LIMIT_MS + 1 };
    expect(isPublishingCoverGenerationExpired(g, now)).toBe(false);
    expect(isPublishingCoverGenerationExpired(g, now + 1)).toBe(true);
  });

  it("recovers an accepted paid task after a transient network failure", () => {
    expect(shouldRecoverCoverGeneration(generation)).toBe(true);
  });

  it("recovers a round the pixel gate quarantined, since it was still billed", () => {
    expect(
      shouldRecoverCoverGeneration({
        ...generation,
        error:
          "本轮 4 张均检测到文字、Logo、账号或水印，已全部隔离且不会自动重新出图或再次扣费。",
      })
    ).toBe(true);
  });

  it("recovers a socket termination, the failure 302 drops mid-download", () => {
    // undici's bare message, as persisted before the cause was carried through.
    expect(
      shouldRecoverCoverGeneration({ ...generation, error: "terminated" })
    ).toBe(true);
    expect(
      shouldRecoverCoverGeneration({
        ...generation,
        error: "terminated（SocketError: other side closed）",
      })
    ).toBe(true);
  });

  it("does not recover a provider rejection or a request without a task id", () => {
    expect(
      shouldRecoverCoverGeneration({
        ...generation,
        error: "prompt rejected by provider",
      })
    ).toBe(false);
    expect(shouldRecoverCoverGeneration({ ...generation, taskId: null })).toBe(
      false
    );
  });
});

describe("claimAutoCoverRecoveryAttempt", () => {
  const memoryStore = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  };
  it("caps automatic recovery per operation token across remounts", () => {
    const store = memoryStore();
    const results = Array.from({ length: MAX_AUTO_COVER_RECOVERY_ATTEMPTS + 2 }, () =>
      claimAutoCoverRecoveryAttempt("cover-a", store)
    );
    expect(results.filter(Boolean)).toHaveLength(MAX_AUTO_COVER_RECOVERY_ATTEMPTS);
    expect(results.at(-1)).toBe(false);
    expect(claimAutoCoverRecoveryAttempt("cover-b", store)).toBe(true);
  });
  it("still allows recovery when storage is unavailable", () => {
    expect(claimAutoCoverRecoveryAttempt("cover-x", null)).toBe(true);
  });
});
