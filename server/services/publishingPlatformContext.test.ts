import { describe, expect, it, vi } from "vitest";
import type { PlatformTrendProvider } from "./platformTrends/provider";
import { buildPublishingPlatformContextSnapshot } from "./publishingPlatformContext";

function provider(response: unknown): PlatformTrendProvider {
  return {
    manifest: {
      providerId: "authorized-fixture",
      providerLabel: "授权测试源",
      platforms: ["xiaohongshu"],
      authorization: {
        status: "contract_authorized",
        reference: "contract-2026-08",
        verifiedAt: 1_000,
      },
      sourceDocument: "https://provider.example/docs",
      parserVersion: "fixture-v1",
    },
    fetch: vi.fn().mockResolvedValue(response),
  };
}

const verifiedResponse = {
  providerId: "authorized-fixture",
  coverage: "公开话题榜",
  fetchedAt: 1_400,
  sourcePublishedAt: 1_300,
  expiresAt: 2_000,
  candidates: [
    { id: "topic-ai", label: "AI 工具", sourcePublishedAt: 1_300 },
    { id: "topic-food", label: "周末餐厅", sourcePublishedAt: 1_300 },
  ],
};

describe("publishing platform context service", () => {
  it("persists only provider candidate ids selected by the relevance boundary", async () => {
    const rankCandidateIds = vi.fn().mockResolvedValue(["topic-ai", "invented-by-model"]);
    const result = await buildPublishingPlatformContextSnapshot({
      provider: provider(verifiedResponse),
      platform: "xiaohongshu",
      versionId: "v1",
      sourceRevision: 3,
      queryText: "AI 工具如何帮助写作",
      contentTags: ["写作"],
      now: 1_500,
      rankCandidateIds,
    });

    expect(result.persistable).toBe(true);
    expect(result.snapshot.status).toBe("verified_fresh");
    expect(result.snapshot.candidates.map(candidate => candidate.id)).toEqual(["topic-ai"]);
    expect(result.snapshot.contentSuggestions).toEqual(["写作"]);
    expect(result.snapshot.rawDigest).toMatch(/^sha256-[a-f0-9]{64}$/);
    expect(result.snapshot).not.toHaveProperty("rawResponse");
  });

  it("marks an expired authorized response as stale, never realtime", async () => {
    const result = await buildPublishingPlatformContextSnapshot({
      provider: provider({ ...verifiedResponse, expiresAt: 1_450 }),
      platform: "xiaohongshu",
      versionId: "v1",
      sourceRevision: 3,
      queryText: "AI 工具",
      contentTags: [],
      now: 1_500,
      rankCandidateIds: async candidates => candidates.map(candidate => candidate.id),
    });

    expect(result.snapshot.status).toBe("verified_stale");
  });

  it("returns content suggestions without inventing realtime topics when none are relevant", async () => {
    const result = await buildPublishingPlatformContextSnapshot({
      provider: provider(verifiedResponse),
      platform: "xiaohongshu",
      versionId: "v1",
      sourceRevision: 3,
      queryText: "一段与榜单无关的私人回忆",
      contentTags: ["私人记录"],
      now: 1_500,
      rankCandidateIds: async () => [],
    });

    expect(result.snapshot.status).toBe("no_relevant");
    expect(result.snapshot.candidates).toEqual([]);
    expect(result.snapshot.contentSuggestions).toEqual(["私人记录"]);
  });

  it("creates a new immutable snapshot identity for each explicit refresh", async () => {
    const shared = {
      provider: provider(verifiedResponse),
      platform: "xiaohongshu" as const,
      versionId: "v1",
      sourceRevision: 3,
      queryText: "AI 工具",
      contentTags: [] as string[],
      rankCandidateIds: async (candidates: Array<{ id: string }>) =>
        candidates.map(candidate => candidate.id),
    };
    const first = await buildPublishingPlatformContextSnapshot({
      ...shared,
      now: 1_500,
    });
    const refreshed = await buildPublishingPlatformContextSnapshot({
      ...shared,
      now: 1_501,
    });

    expect(refreshed.snapshot.snapshotId).not.toBe(first.snapshot.snapshotId);
    expect(refreshed.snapshot.createdAt).toBe(1_501);
  });

  it("fails closed on provider errors and keeps the result non-persistable", async () => {
    const broken = provider(null);
    broken.fetch = vi.fn().mockRejectedValue(new Error("timeout"));
    const result = await buildPublishingPlatformContextSnapshot({
      provider: broken,
      platform: "xiaohongshu",
      versionId: "v1",
      sourceRevision: 3,
      queryText: "AI 工具",
      contentTags: ["原标签"],
      now: 1_500,
    });

    expect(result.persistable).toBe(false);
    expect(result.snapshot.status).toBe("provider_error");
    expect(result.snapshot.candidates).toEqual([]);
    expect(result.snapshot.contentSuggestions).toEqual(["原标签"]);
  });
});
