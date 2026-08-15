import { describe, expect, it } from "vitest";
import {
  appendPublishingPlatformContextSnapshot,
  emptyPublishingPlatformContextState,
  isVerifiedRealtimePublishingContext,
  normalizePublishingPlatformContextState,
  selectPublishingPlatformContextTags,
  type PublishingPlatformContextSnapshot,
} from "./publishingPlatformContext";

function snapshot(
  revision: number,
  overrides: Partial<PublishingPlatformContextSnapshot> = {}
): PublishingPlatformContextSnapshot {
  return {
    snapshotId: `snapshot-${revision}`,
    versionId: "v1",
    platform: "xiaohongshu",
    sourceRevision: 3,
    revision,
    status: "verified_fresh",
    capability: "verified",
    providerId: "authorized-fixture",
    providerLabel: "授权测试源",
    authorization: {
      status: "official",
      reference: "console-capability-2026-08",
    },
    coverage: "小红书公开话题榜",
    fetchedAt: 1_000 + revision,
    sourcePublishedAt: 900,
    expiresAt: 2_000,
    sourceDocument: "https://provider.example/docs",
    parserVersion: "fixture-v1",
    rawDigest: `sha256-${revision.toString(16).padStart(64, "0")}`,
    candidates: [
      { id: "topic-ai", label: "AI 工具", sourcePublishedAt: 900 },
      { id: "topic-writing", label: "写作", sourcePublishedAt: 901 },
    ],
    contentSuggestions: ["独立开发"],
    message: "已获取可验证的实时热点",
    createdAt: 1_000 + revision,
    ...overrides,
  };
}

describe("publishing platform context contract", () => {
  it("only labels authorized, unexpired snapshots as realtime", () => {
    expect(isVerifiedRealtimePublishingContext(snapshot(1), 1_500)).toBe(true);
    expect(isVerifiedRealtimePublishingContext(
      snapshot(1, { status: "verified_stale" }),
      1_500
    )).toBe(false);
    expect(isVerifiedRealtimePublishingContext(snapshot(1), 2_001)).toBe(false);
    expect(isVerifiedRealtimePublishingContext(snapshot(1, {
      authorization: { status: "unavailable", reference: "missing" },
    }), 1_500)).toBe(false);
    expect(isVerifiedRealtimePublishingContext(snapshot(1, {
      sourcePublishedAt: null,
    }), 1_500)).toBe(false);
    expect(isVerifiedRealtimePublishingContext(snapshot(1, {
      rawDigest: "not-a-provider-digest",
    }), 1_500)).toBe(false);
  });

  it("keeps an immutable selected snapshot while bounding newer history", () => {
    let state = emptyPublishingPlatformContextState(1);
    state = appendPublishingPlatformContextSnapshot(state, snapshot(1), 1);
    state = selectPublishingPlatformContextTags(state, {
      snapshotId: "snapshot-1",
      candidateIds: ["topic-ai"],
      contentTags: ["独立开发"],
      now: 2,
    });
    for (let revision = 2; revision <= 10; revision += 1) {
      state = appendPublishingPlatformContextSnapshot(
        state,
        snapshot(revision),
        10 + revision
      );
    }

    expect(state.snapshots).toHaveLength(8);
    expect(state.snapshots.some(item => item.snapshotId === "snapshot-1")).toBe(true);
    expect(state.selectedSnapshotId).toBe("snapshot-1");
    expect(state.selectedTags).toEqual(["AI 工具", "独立开发"]);
  });

  it("rejects invented candidate ids instead of turning them into tags", () => {
    const state = appendPublishingPlatformContextSnapshot(
      emptyPublishingPlatformContextState(1),
      snapshot(1),
      1
    );
    expect(() => selectPublishingPlatformContextTags(state, {
      snapshotId: "snapshot-1",
      candidateIds: ["not-from-provider"],
      contentTags: [],
      now: 2,
    })).toThrow(/candidate/i);
  });

  it("does not store provider failures as durable snapshots", () => {
    expect(() => appendPublishingPlatformContextSnapshot(
      emptyPublishingPlatformContextState(1),
      snapshot(1, {
        status: "provider_error",
        capability: "unavailable",
        authorization: { status: "unavailable", reference: "missing" },
        sourcePublishedAt: null,
        expiresAt: 1_001,
        candidates: [],
      }),
      1
    )).toThrow(/verified/i);

    const normalized = normalizePublishingPlatformContextState({
      revision: 1,
      snapshots: [snapshot(1, {
        status: "provider_error",
        capability: "unavailable",
        authorization: { status: "unavailable", reference: "missing" },
        sourcePublishedAt: null,
        expiresAt: 1_001,
        candidates: [],
      })],
    }, {
      versionId: "v1",
      platform: "xiaohongshu",
      now: 10,
    });
    expect(normalized.snapshots).toEqual([]);
  });

  it("preserves punctuation in selected labels and normalizes content tags identically", () => {
    const state = appendPublishingPlatformContextSnapshot(
      emptyPublishingPlatformContextState(1),
      snapshot(1, {
        candidates: [{
          id: "topic-ai",
          label: "AI&科技 <观察>",
          sourcePublishedAt: 900,
        }],
      }),
      1
    );
    const selected = selectPublishingPlatformContextTags(state, {
      snapshotId: "snapshot-1",
      candidateIds: ["topic-ai"],
      contentTags: ["# 独立\u0000开发", " 独立开发 "],
      now: 2,
    });

    expect(selected.selectedTags).toEqual(["AI&科技 <观察>", "独立开发"]);
  });

  it("rejects persisted candidate ids that collide after normalization", () => {
    const normalized = normalizePublishingPlatformContextState({
      revision: 1,
      snapshots: [snapshot(1, {
        candidates: [
          { id: "Ａ", label: "AI", sourcePublishedAt: 900 },
          { id: "A", label: "写作", sourcePublishedAt: 900 },
        ],
      })],
      selectedSnapshotId: null,
      selectedTags: [],
      updatedAt: 2,
    }, {
      versionId: "v1",
      platform: "xiaohongshu",
      now: 10,
    });

    expect(normalized.snapshots).toEqual([]);
  });

  it("treats snapshots with reordered object keys as the same immutable value", () => {
    const original = snapshot(1);
    const reordered = {
      ...original,
      authorization: {
        reference: original.authorization.reference,
        status: original.authorization.status,
      },
    };
    const state = appendPublishingPlatformContextSnapshot(
      emptyPublishingPlatformContextState(1),
      original,
      1
    );

    expect(appendPublishingPlatformContextSnapshot(state, reordered, 2)).toBe(state);
  });

  it("normalizes persisted snapshots without retaining raw provider payloads", () => {
    const normalized = normalizePublishingPlatformContextState({
      revision: 4,
      snapshots: [{
        ...snapshot(1),
        rawResponse: { token: "must-not-survive" },
        candidates: [
          { id: "topic-ai", label: "AI 工具", sourcePublishedAt: 900, raw: "drop" },
        ],
      }],
      selectedSnapshotId: "snapshot-1",
      selectedTags: ["#AI 工具", " AI 工具 "],
      updatedAt: 8,
    }, {
      versionId: "v1",
      platform: "xiaohongshu",
      now: 10,
    });

    expect(normalized.selectedTags).toEqual(["AI 工具"]);
    expect(normalized.snapshots).toHaveLength(1);
    expect(normalized.snapshots[0]).not.toHaveProperty("rawResponse");
    expect(normalized.snapshots[0].candidates[0]).toEqual({
      id: "topic-ai",
      label: "AI 工具",
      sourcePublishedAt: 900,
    });
  });
});
