import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getStoryById: vi.fn(),
  updateStoryTimeline: vi.fn(),
}));

vi.mock("../db", () => dbMocks);

const materialMocks = vi.hoisted(() => ({
  getStoryMaterialState: vi.fn(),
}));

vi.mock("./storyMaterials", () => materialMocks);

const agentMocks = vi.hoisted(() => ({
  runJsonAgent: vi.fn(),
}));

vi.mock("./agentRuntime", () => agentMocks);

import { runTimelineEditCommand } from "./timelineEditAgent";

function item(stableShotId: string, position: number) {
  return {
    stableShotId,
    included: true,
    position,
    plannedDurationMs: 3000,
    transform: {
      cropX: 0,
      cropY: 0,
      cropWidth: 1,
      cropHeight: 1,
      zoom: 1,
      panX: 0,
      panY: 0,
    },
  };
}

function agentSays(payload: unknown) {
  agentMocks.runJsonAgent.mockResolvedValue({
    parsed: payload,
    modelLabel: "test",
    rawText: JSON.stringify(payload),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getStoryById.mockResolvedValue({ id: 7 });
  dbMocks.updateStoryTimeline.mockResolvedValue({});
  materialMocks.getStoryMaterialState.mockResolvedValue({
    timeline: {
      version: 3,
      items: [item("shot-a", 0), item("shot-b", 1), item("shot-c", 2)],
    },
    shots: [
      {
        stableShotId: "shot-a",
        shotNo: 1,
        currentVideo: { subtitle: "我害怕所有的事情" },
        currentImage: null,
      },
      {
        stableShotId: "shot-b",
        shotNo: 2,
        currentVideo: null,
        currentImage: { prompt: "画框中的背影" },
      },
      { stableShotId: "shot-c", shotNo: 3, currentVideo: null, currentImage: null },
    ],
  });
});

describe("runTimelineEditCommand", () => {
  it("不是剪辑意图时交还给普通聊天，不落库", async () => {
    agentSays({ isEditCommand: false });
    const result = await runTimelineEditCommand({
      storyId: 7,
      userId: 1,
      instruction: "今天有点难过",
    });
    expect(result.handled).toBe(false);
    expect(dbMocks.updateStoryTimeline).not.toHaveBeenCalled();
  });

  it("move+setDuration 组合：按序执行并以进场编号定位", async () => {
    agentSays({
      isEditCommand: true,
      operations: [
        { op: "move", entry: 3, toPosition: 1 },
        { op: "setDuration", entry: 1, seconds: 2.5 },
      ],
      reply: "把第三镜挪到开头，第一镜改成 2.5 秒",
    });
    const result = await runTimelineEditCommand({
      storyId: 7,
      userId: 1,
      instruction: "第三镜放最前面，第一镜给 2.5 秒",
    });
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.appliedCount).toBe(2);
    const call = dbMocks.updateStoryTimeline.mock.calls[0][0];
    expect(call.expectedVersion).toBe(3);
    const items = call.items as Array<{
      stableShotId: string;
      position: number;
      plannedDurationMs: number;
    }>;
    expect(items.map(i => i.stableShotId)).toEqual([
      "shot-c",
      "shot-a",
      "shot-b",
    ]);
    expect(items.map(i => i.position)).toEqual([0, 1, 2]);
    // entry=1 指进场编号的第一镜（shot-a），不受 move 影响
    expect(items.find(i => i.stableShotId === "shot-a")?.plannedDurationMs).toBe(
      2500
    );
  });

  it("remove 只翻 included，不物理删除；时长下限收口到 100ms", async () => {
    agentSays({
      isEditCommand: true,
      operations: [
        { op: "remove", entry: 2 },
        { op: "setDuration", entry: 3, seconds: 0.01 },
      ],
      reply: "删掉第二镜",
    });
    const result = await runTimelineEditCommand({
      storyId: 7,
      userId: 1,
      instruction: "第二镜不要了，第三镜越短越好",
    });
    expect(result.handled).toBe(true);
    const items = dbMocks.updateStoryTimeline.mock.calls[0][0].items as Array<{
      stableShotId: string;
      included: boolean;
      plannedDurationMs: number;
    }>;
    expect(items.find(i => i.stableShotId === "shot-b")?.included).toBe(false);
    expect(items).toHaveLength(3);
    expect(items.find(i => i.stableShotId === "shot-c")?.plannedDurationMs).toBe(
      100
    );
  });

  it("非法序号跳过并写进回复；全部无效时不落库", async () => {
    agentSays({
      isEditCommand: true,
      operations: [{ op: "remove", entry: 99 }],
      reply: "删掉那一镜",
    });
    const result = await runTimelineEditCommand({
      storyId: 7,
      userId: 1,
      instruction: "删掉第 99 镜",
    });
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.appliedCount).toBe(0);
    expect(result.reply).toContain("已跳过");
    expect(dbMocks.updateStoryTimeline).not.toHaveBeenCalled();
  });

  it("reorder 序号不完整时整步跳过", async () => {
    agentSays({
      isEditCommand: true,
      operations: [{ op: "reorder", order: [2, 1] }],
      reply: "重排",
    });
    const result = await runTimelineEditCommand({
      storyId: 7,
      userId: 1,
      instruction: "倒过来放",
    });
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.appliedCount).toBe(0);
    expect(dbMocks.updateStoryTimeline).not.toHaveBeenCalled();
  });
});
