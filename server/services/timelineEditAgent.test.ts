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

function currentImage(id: number, imageUrl: string, prompt: string) {
  return { id, imageUrl, prompt, availability: "available" };
}

function currentVideo(id: number, durationSec = 4) {
  return {
    id,
    status: "available",
    videoUrl: `/api/videos/take-${id}.mp4`,
    videoKey: `take-${id}.mp4`,
    durationSec,
    ranges: [],
    selectedRangeId: null,
    selectedSelectionType: "full_take",
    updatedAt: "2026-07-14T00:00:00.000Z",
    subtitle: `Take ${id}`,
  };
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
        currentImage: currentImage(
          101,
          "https://example.com/a.png",
          "女人回头"
        ),
      },
      {
        stableShotId: "shot-b",
        shotNo: 2,
        currentVideo: null,
        currentImage: currentImage(
          102,
          "https://example.com/b.png",
          "画框中的背影"
        ),
      },
      {
        stableShotId: "shot-c",
        shotNo: 3,
        currentVideo: null,
        currentImage: currentImage(
          103,
          "https://example.com/c.png",
          "红色树林"
        ),
      },
    ],
  });
});

describe("runTimelineEditCommand", () => {
  it("选中镜头说衔接时锁定当前与下一镜，只返回确认提案而不改时间轴", async () => {
    const result = await runTimelineEditCommand({
      storyId: 7,
      userId: 1,
      instruction: "让这个镜头快速转场到下一镜，人物转身后直接切过去",
      selectionContext: { stableShotId: "shot-a", shotNo: 1 },
    });

    expect(result.handled).toBe(true);
    if (!result.handled || !("proposal" in result) || !result.proposal) return;
    expect(result.appliedCount).toBe(0);
    expect(result.proposal).toMatchObject({
      storyId: 7,
      source: {
        stableShotId: "shot-a",
        shotNo: 1,
        imageId: 101,
        imageUrl: "https://example.com/a.png",
      },
      target: {
        stableShotId: "shot-b",
        shotNo: 2,
        imageId: 102,
        imageUrl: "https://example.com/b.png",
      },
      instruction: "让这个镜头快速转场到下一镜，人物转身后直接切过去",
      durationSec: 2,
      resolution: "720p",
      cutAtSec: 1.4,
      estimatedCredits: 10,
      estimatedCny: 0.35,
      expectedTimelineVersion: 3,
    });
    expect(result.proposal.candidateId).toMatch(/^transition-[a-f0-9]{16}$/);
    expect(result.proposal.provisionalStableShotId).toBe(
      result.proposal.candidateId.replace("transition-", "transition-shot-")
    );
    expect(result.proposal.prompt).toContain("人物转身后直接切过去");
    expect(agentMocks.runJsonAgent).not.toHaveBeenCalled();
    expect(dbMocks.updateStoryTimeline).not.toHaveBeenCalled();
  });

  it("只有采用视频时取前镜有效末帧和后镜首帧，并优先于旧主图", async () => {
    materialMocks.getStoryMaterialState.mockResolvedValueOnce({
      timeline: {
        version: 3,
        items: [item("shot-a", 0), item("shot-b", 1)],
      },
      shots: [
        {
          stableShotId: "shot-a",
          shotNo: 14,
          currentVideo: currentVideo(1260, 5.2),
          currentImage: currentImage(
            101,
            "https://example.com/old-a.png",
            "旧图"
          ),
        },
        {
          stableShotId: "shot-b",
          shotNo: 15,
          currentVideo: currentVideo(1261, 8),
          currentImage: null,
        },
      ],
    });

    const result = await runTimelineEditCommand({
      storyId: 7,
      userId: 1,
      instruction: "让这个镜头和下一镜快速衔接",
      selectionContext: { stableShotId: "shot-a", shotNo: 14 },
    });

    expect(result.handled).toBe(true);
    if (!result.handled || !("proposal" in result) || !result.proposal) return;
    expect(result.proposal.source).toMatchObject({
      mediaKind: "video",
      videoTakeId: 1260,
      selectionType: "full_take",
      rangeId: null,
    });
    expect(result.proposal.source.imageUrl).toContain(
      "/api/video-frames/1260?atSec=2.967"
    );
    expect(result.proposal.target).toMatchObject({
      mediaKind: "video",
      videoTakeId: 1261,
      atSec: 0,
    });
    expect(result.proposal.target.imageUrl).toContain(
      "/api/video-frames/1261?atSec=0.000"
    );
    expect(agentMocks.runJsonAgent).not.toHaveBeenCalled();
    expect(dbMocks.updateStoryTimeline).not.toHaveBeenCalled();
  });

  it("锁定的相邻镜头缺当前主图时明确拒绝，但仍视为已处理且不落库", async () => {
    materialMocks.getStoryMaterialState.mockResolvedValueOnce({
      timeline: {
        version: 3,
        items: [item("shot-a", 0), item("shot-b", 1)],
      },
      shots: [
        {
          stableShotId: "shot-a",
          shotNo: 1,
          cueCode: "0101",
          currentVideo: null,
          currentImage: currentImage(101, "https://example.com/a.png", "首帧"),
        },
        {
          stableShotId: "shot-b",
          shotNo: 2,
          cueCode: "0102",
          currentVideo: null,
          currentImage: null,
        },
      ],
    });

    const result = await runTimelineEditCommand({
      storyId: 7,
      userId: 1,
      instruction: "把这两个镜头做一个衔接",
      selectionContext: { stableShotId: "shot-a", shotNo: 1 },
    });

    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.appliedCount).toBe(0);
    expect("proposal" in result && result.proposal).toBeFalsy();
    expect(result.reply).toContain("0102");
    expect(result.reply).not.toContain("SH02");
    expect(result.reply).toContain("不会调用模型或改时间轴");
    expect(agentMocks.runJsonAgent).not.toHaveBeenCalled();
    expect(dbMocks.updateStoryTimeline).not.toHaveBeenCalled();
  });

  it("规则没有直接命中时允许 JSON agent 补充相邻镜头提案", async () => {
    agentSays({
      isEditCommand: true,
      operations: [],
      transitionProposal: {
        sourceEntry: 2,
        targetEntry: 3,
        prompt: "用一次快速甩镜完成画面承接",
      },
      reply: "先确认第二段到第三段的承接",
    });

    const result = await runTimelineEditCommand({
      storyId: 7,
      userId: 1,
      instruction: "让第二段自然接上第三段",
    });

    expect(result.handled).toBe(true);
    if (!result.handled || !("proposal" in result) || !result.proposal) return;
    expect(result.proposal.source.stableShotId).toBe("shot-b");
    expect(result.proposal.target.stableShotId).toBe("shot-c");
    expect(result.proposal.prompt).toContain("快速甩镜");
    expect(agentMocks.runJsonAgent).toHaveBeenCalledOnce();
    expect(dbMocks.updateStoryTimeline).not.toHaveBeenCalled();
  });

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
    expect("proposal" in result && result.proposal).toBeFalsy();
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
    expect(
      items.find(i => i.stableShotId === "shot-a")?.plannedDurationMs
    ).toBe(2500);
  });

  it("带“切到”的明确移位表达仍走原 move 操作，不误判为转场", async () => {
    agentSays({
      isEditCommand: true,
      operations: [{ op: "move", entry: 2, toPosition: 1 }],
      reply: "把第二镜移到第一镜前面",
    });
    const result = await runTimelineEditCommand({
      storyId: 7,
      userId: 1,
      instruction: "把第二镜切到第一镜前面",
      selectionContext: { stableShotId: "shot-b", shotNo: 2 },
    });

    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.appliedCount).toBe(1);
    expect("proposal" in result && result.proposal).toBeFalsy();
    expect(dbMocks.updateStoryTimeline).toHaveBeenCalledOnce();
    expect(
      dbMocks.updateStoryTimeline.mock.calls[0][0].items.map(
        (entry: { stableShotId: string }) => entry.stableShotId
      )
    ).toEqual(["shot-b", "shot-a", "shot-c"]);
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
    expect(
      items.find(i => i.stableShotId === "shot-c")?.plannedDurationMs
    ).toBe(100);
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

  it("选中主视频后直接执行倍速和倒放，不调用通用 JSON agent", async () => {
    const take = {
      ...currentVideo(51, 4),
      isTimelineSelected: true,
      stableShotId: "shot-a",
    };
    materialMocks.getStoryMaterialState.mockResolvedValueOnce({
      timeline: { version: 3, items: [item("shot-a", 0)] },
      shots: [
        {
          stableShotId: "shot-a",
          shotNo: 1,
          currentVideo: take,
          videoTakes: [take],
          currentImage: null,
        },
      ],
    });

    const result = await runTimelineEditCommand({
      storyId: 7,
      userId: 1,
      instruction: "把选中的视频改成 0.5 倍并倒放",
      selectionContext: {
        sourceType: "animatic-video",
        sourceId: "51",
        stableShotId: "shot-a",
        shotNo: 1,
        videoTakeId: 51,
        rangeId: null,
        selection: { kind: "time", startSec: 0, endSec: 4 },
      },
    });

    expect(result).toMatchObject({ handled: true, appliedCount: 1 });
    expect(agentMocks.runJsonAgent).not.toHaveBeenCalled();
    const saved = dbMocks.updateStoryTimeline.mock.calls[0][0].items[0];
    expect(saved.plannedDurationMs).toBe(8_000);
    expect(saved.primaryVideoEdit).toMatchObject({
      takeId: 51,
      sourceStartSec: 0,
      sourceEndSec: 4,
      effects: { playbackRate: 0.5, reverse: true },
    });
  });

  it("选中时间线切片后只修改该切片并向后波纹移动", async () => {
    const timelineItem = {
      ...item("shot-a", 0),
      plannedDurationMs: 4_000,
      visualClipsReplacePrimary: true,
      visualClips: [
        {
          id: "clip-a",
          takeId: 61,
          rangeId: 1,
          sourceStableShotId: "shot-a",
          videoUrl: "/api/videos/61",
          label: "前段",
          sourceStartSec: 0,
          sourceEndSec: 2,
          offsetMs: 0,
          durationMs: 2_000,
        },
        {
          id: "clip-b",
          takeId: 61,
          rangeId: 2,
          sourceStableShotId: "shot-a",
          videoUrl: "/api/videos/61",
          label: "后段",
          sourceStartSec: 2,
          sourceEndSec: 4,
          offsetMs: 2_000,
          durationMs: 2_000,
        },
      ],
    };
    materialMocks.getStoryMaterialState.mockResolvedValueOnce({
      timeline: { version: 3, items: [timelineItem] },
      shots: [
        {
          stableShotId: "shot-a",
          shotNo: 1,
          currentVideo: null,
          videoTakes: [],
          currentImage: null,
        },
      ],
    });

    const result = await runTimelineEditCommand({
      storyId: 7,
      userId: 1,
      instruction: "这段改成 2 倍速并静音",
      selectionContext: {
        sourceType: "timeline-range",
        sourceId: "clip-a",
        stableShotId: "shot-a",
        shotNo: 1,
        videoTakeId: 61,
        rangeId: 1,
        selection: { kind: "time", startSec: 0, endSec: 2 },
      },
    });

    expect(result).toMatchObject({ handled: true, appliedCount: 1 });
    const saved = dbMocks.updateStoryTimeline.mock.calls[0][0].items[0];
    expect(saved.plannedDurationMs).toBe(3_000);
    expect(saved.visualClips).toMatchObject([
      {
        id: "clip-a",
        durationMs: 1_000,
        effects: { playbackRate: 2, muted: true },
      },
      { id: "clip-b", offsetMs: 1_000, durationMs: 2_000 },
    ]);
    expect(agentMocks.runJsonAgent).not.toHaveBeenCalled();
  });
});
