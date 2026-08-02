import { describe, expect, it } from "vitest";
import type { PromptRevision } from "@shared/promptLineage";
import {
  buildPromptAttribution,
  encodeAttributionReason,
} from "@shared/promptRevisionAttribution";
import { findSupersedableCandidate } from "./promptCandidateSupersede";

function revision(overrides: Partial<PromptRevision> & { id: number; nodeId: number }): PromptRevision {
  return {
    storyId: 36,
    userId: 7,
    parentRevisionId: null,
    content: "",
    weight: 0.3,
    authorType: "agent",
    authorUserId: null,
    reason: null,
    source: null,
    status: "confirmed",
    createdAt: "2026-06-30T00:00:00.000Z",
    decidedAt: "2026-06-30T00:00:00.000Z",
    ...overrides,
  };
}

describe("findSupersedableCandidate", () => {
  it("找到同一节点上、状态为 candidate、evidence 里带匹配 kind 的修订", () => {
    const reason = encodeAttributionReason(buildPromptAttribution({ dimension: "mood", kind: "edit" }));
    const revisions = [revision({ id: 1, nodeId: 30, status: "candidate", reason })];
    expect(findSupersedableCandidate(revisions, 30, "edit")?.id).toBe(1);
  });

  it("kind 不匹配时不算——不同触发路径的候选互不干扰", () => {
    const reason = encodeAttributionReason(buildPromptAttribution({ dimension: "mood", kind: "manual" }));
    const revisions = [revision({ id: 1, nodeId: 30, status: "candidate", reason })];
    expect(findSupersedableCandidate(revisions, 30, "edit")).toBeNull();
  });

  it("nodeId 不匹配时不算", () => {
    const reason = encodeAttributionReason(buildPromptAttribution({ dimension: "mood", kind: "edit" }));
    const revisions = [revision({ id: 1, nodeId: 99, status: "candidate", reason })];
    expect(findSupersedableCandidate(revisions, 30, "edit")).toBeNull();
  });

  it("status 不是 candidate（已确认/已拒绝）时不算，即使 kind 匹配", () => {
    const reason = encodeAttributionReason(buildPromptAttribution({ dimension: "mood", kind: "edit" }));
    const revisions = [
      revision({ id: 1, nodeId: 30, status: "confirmed", reason }),
      revision({ id: 2, nodeId: 30, status: "rejected", reason }),
    ];
    expect(findSupersedableCandidate(revisions, 30, "edit")).toBeNull();
  });

  it("reason 是历史自由文本（解不出归因）时不算，不抛错", () => {
    const revisions = [
      revision({ id: 1, nodeId: 30, status: "candidate", reason: "legacy import" }),
    ];
    expect(findSupersedableCandidate(revisions, 30, "edit")).toBeNull();
  });

  it("与 authorType 无关——即使是 user authored 也能被同 kind 匹配到", () => {
    const reason = encodeAttributionReason(buildPromptAttribution({ dimension: "mood", kind: "edit" }));
    const revisions = [
      revision({ id: 1, nodeId: 30, status: "candidate", authorType: "user", reason }),
    ];
    expect(findSupersedableCandidate(revisions, 30, "edit")?.id).toBe(1);
  });
});
