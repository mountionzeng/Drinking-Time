import { describe, expect, it } from "vitest";
import type { PromptNode } from "./promptLineage";
import { resolveCandidateWriteback } from "./promptCandidateWriteback";

function node(overrides: Partial<PromptNode> & { id: number }): PromptNode {
  return {
    storyId: 1,
    userId: 1,
    stableShotId: "shot-a",
    scope: "shot",
    modality: "image",
    dimension: "style_reference",
    currentRevisionId: null,
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveCandidateWriteback", () => {
  it("镜头级节点解析出落点列和要写的值", () => {
    expect(
      resolveCandidateWriteback({
        nodes: [node({ id: 7, dimension: "style_reference" })],
        candidate: { nodeId: 7, content: "  宫崎骏水彩  " },
      }),
    ).toEqual({
      stableShotId: "shot-a",
      field: "styleRef",
      value: "宫崎骏水彩",
    });
  });

  it("认得 snake_case 之外的维度写法", () => {
    expect(
      resolveCandidateWriteback({
        nodes: [node({ id: 7, dimension: "timeLight" })],
        candidate: { nodeId: 7, content: "黄昏" },
      }),
    ).toEqual({ stableShotId: "shot-a", field: "timeLight", value: "黄昏" });
  });

  it("故事级共享节点不回写——它没有唯一的落点镜头", () => {
    expect(
      resolveCandidateWriteback({
        nodes: [
          node({ id: 7, scope: "story", stableShotId: null, dimension: "mood" }),
        ],
        candidate: { nodeId: 7, content: "低沉" },
      }),
    ).toBeNull();
  });

  it("scope 是 story 但残留了 stableShotId 时同样不回写", () => {
    // 数据异常的防御：scope 才是权威，不能因为字段还在就当镜头级处理。
    expect(
      resolveCandidateWriteback({
        nodes: [
          node({ id: 7, scope: "story", stableShotId: "shot-a", dimension: "mood" }),
        ],
        candidate: { nodeId: 7, content: "低沉" },
      }),
    ).toBeNull();
  });

  it("镜头表里没有对应列的维度不回写", () => {
    expect(
      resolveCandidateWriteback({
        nodes: [node({ id: 7, dimension: "art_style_recipe" })],
        candidate: { nodeId: 7, content: "赛璐璐" },
      }),
    ).toBeNull();
  });

  it("空内容不回写——不拿空值覆盖用户已有的列", () => {
    expect(
      resolveCandidateWriteback({
        nodes: [node({ id: 7 })],
        candidate: { nodeId: 7, content: "   " },
      }),
    ).toBeNull();
  });

  it("找不到节点时返回 null 而不是抛错", () => {
    expect(
      resolveCandidateWriteback({
        nodes: [node({ id: 7 })],
        candidate: { nodeId: 999, content: "x" },
      }),
    ).toBeNull();
  });
});
