import { describe, expect, it } from "vitest";
import type { StoryPromptAggregate, PromptRevision } from "@shared/promptLineage";
import {
  buildPromptAttribution,
  decodeAttributionReason,
  encodeAttributionReason,
} from "@shared/promptRevisionAttribution";
import {
  lineageWillAutoResync,
  resolveEditCandidatePlans,
  type ShotFieldChange,
} from "./editPromptCandidate";

/**
 * 阶段 D 只在谱系"冻结"之后才提议候选——冻结的标志是谱系里已经有过
 * user/agent 修订（见 editPromptCandidate.ts 顶部注释）。测试夹具默认带上
 * 这样一条修订，代表"这个故事已经被人工改过提示词"这个前置条件；
 * 不带它的情况由 lineageWillAutoResync 那组用例单独覆盖。
 */
function frozenMarkerRevision(): PromptRevision {
  return baseRevision({
    id: 999,
    nodeId: 30,
    content: "此前的人工修改",
    authorType: "user",
    status: "confirmed",
  });
}

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
      baseRevision({ id: 300, nodeId: 30, content: "少年" }),
      frozenMarkerRevision(),
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

function change(overrides: Partial<ShotFieldChange> = {}): ShotFieldChange {
  return {
    stableShotId: "shot-03",
    previousValue: "少年",
    nextValue: "少年在阳台上抽烟",
    field: "subject",
    ...overrides,
  };
}

describe("resolveEditCandidatePlans", () => {
  it("字段真的变了、维度已知、节点存在 → 解析出一条计划", () => {
    const plans = resolveEditCandidatePlans({ changes: [change()], aggregate: aggregate() });
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      nodeId: 30,
      stableShotId: "shot-03",
      dimension: "subject",
      content: "少年在阳台上抽烟",
      supersedesRevisionId: undefined,
    });
    const decoded = decodeAttributionReason(plans[0]!.reason);
    expect(decoded).toMatchObject({ dimension: "subject", evidence: [{ kind: "edit" }] });
  });

  it("camelCase 字段名归一到规范维度 id（如 styleRef -> style_reference）", () => {
    const agg = aggregate({
      nodes: [
        {
          id: 31,
          storyId: 36,
          userId: 7,
          stableShotId: "shot-03",
          scope: "shot",
          modality: "shared",
          dimension: "style_reference",
          currentRevisionId: 310,
          createdAt: "2026-06-30T00:00:00.000Z",
          updatedAt: "2026-06-30T00:00:00.000Z",
        },
      ],
      revisions: [
        baseRevision({ id: 310, nodeId: 31, content: "暖色调" }),
        frozenMarkerRevision(),
      ],
    });
    const plans = resolveEditCandidatePlans({
      changes: [change({ field: "styleRef", previousValue: "暖色调", nextValue: "冷色调纪实感" })],
      aggregate: agg,
    });
    expect(plans[0]?.dimension).toBe("style_reference");
  });

  it("字段不是已知提示词维度时跳过（cueCode/note 这类纯记录字段）", () => {
    const plans = resolveEditCandidatePlans({
      changes: [change({ field: "cueCode", previousValue: "0102", nextValue: "0103" })],
      aggregate: aggregate(),
    });
    expect(plans).toEqual([]);
  });

  it("值没有实质变化时跳过（trim 后相等）", () => {
    const plans = resolveEditCandidatePlans({
      changes: [change({ previousValue: "少年", nextValue: "  少年  " })],
      aggregate: aggregate(),
    });
    expect(plans).toEqual([]);
  });

  it("新值为空/纯空白时跳过", () => {
    const plans = resolveEditCandidatePlans({
      changes: [change({ nextValue: "   " })],
      aggregate: aggregate(),
    });
    expect(plans).toEqual([]);
  });

  it("没有 stableShotId 时跳过", () => {
    const plans = resolveEditCandidatePlans({
      changes: [change({ stableShotId: null })],
      aggregate: aggregate(),
    });
    expect(plans).toEqual([]);
  });

  it("镜头存在但该维度没有谱系节点时跳过（未迁移的旧故事，不是错误）", () => {
    const plans = resolveEditCandidatePlans({
      changes: [change({ field: "mood", previousValue: "", nextValue: "平静" })],
      aggregate: aggregate(),
    });
    expect(plans).toEqual([]);
  });

  it("新值与谱系当前内容一致时跳过（没有实质差异，不必再提议）", () => {
    const plans = resolveEditCandidatePlans({
      changes: [change({ previousValue: "旧的镜头表内容", nextValue: "少年" })],
      aggregate: aggregate(),
    });
    expect(plans).toEqual([]);
  });

  it("多条改动各自独立解析", () => {
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
          currentRevisionId: 310,
          createdAt: "2026-06-30T00:00:00.000Z",
          updatedAt: "2026-06-30T00:00:00.000Z",
        },
      ],
      revisions: [
        baseRevision({ id: 300, nodeId: 30, content: "少年" }),
        baseRevision({ id: 310, nodeId: 31, content: "" }),
        frozenMarkerRevision(),
      ],
    });
    const plans = resolveEditCandidatePlans({
      changes: [
        change({ field: "subject", previousValue: "少年", nextValue: "少年在阳台" }),
        change({ field: "mood", previousValue: "", nextValue: "平静" }),
      ],
      aggregate: agg,
    });
    expect(plans.map(p => p.dimension)).toEqual(["subject", "mood"]);
  });

  it("同一节点已有本模块产生的候选时顶掉重建、合并证据", () => {
    const previousReason = encodeAttributionReason(
      buildPromptAttribution({ dimension: "subject", kind: "edit" }),
    );
    const agg = aggregate({
      revisions: [
        baseRevision({ id: 300, nodeId: 30, content: "少年" }),
        baseRevision({
          id: 301,
          nodeId: 30,
          content: "少年在阳台",
          status: "candidate",
          authorType: "user",
          reason: previousReason,
        }),
      ],
    });
    const plans = resolveEditCandidatePlans({
      changes: [change({ nextValue: "少年在阳台上抽烟" })],
      aggregate: agg,
    });
    expect(plans[0]?.supersedesRevisionId).toBe(301);
    const decoded = decodeAttributionReason(plans[0]!.reason);
    expect(decoded?.evidence.length).toBe(2);
  });

  it("不顶掉聊天提议（utterance）产生的候选——那是另一路信号", () => {
    const utteranceReason = encodeAttributionReason(
      buildPromptAttribution({ dimension: "subject", kind: "utterance" }),
    );
    const agg = aggregate({
      revisions: [
        baseRevision({ id: 300, nodeId: 30, content: "少年" }),
        baseRevision({
          id: 301,
          nodeId: 30,
          content: "聊天提议的内容",
          status: "candidate",
          authorType: "agent",
          reason: utteranceReason,
        }),
      ],
    });
    const plans = resolveEditCandidatePlans({
      changes: [change({ nextValue: "少年在阳台上抽烟" })],
      aggregate: agg,
    });
    expect(plans[0]?.supersedesRevisionId).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 谱系自动重建 vs 冻结——浏览器实测暴露出来的设计前提。
// 服务端 maybeResetStaleMigration：body 变了且谱系里没有任何 user/agent 修订
// 时，整个清空重建谱系。这种情况下提候选既多余（内容会和新基线一致）又会
// 撞上节点重建（createCandidate 报 "Prompt node N is unavailable"）。
// ─────────────────────────────────────────────────────────────────────────────
describe("lineageWillAutoResync", () => {
  it("只有 migration 修订时为 true——服务端会自己重建，不该提候选", () => {
    const agg = aggregate({
      revisions: [baseRevision({ id: 300, nodeId: 30, content: "少年" })],
    });
    expect(lineageWillAutoResync(agg)).toBe(true);
  });

  it("有 user 修订时为 false——谱系已冻结", () => {
    const agg = aggregate({
      revisions: [
        baseRevision({ id: 300, nodeId: 30, content: "少年" }),
        baseRevision({ id: 301, nodeId: 30, content: "x", authorType: "user" }),
      ],
    });
    expect(lineageWillAutoResync(agg)).toBe(false);
  });

  it("有 agent 修订时为 false——谱系已冻结", () => {
    const agg = aggregate({
      revisions: [
        baseRevision({ id: 300, nodeId: 30, content: "少年" }),
        baseRevision({ id: 301, nodeId: 30, content: "x", authorType: "agent" }),
      ],
    });
    expect(lineageWillAutoResync(agg)).toBe(false);
  });

  it("system 修订不算人工修改，仍会自动重建", () => {
    const agg = aggregate({
      revisions: [
        baseRevision({ id: 300, nodeId: 30, content: "少年" }),
        baseRevision({ id: 301, nodeId: 30, content: "x", authorType: "system" }),
      ],
    });
    expect(lineageWillAutoResync(agg)).toBe(true);
  });

  it("谱系会自动重建时 resolveEditCandidatePlans 直接返回空——即便改动本身完全合法", () => {
    const agg = aggregate({
      revisions: [baseRevision({ id: 300, nodeId: 30, content: "少年" })],
    });
    const plans = resolveEditCandidatePlans({
      changes: [change()],
      aggregate: agg,
    });
    expect(plans).toEqual([]);
  });
});
