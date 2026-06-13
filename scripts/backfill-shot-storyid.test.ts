import { describe, expect, it } from "vitest";

import { applyPlan, chooseStoryForProject, planBackfill } from "./backfill-shot-storyid";

describe("chooseStoryForProject", () => {
  it("project 仅一个故事 → 归该故事", () => {
    const r = chooseStoryForProject(3, [
      { id: 1, title: "A", bodyShotCount: 99, updatedAt: "2026-06-12" },
    ]);
    expect(r.chosenStoryId).toBe(1);
    expect(r.ambiguous).toBe(false);
  });

  it("Covers R3：数量精确命中且唯一 → 归数量吻合者（不是 updatedAt 最近者）", () => {
    // 待归 7 条；候选 body.shots=11(新) 和 7(旧) → 应选 7，而非最近更新的 11
    const r = chooseStoryForProject(7, [
      { id: 6, title: "新", bodyShotCount: 11, updatedAt: "2026-06-13" },
      { id: 8, title: "旧", bodyShotCount: 7, updatedAt: "2026-06-12" },
    ]);
    expect(r.chosenStoryId).toBe(8);
    expect(r.ambiguous).toBe(false);
  });

  it("数量并列 → 标歧义需裁决", () => {
    // 待归 2 条；两个候选 body.shots 都=2 → 歧义
    const r = chooseStoryForProject(2, [
      { id: 14, title: "同名", bodyShotCount: 2, updatedAt: "2026-06-12" },
      { id: 15, title: "同名", bodyShotCount: 2, updatedAt: "2026-06-13" },
    ]);
    expect(r.ambiguous).toBe(true);
    expect(r.chosenStoryId).toBe(15); // updatedAt 兜底，但标歧义
  });

  it("数量都不精确但有最接近者 → 选最接近、不标歧义", () => {
    const r = chooseStoryForProject(5, [
      { id: 1, title: "A", bodyShotCount: 6, updatedAt: "2026-06-12" },
      { id: 2, title: "B", bodyShotCount: 11, updatedAt: "2026-06-13" },
    ]);
    expect(r.chosenStoryId).toBe(1); // 差1 vs 差6
    expect(r.ambiguous).toBe(false);
  });

  it("无故事 → null", () => {
    expect(chooseStoryForProject(3, []).chosenStoryId).toBeNull();
  });
});

describe("planBackfill + applyPlan", () => {
  const data = {
    shots: [
      { id: 1, projectId: 1, userId: 1, shotNo: "SH01" },
      { id: 2, projectId: 2, userId: 1, shotNo: "SH01" },
      { id: 3, projectId: 2, userId: 1, shotNo: "SH02" },
    ],
    stories: [
      { id: 10, projectId: 1, userId: 1, title: "P1", body: { shots: [1] }, updatedAt: "2026-06-12" },
      { id: 20, projectId: 2, userId: 1, title: "P2a", body: { shots: [1, 2] }, updatedAt: "2026-06-12" },
      { id: 21, projectId: 2, userId: 1, title: "P2b", body: { shots: [] }, updatedAt: "2026-06-13" },
    ],
  };

  it("project 2 的 2 条镜头归到 body.shots=2 的故事（数量启发式生效）", () => {
    const plan = planBackfill(structuredClone(data));
    const p2 = plan.find((a) => a.projectId === 2)!;
    expect(p2.chosenStoryId).toBe(20); // body.shots=2 命中，而非空壳的 21
  });

  it("applyPlan 给镜头写 storyId", () => {
    const d = structuredClone(data);
    applyPlan(d, planBackfill(d));
    expect(d.shots.find((s) => s.id === 1)!.storyId).toBe(10);
    expect(d.shots.filter((s) => s.projectId === 2).every((s) => s.storyId === 20)).toBe(true);
  });

  it("跨用户不污染：镜头 userId 与故事 userId 不一致时置 null 并告警", () => {
    const d = {
      shots: [{ id: 1, projectId: 1, userId: 2, shotNo: "SH01" }], // user 2 的镜头
      stories: [
        { id: 10, projectId: 1, userId: 1, title: "P1", body: { shots: [1] }, updatedAt: "2026-06-12" }, // user 1 的故事
      ],
    };
    const warnings = applyPlan(d, planBackfill(d));
    expect(d.shots[0].storyId).toBeNull();
    expect(warnings.length).toBe(1);
  });
});
