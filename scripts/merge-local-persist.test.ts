import { describe, expect, it } from "vitest";

import { contentHash, mergePersist, type PersistData } from "./merge-local-persist";

/** 最小持久化文件夹具 */
function persist(partial: Partial<PersistData>): PersistData {
  const empty: PersistData = {
    users: [],
    projects: [],
    references: [],
    shots: [],
    analysisResults: [],
    emotionAnalysisProfiles: [],
    stories: [],
    editSnapshots: [],
    semanticAnnotations: [],
    generatedImages: [],
    imageSignals: [],
    nextIds: {},
  };
  return { ...empty, ...partial };
}

describe("contentHash", () => {
  it("键序无关：不同键序的同内容对象哈希相同", () => {
    expect(contentHash({ a: 1, b: "x" })).toBe(contentHash({ b: "x", a: 1 }));
  });
  it("内容不同则哈希不同", () => {
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
  });
});

describe("mergePersist", () => {
  it("happy path: id 冲突的不同故事各自保留并重新编号，外键随项目重映射", () => {
    // 两个源的 project 与 story 都用 id=1，但内容不同 → 必须都保留
    const a = persist({
      projects: [{ id: 1, userId: null, name: "项目甲", createdAt: "2026-06-02" }],
      stories: [{ id: 1, userId: null, projectId: 1, title: "听到鸟叫", body: "A", createdAt: "2026-06-02" }],
    });
    const b = persist({
      projects: [{ id: 1, userId: null, name: "项目乙", createdAt: "2026-06-12" }],
      stories: [{ id: 1, userId: null, projectId: 1, title: "手机端回忆", body: "B", createdAt: "2026-06-12" }],
    });
    const { merged, report } = mergePersist([
      { label: "main", data: a },
      { label: "ab", data: b },
    ]);
    const stories = merged.stories as Record<string, unknown>[];
    const projects = merged.projects as Record<string, unknown>[];
    expect(projects).toHaveLength(2);
    expect(stories).toHaveLength(2);
    // 新 id 不冲突
    expect(new Set(stories.map((s) => s.id)).size).toBe(2);
    // 故事乙的 projectId 必须指向「项目乙」的新 id
    const storyB = stories.find((s) => s.title === "手机端回忆")!;
    const projB = projects.find((p) => p.name === "项目乙")!;
    expect(storyB.projectId).toBe(projB.id);
    expect(report.storyInventory.map((s) => s.title)).toEqual(["听到鸟叫", "手机端回忆"]);
  });

  it("dedupe: 内容完全相同的故事跨源去重（副本环境不会造成重复）", () => {
    const story = { id: 3, userId: null, projectId: null, title: "同一篇", body: "X", createdAt: "2026-06-12" };
    const { merged, report } = mergePersist([
      { label: "ab", data: persist({ stories: [story] }) },
      { label: "tmp-deploy", data: persist({ stories: [{ ...story, id: 9 }] }) },
    ]);
    expect(merged.stories as unknown[]).toHaveLength(1);
    expect(report.dedupedCounts.stories).toBe(1);
  });

  it("self-FK: editSnapshots 链条（previousSnapshotId）重映射后仍然连续", () => {
    const src = persist({
      projects: [{ id: 7, userId: null, name: "P" }],
      editSnapshots: [
        { id: 10, projectId: 7, sessionId: "s", state: "a", previousSnapshotId: null, diff: "", timestamp: 1 },
        { id: 11, projectId: 7, sessionId: "s", state: "b", previousSnapshotId: 10, diff: "d", timestamp: 2 },
      ],
    });
    const { merged } = mergePersist([
      { label: "x", data: src },
      { label: "y", data: persist({}) },
    ]);
    const snaps = merged.editSnapshots as Record<string, unknown>[];
    const first = snaps.find((s) => s.state === "a")!;
    const second = snaps.find((s) => s.state === "b")!;
    expect(second.previousSnapshotId).toBe(first.id);
  });

  it("error path: 孤儿外键（引用表非空但目标缺失）置 null 并告警，不丢整行", () => {
    const src = persist({
      stories: [{ id: 1, userId: null, projectId: 999, title: "孤儿", body: "", createdAt: "t" }],
    });
    const other = persist({
      projects: [{ id: 1, userId: null, name: "存在的项目" }],
    });
    const { merged, report } = mergePersist([
      { label: "y", data: other },
      { label: "x", data: src },
    ]);
    const stories = merged.stories as Record<string, unknown>[];
    expect(stories).toHaveLength(1);
    expect(stories[0].projectId).toBeNull();
    expect(report.warnings.some((w) => w.includes("projectId=999"))).toBe(true);
  });

  it("隐式实体: users 表全空时 userId 原样保留（不置 null、不重映射）", () => {
    const src = persist({
      stories: [{ id: 1, userId: 1, projectId: null, title: "T", body: "", createdAt: "t" }],
    });
    const { merged, report } = mergePersist([
      { label: "x", data: src },
      { label: "y", data: persist({}) },
    ]);
    const stories = merged.stories as Record<string, unknown>[];
    expect(stories[0].userId).toBe(1);
    expect(report.warnings.some((w) => w.includes("原样保留"))).toBe(true);
  });

  it("分叉副本: createdAt 相同但内容不同的故事保留双版本并进 nearDuplicates 报告", () => {
    const base = { id: 1, userId: null, projectId: null, title: "同源故事", createdAt: "2026-06-12T03:57:34.229Z" };
    const { merged, report } = mergePersist([
      { label: "ab", data: persist({ stories: [{ ...base, body: "v1", updatedAt: "t1" }] }) },
      { label: "tmp", data: persist({ stories: [{ ...base, body: "v2-diverged", updatedAt: "t2" }] }) },
    ]);
    expect(merged.stories as unknown[]).toHaveLength(2);
    expect(report.nearDuplicates).toHaveLength(1);
    expect(report.nearDuplicates[0].versions.map((v) => v.from).sort()).toEqual(["ab", "tmp"]);
  });

  it("nextIds 重算为各表 max+1", () => {
    const { merged } = mergePersist([
      { label: "a", data: persist({ stories: [{ id: 5, userId: null, projectId: null, title: "t", body: "", createdAt: "c" }] }) },
      { label: "b", data: persist({}) },
    ]);
    expect((merged.nextIds as Record<string, number>).story).toBe(2);
  });

  it("未知顶层键透传并告警，不静默丢数据", () => {
    const src = persist({});
    (src as Record<string, unknown>)["futureTable"] = [{ id: 1 }];
    const { merged, report } = mergePersist([
      { label: "x", data: src },
      { label: "y", data: persist({}) },
    ]);
    expect(merged.futureTable).toEqual([{ id: 1 }]);
    expect(report.warnings.some((w) => w.includes("futureTable"))).toBe(true);
  });
});
