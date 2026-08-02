import { describe, expect, it } from "vitest";
import type { StoryPromptAggregate, PromptRevision } from "@shared/promptLineage";
import {
  buildPromptAttribution,
  decodeAttributionReason,
  encodeAttributionReason,
} from "@shared/promptRevisionAttribution";
import { resolveUtteranceCandidatePlans } from "./utterancePromptCandidate";

function baseRevision(overrides: Partial<PromptRevision> & { id: number; nodeId: number }): PromptRevision {
  return {
    storyId: 36,
    userId: 7,
    parentRevisionId: null,
    content: "",
    weight: 0.3,
    authorType: "migration",
    authorUserId: null,
    reason: null,
    source: null,
    status: "confirmed",
    createdAt: "2026-06-30T00:00:00.000Z",
    decidedAt: "2026-06-30T00:00:00.000Z",
    ...overrides,
  };
}

function aggregate(overrides: Partial<StoryPromptAggregate> = {}): StoryPromptAggregate {
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
    nodes: [
      {
        id: 30,
        storyId: 36,
        userId: 7,
        stableShotId: "shot-03",
        scope: "shot",
        modality: "shared",
        dimension: "subject",
        currentRevisionId: 300,
        createdAt: "2026-06-30T00:00:00.000Z",
        updatedAt: "2026-06-30T00:00:00.000Z",
      },
    ],
    revisions: [
      baseRevision({ id: 300, nodeId: 30, content: "少年", status: "confirmed" }),
    ],
    bindings: [],
    compilations: [],
    compilationInputs: [],
    compilationHeads: [],
    conversation: null,
    messages: [],
    messageReferences: [],
    artBinding: null,
    ...overrides,
  };
}

const shots = [{ shotNo: 3, stableShotId: "shot-03" } as never];

describe("resolveUtteranceCandidatePlans", () => {
  it("解析出一条计划：节点存在、维度归一、reason 已编码", () => {
    const plans = resolveUtteranceCandidatePlans({
      toolCalls: [{ name: "proposePromptRevision", shotNo: 3, dimension: "subject", content: "少年在阳台上抽烟" }],
      shots,
      aggregate: aggregate(),
      messageId: "msg-1",
      excerpt: "他在阳台上抽烟",
    });

    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      nodeId: 30,
      stableShotId: "shot-03",
      dimension: "subject",
      content: "少年在阳台上抽烟",
      supersedesRevisionId: undefined,
    });
    const decoded = decodeAttributionReason(plans[0]!.reason);
    expect(decoded?.dimension).toBe("subject");
    expect(decoded?.evidence).toEqual([
      expect.objectContaining({ kind: "utterance", messageId: "msg-1", excerpt: "他在阳台上抽烟" }),
    ]);
  });

  it("dimension 用别名写法也能归一到规范 id 并找到节点", () => {
    const plans = resolveUtteranceCandidatePlans({
      toolCalls: [{ name: "proposePromptRevision", shotNo: 3, dimension: "subject", content: "x" }],
      shots,
      aggregate: aggregate(),
      messageId: "msg-1",
      excerpt: "",
    });
    expect(plans[0]?.dimension).toBe("subject");
  });

  it("name 不是 proposePromptRevision 时跳过", () => {
    const plans = resolveUtteranceCandidatePlans({
      toolCalls: [{ name: "generateImage", shotNo: 3, dimension: "subject", content: "x" }],
      shots,
      aggregate: aggregate(),
      messageId: "msg-1",
      excerpt: "",
    });
    expect(plans).toEqual([]);
  });

  it("content 为空或纯空白时跳过", () => {
    const plans = resolveUtteranceCandidatePlans({
      toolCalls: [{ name: "proposePromptRevision", shotNo: 3, dimension: "subject", content: "   " }],
      shots,
      aggregate: aggregate(),
      messageId: "msg-1",
      excerpt: "",
    });
    expect(plans).toEqual([]);
  });

  it("shotNo 在 shots 里找不到对应镜头时跳过", () => {
    const plans = resolveUtteranceCandidatePlans({
      toolCalls: [{ name: "proposePromptRevision", shotNo: 99, dimension: "subject", content: "x" }],
      shots,
      aggregate: aggregate(),
      messageId: "msg-1",
      excerpt: "",
    });
    expect(plans).toEqual([]);
  });

  it("镜头存在但该维度没有对应节点时跳过（不是错误，是正常情况）", () => {
    const plans = resolveUtteranceCandidatePlans({
      toolCalls: [{ name: "proposePromptRevision", shotNo: 3, dimension: "mood", content: "x" }],
      shots,
      aggregate: aggregate(),
      messageId: "msg-1",
      excerpt: "",
    });
    expect(plans).toEqual([]);
  });

  it("多条 toolCalls 各自独立解析", () => {
    const agg = aggregate({
      nodes: [
        {
          id: 30,
          storyId: 36,
          userId: 7,
          stableShotId: "shot-03",
          scope: "shot",
          modality: "shared",
          dimension: "subject",
          currentRevisionId: 300,
          createdAt: "2026-06-30T00:00:00.000Z",
          updatedAt: "2026-06-30T00:00:00.000Z",
        },
        {
          id: 31,
          storyId: 36,
          userId: 7,
          stableShotId: "shot-03",
          scope: "shot",
          modality: "shared",
          dimension: "mood",
          currentRevisionId: 301,
          createdAt: "2026-06-30T00:00:00.000Z",
          updatedAt: "2026-06-30T00:00:00.000Z",
        },
      ],
      revisions: [
        baseRevision({ id: 300, nodeId: 30, content: "少年" }),
        baseRevision({ id: 301, nodeId: 31, content: "" }),
      ],
    });
    const plans = resolveUtteranceCandidatePlans({
      toolCalls: [
        { name: "proposePromptRevision", shotNo: 3, dimension: "subject", content: "A" },
        { name: "proposePromptRevision", shotNo: 3, dimension: "mood", content: "B" },
      ],
      shots,
      aggregate: agg,
      messageId: "msg-1",
      excerpt: "",
    });
    expect(plans.map(p => p.dimension)).toEqual(["subject", "mood"]);
  });

  describe("顶掉已有候选（同一节点上本模块之前留下的 utterance 候选）", () => {
    it("同一节点已有 agent+utterance 候选时，标记 supersedesRevisionId 并合并证据", () => {
      const previousReason = encodeAttributionReason(
        buildPromptAttribution({ dimension: "subject", kind: "utterance", messageId: "msg-0" }),
      );
      const agg = aggregate({
        revisions: [
          baseRevision({ id: 300, nodeId: 30, content: "少年" }),
          baseRevision({
            id: 301,
            nodeId: 30,
            content: "少年在阳台",
            status: "candidate",
            authorType: "agent",
            reason: previousReason,
          }),
        ],
      });
      const plans = resolveUtteranceCandidatePlans({
        toolCalls: [{ name: "proposePromptRevision", shotNo: 3, dimension: "subject", content: "少年在阳台上抽烟" }],
        shots,
        aggregate: agg,
        messageId: "msg-1",
        excerpt: "他在抽烟",
      });

      expect(plans[0]?.supersedesRevisionId).toBe(301);
      const decoded = decodeAttributionReason(plans[0]!.reason);
      expect(decoded?.evidence.map(e => e.messageId)).toEqual(["msg-0", "msg-1"]);
    });

    it("不顶掉用户手改（manual）产生的候选——那是另一路信号", () => {
      const manualReason = encodeAttributionReason(
        buildPromptAttribution({ dimension: "subject", kind: "manual" }),
      );
      const agg = aggregate({
        revisions: [
          baseRevision({ id: 300, nodeId: 30, content: "少年" }),
          baseRevision({
            id: 301,
            nodeId: 30,
            content: "用户手改的内容",
            status: "candidate",
            authorType: "user",
            reason: manualReason,
          }),
        ],
      });
      const plans = resolveUtteranceCandidatePlans({
        toolCalls: [{ name: "proposePromptRevision", shotNo: 3, dimension: "subject", content: "少年在阳台" }],
        shots,
        aggregate: agg,
        messageId: "msg-1",
        excerpt: "",
      });

      expect(plans[0]?.supersedesRevisionId).toBeUndefined();
    });

    it("不顶掉划词编辑（selection）产生的候选——那也是另一路信号", () => {
      const selectionReason = encodeAttributionReason(
        buildPromptAttribution({ dimension: "subject", kind: "selection" }),
      );
      const agg = aggregate({
        revisions: [
          baseRevision({ id: 300, nodeId: 30, content: "少年" }),
          baseRevision({
            id: 301,
            nodeId: 30,
            content: "划词编辑改的内容",
            status: "candidate",
            authorType: "agent",
            reason: selectionReason,
          }),
        ],
      });
      const plans = resolveUtteranceCandidatePlans({
        toolCalls: [{ name: "proposePromptRevision", shotNo: 3, dimension: "subject", content: "少年在阳台" }],
        shots,
        aggregate: agg,
        messageId: "msg-1",
        excerpt: "",
      });

      expect(plans[0]?.supersedesRevisionId).toBeUndefined();
    });

    it("已确认（confirmed）或已拒绝（rejected）的候选不会被当成待顶掉的目标", () => {
      const utteranceReason = encodeAttributionReason(
        buildPromptAttribution({ dimension: "subject", kind: "utterance" }),
      );
      const agg = aggregate({
        revisions: [
          baseRevision({
            id: 300,
            nodeId: 30,
            content: "少年",
            status: "confirmed",
            authorType: "agent",
            reason: utteranceReason,
          }),
        ],
      });
      const plans = resolveUtteranceCandidatePlans({
        toolCalls: [{ name: "proposePromptRevision", shotNo: 3, dimension: "subject", content: "少年在阳台" }],
        shots,
        aggregate: agg,
        messageId: "msg-1",
        excerpt: "",
      });

      expect(plans[0]?.supersedesRevisionId).toBeUndefined();
    });
  });
});
