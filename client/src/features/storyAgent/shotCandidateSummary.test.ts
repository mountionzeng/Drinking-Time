import { describe, expect, it } from "vitest";
import type { StoryPromptAggregate, PromptRevision, PromptNode } from "@shared/promptLineage";
import {
  buildPromptAttribution,
  encodeAttributionReason,
} from "@shared/promptRevisionAttribution";
import { summarizeShotCandidates } from "./shotCandidateSummary";

function node(overrides: Partial<PromptNode> & { id: number }): PromptNode {
  return {
    storyId: 36,
    userId: 7,
    stableShotId: "shot-03",
    scope: "shot",
    modality: "shared",
    dimension: "subject",
    currentRevisionId: null,
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z",
    ...overrides,
  };
}

function revision(overrides: Partial<PromptRevision> & { id: number; nodeId: number }): PromptRevision {
  return {
    storyId: 36,
    userId: 7,
    parentRevisionId: null,
    content: "",
    weight: 0.3,
    authorType: "user",
    authorUserId: null,
    reason: null,
    source: null,
    status: "candidate",
    createdAt: "2026-06-30T00:00:00.000Z",
    decidedAt: null,
    ...overrides,
  };
}

function aggregate(nodes: PromptNode[], revisions: PromptRevision[]): StoryPromptAggregate {
  return {
    state: {
      id: 1,
      storyId: 36,
      userId: 7,
      version: 3,
      migrationStatus: "migrated",
      migratedAt: null,
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-06-30T00:00:00.000Z",
    },
    nodes,
    revisions,
    bindings: [],
    compilations: [],
    compilationInputs: [],
    compilationHeads: [],
    conversation: null,
    messages: [],
    messageReferences: [],
    artBinding: null,
  };
}

describe("summarizeShotCandidates", () => {
  it("null/undefined 聚合返回空 Map，不抛错", () => {
    expect(summarizeShotCandidates(null).size).toBe(0);
    expect(summarizeShotCandidates(undefined).size).toBe(0);
  });

  it("镜头局部节点上的待确认候选被收进对应 stableShotId", () => {
    const n = node({ id: 30, currentRevisionId: 300 });
    const confirmed = revision({ id: 300, nodeId: 30, content: "少年", status: "confirmed" });
    const candidate = revision({ id: 301, nodeId: 30, content: "少年在阳台" });
    const summary = summarizeShotCandidates(aggregate([n], [confirmed, candidate]));

    const entries = summary.get("shot-03");
    expect(entries).toHaveLength(1);
    expect(entries?.[0]).toMatchObject({
      revisionId: 301,
      nodeId: 30,
      dimension: "subject",
      label: "主体",
      currentContent: "少年",
      proposedContent: "少年在阳台",
    });
  });

  it("已确认/已拒绝的修订不计入待确认列表", () => {
    const n = node({ id: 30 });
    const revisions = [
      revision({ id: 301, nodeId: 30, content: "x", status: "confirmed" }),
      revision({ id: 302, nodeId: 30, content: "y", status: "rejected" }),
    ];
    const summary = summarizeShotCandidates(aggregate([n], revisions));
    expect(summary.get("shot-03")).toBeUndefined();
  });

  it("故事级共享节点（scope: story）不计入任何镜头——避免同一条候选重复出现在每张卡片上", () => {
    const n = node({ id: 30, scope: "story", stableShotId: null, dimension: "visual_style" });
    const candidate = revision({ id: 301, nodeId: 30, content: "冷色调" });
    const summary = summarizeShotCandidates(aggregate([n], [candidate]));
    expect(summary.size).toBe(0);
  });

  it("节点还没有任何已确认内容时 currentContent 为 null", () => {
    const n = node({ id: 30, currentRevisionId: null });
    const candidate = revision({ id: 301, nodeId: 30, content: "少年在阳台" });
    const summary = summarizeShotCandidates(aggregate([n], [candidate]));
    expect(summary.get("shot-03")?.[0]?.currentContent).toBeNull();
  });

  it("能解析出归因时给出人类可读摘要，解不出时为 null", () => {
    const n1 = node({ id: 30 });
    const n2 = node({ id: 31, stableShotId: "shot-04" });
    const reason = encodeAttributionReason(
      buildPromptAttribution({ dimension: "subject", kind: "utterance" }),
    );
    const revisions = [
      revision({ id: 301, nodeId: 30, content: "x", reason }),
      revision({ id: 302, nodeId: 31, content: "y", reason: "legacy import" }),
    ];
    const summary = summarizeShotCandidates(aggregate([n1, n2], revisions));
    expect(summary.get("shot-03")?.[0]?.attributionSummary).toBe("1 条聊天证据");
    expect(summary.get("shot-04")?.[0]?.attributionSummary).toBeNull();
  });

  it("同一镜头多个维度的候选都被收进同一个数组", () => {
    const n1 = node({ id: 30, dimension: "subject" });
    const n2 = node({ id: 31, dimension: "mood" });
    const revisions = [
      revision({ id: 301, nodeId: 30, content: "x" }),
      revision({ id: 302, nodeId: 31, content: "y" }),
    ];
    const summary = summarizeShotCandidates(aggregate([n1, n2], revisions));
    expect(summary.get("shot-03")?.map(e => e.dimension)).toEqual(["subject", "mood"]);
  });

  it("找不到维度标签时退回维度 id 本身", () => {
    const n = node({ id: 30, dimension: "totally_unknown_dimension" });
    const candidate = revision({ id: 301, nodeId: 30, content: "x" });
    const summary = summarizeShotCandidates(aggregate([n], [candidate]));
    expect(summary.get("shot-03")?.[0]?.label).toBe("totally_unknown_dimension");
  });
});
