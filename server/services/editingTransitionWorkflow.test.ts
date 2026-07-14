import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoTake } from "../../drizzle/schema";
import type { StoryTimelineItem } from "../../shared/storyMaterial";
import type { TimelineTransitionCandidate } from "./timelineEditAgent";

const dbMocks = vi.hoisted(() => ({
  claimEditingTransitionSubmission: vi.fn(),
  createVideoTakeIdempotently: vi.fn(),
  findVideoTakeByIdempotencyKey: vi.fn(),
  getStoryById: vi.fn(),
  insertTransitionShotAtomic: vi.fn(),
  updateVideoTake: vi.fn(),
}));

vi.mock("../db", () => dbMocks);

const materialMocks = vi.hoisted(() => ({
  getStoryMaterialState: vi.fn(),
}));

vi.mock("./storyMaterials", () => materialMocks);

const imageMocks = vi.hoisted(() => ({
  getStoryImageAssets: vi.fn(),
  materializeImageInput: vi.fn(),
}));

vi.mock("./imageAssets", () => imageMocks);

const conformMocks = vi.hoisted(() => ({
  probeVideoFileMetadata: vi.fn(),
}));

vi.mock("./videoConform", () => conformMocks);

const timelineMocks = vi.hoisted(() => ({
  selectVideoTimelineSegment: vi.fn(),
}));

vi.mock("./videoTimeline", () => timelineMocks);

vi.mock("./videoMedia", () => ({
  localVideoDir: () => "/tmp/editing-transition-workflow-test",
}));

const videoMocks = vi.hoisted(() => {
  class MockViduSubmissionError extends Error {
    submissionState: "not_submitted" | "unknown";

    constructor(
      message: string,
      submissionState: "not_submitted" | "unknown"
    ) {
      super(message);
      this.name = "ViduSubmissionError";
      this.submissionState = submissionState;
    }
  }

  return {
    downloadVideoToFile: vi.fn(),
    hardCutToLastFrame: vi.fn(),
    submitViduTransition: vi.fn(),
    uploadFileToVidu: vi.fn(),
    waitForViduTransition: vi.fn(),
    ViduSubmissionError: MockViduSubmissionError,
  };
});

vi.mock("./videoTransition302", () => videoMocks);

import {
  confirmEditingTransition,
  editingTransitionRuntime,
} from "./editingTransitionWorkflow";

const USER_ID = 11;
const STORY_ID = 91;

let storedTake: VideoTake | null;

function timelineItem(
  stableShotId: string,
  position: number
): StoryTimelineItem {
  return {
    stableShotId,
    included: true,
    position,
    plannedDurationMs: 3_000,
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

function candidate(
  suffix = "0123456789abcdef"
): TimelineTransitionCandidate {
  const candidateId = `transition-${suffix}`;
  return {
    candidateId,
    provisionalStableShotId: `transition-shot-${suffix}`,
    storyId: STORY_ID,
    source: {
      stableShotId: "shot-a",
      shotNo: 1,
      imageId: 101,
      imageUrl: "https://example.test/a.png",
    },
    target: {
      stableShotId: "shot-b",
      shotNo: 2,
      imageId: 102,
      imageUrl: "https://example.test/b.png",
    },
    instruction: "女人快速转身，然后准确切到下一镜",
    prompt: "Keep the same woman and oil-paint texture during a fast turn.",
    durationSec: 2,
    resolution: "720p",
    cutAtSec: 1.4,
    estimatedCredits: 10,
    estimatedCny: 0.35,
    expectedTimelineVersion: 3,
  };
}

function storyBody() {
  return {
    _revision: 8,
    shots: [
      {
        stableShotId: "shot-a",
        shotIdentity: "shot-a",
        shotKey: "shot-a",
        shotNo: 1,
        sceneNo: "SC01",
        subject: "女人侧身",
      },
      {
        stableShotId: "shot-b",
        shotIdentity: "shot-b",
        shotKey: "shot-b",
        shotNo: 2,
        sceneNo: "SC01",
        subject: "女人回头",
      },
    ],
  };
}

function materialState() {
  return {
    storyId: STORY_ID,
    timeline: {
      storyId: STORY_ID,
      version: 3,
      items: [timelineItem("shot-a", 0), timelineItem("shot-b", 1)],
    },
    shots: [
      {
        stableShotId: "shot-a",
        shotNo: 1,
        currentImage: {
          id: 101,
          imageUrl: "https://example.test/a.png",
          prompt: "女人侧身",
          availability: "available",
        },
      },
      {
        stableShotId: "shot-b",
        shotNo: 2,
        currentImage: {
          id: 102,
          imageUrl: "https://example.test/b.png",
          prompt: "女人回头",
          availability: "available",
        },
      },
    ],
    unassignedImages: [],
    unassignedVideoTakes: [],
    reusableVideoTakes: [],
  };
}

function currentVideo(id: number) {
  return {
    id,
    status: "available",
    videoUrl: `/api/videos/take-${id}.mp4`,
    videoKey: `take-${id}.mp4`,
    durationSec: 8,
    ranges: [],
    selectedRangeId: null,
    selectedSelectionType: "full_take",
    updatedAt: "2026-07-14T00:00:00.000Z",
  };
}

function videoMaterialState() {
  const state = materialState();
  return {
    ...state,
    shots: [
      {
        stableShotId: "shot-a",
        shotNo: 1,
        currentImage: null,
        currentVideo: currentVideo(201),
      },
      {
        stableShotId: "shot-b",
        shotNo: 2,
        currentImage: null,
        currentVideo: currentVideo(202),
      },
    ],
  };
}

function videoCandidate(): TimelineTransitionCandidate {
  return {
    ...candidate(),
    source: {
      mediaKind: "video",
      stableShotId: "shot-a",
      shotNo: 1,
      videoTakeId: 201,
      rangeId: null,
      selectionType: "full_take",
      atSec: 3 - 1 / 30,
      mediaRevision:
        "201:take-201.mp4:2026-07-14T00:00:00.000Z:full_take:full:0.000:3.000",
      imageUrl: "/api/video-frames/201?atSec=2.967",
    },
    target: {
      mediaKind: "video",
      stableShotId: "shot-b",
      shotNo: 2,
      videoTakeId: 202,
      rangeId: null,
      selectionType: "full_take",
      atSec: 0,
      mediaRevision:
        "202:take-202.mp4:2026-07-14T00:00:00.000Z:full_take:full:0.000:3.000",
      imageUrl: "/api/video-frames/202?atSec=0.000",
    },
  };
}

function videoTake(
  overrides: Partial<VideoTake> = {}
): VideoTake {
  const current = new Date("2026-07-14T00:00:00.000Z");
  const { parameterSnapshot, ...restOverrides } = overrides;
  return {
    id: 41,
    storyId: STORY_ID,
    userId: USER_ID,
    stableShotId: "transition-shot-0123456789abcdef",
    sourceImageId: 101,
    promptCompilationId: null,
    status: "submitted",
    taskId: null,
    provider: "302",
    model: "viduq2-turbo",
    prompt: "Keep the same woman and oil-paint texture during a fast turn.",
    subtitle: "女人快速转身，然后准确切到下一镜",
    durationSec: 2,
    aspectRatio: "1:1",
    videoKey: null,
    videoUrl: null,
    errorMessage: null,
    parameterSnapshot: {
      kind: "editing-transition",
      candidate: candidate(),
      submissionState: "not_started",
      appliedToTimeline: false,
      ...(parameterSnapshot && typeof parameterSnapshot === "object"
        ? parameterSnapshot
        : {}),
    },
    idempotencyKey:
      "editing-transition:transition-0123456789abcdef",
    extractionCapability: "unavailable",
    createdAt: current,
    updatedAt: current,
    ...restOverrides,
  };
}

function preparedFrames() {
  return {
    temporaryDir: "/tmp/editing-transition-workflow-test/frames",
    firstFrame: {
      bytes: new Uint8Array([1]),
      contentType: "image/png",
      path: "/tmp/editing-transition-workflow-test/first.png",
    },
    lastFrame: {
      bytes: new Uint8Array([2]),
      contentType: "image/png",
      path: "/tmp/editing-transition-workflow-test/last.png",
    },
    cleanup: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  storedTake = null;

  dbMocks.findVideoTakeByIdempotencyKey.mockImplementation(async () =>
    storedTake ? { ...storedTake } : null
  );
  dbMocks.createVideoTakeIdempotently.mockImplementation(async input => {
    storedTake = videoTake({
      ...input,
      id: 41,
      createdAt: new Date("2026-07-14T00:00:00.000Z"),
      updatedAt: new Date("2026-07-14T00:00:00.000Z"),
    });
    return { take: storedTake, created: true };
  });
  dbMocks.claimEditingTransitionSubmission.mockImplementation(async () => {
    if (!storedTake) throw new Error("missing take");
    storedTake = videoTake({
      ...storedTake,
      parameterSnapshot: {
        ...((storedTake.parameterSnapshot ?? {}) as Record<string, unknown>),
        submissionState: "submitting",
      },
    });
    return { claimed: true, take: storedTake };
  });
  dbMocks.updateVideoTake.mockImplementation(async (_id, _userId, patch) => {
    if (!storedTake) return null;
    storedTake = { ...storedTake, ...patch, updatedAt: new Date() };
    return storedTake;
  });
  dbMocks.getStoryById.mockResolvedValue({
    id: STORY_ID,
    userId: USER_ID,
    body: storyBody(),
  });
  dbMocks.insertTransitionShotAtomic.mockImplementation(async input => ({
    applied: true,
    story: {
      id: STORY_ID,
      userId: USER_ID,
      body: input.nextStoryBody,
    },
    timeline: {
      id: 12,
      storyId: STORY_ID,
      userId: USER_ID,
      version: input.expectedTimelineVersion + 1,
      items: input.nextTimelineItems,
    },
  }));

  materialMocks.getStoryMaterialState.mockResolvedValue(materialState());
  conformMocks.probeVideoFileMetadata.mockResolvedValue({
    width: 720,
    height: 720,
    durationSec: 2,
  });
  timelineMocks.selectVideoTimelineSegment.mockResolvedValue({});
  videoMocks.uploadFileToVidu
    .mockResolvedValueOnce("ssupload:?id=first")
    .mockResolvedValueOnce("ssupload:?id=last");
  videoMocks.submitViduTransition.mockResolvedValue({
    taskId: "vidu-task-1",
    submitUrl: "https://api.302.ai/vidu/v2/img2video",
    submittedParameters: { model: "viduq2-turbo" },
  });
  videoMocks.waitForViduTransition.mockResolvedValue({
    status: "available",
    videoUrl: "https://cdn.example.test/transition.mp4",
  });
  videoMocks.downloadVideoToFile.mockResolvedValue(undefined);
  videoMocks.hardCutToLastFrame.mockResolvedValue(undefined);

  vi.spyOn(
    editingTransitionRuntime,
    "prepareCandidateFrames"
  ).mockImplementation(async () => preparedFrames());
  vi.spyOn(
    editingTransitionRuntime,
    "persistDurableLastFrame"
  ).mockResolvedValue(
    "/tmp/editing-transition-workflow-test/take-41.transition-last.png"
  );
  vi.spyOn(
    editingTransitionRuntime,
    "findDurableLastFrame"
  ).mockResolvedValue(
    "/tmp/editing-transition-workflow-test/take-41.transition-last.png"
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("confirmEditingTransition", () => {
  it("首次确认只提交一次，并把生成结果插入两镜之间", async () => {
    const result = await confirmEditingTransition(candidate(), USER_ID);

    expect(result).toMatchObject({
      status: "applied",
      takeId: 41,
      insertedStableShotId: "transition-shot-0123456789abcdef",
      timelineVersion: 4,
      videoUrl: "/api/videos/take-41.mp4",
    });
    if (result.status !== "applied") return;
    expect(result.storyShots.map(shot => shot.stableShotId)).toEqual([
      "shot-a",
      "transition-shot-0123456789abcdef",
      "shot-b",
    ]);
    expect(dbMocks.createVideoTakeIdempotently).toHaveBeenCalledOnce();
    expect(dbMocks.claimEditingTransitionSubmission).toHaveBeenCalledOnce();
    expect(videoMocks.uploadFileToVidu).toHaveBeenCalledTimes(2);
    expect(videoMocks.submitViduTransition).toHaveBeenCalledOnce();
    expect(videoMocks.waitForViduTransition).toHaveBeenCalledWith(
      "vidu-task-1"
    );
    expect(videoMocks.downloadVideoToFile).toHaveBeenCalledOnce();
    expect(videoMocks.hardCutToLastFrame).toHaveBeenCalledOnce();
    expect(dbMocks.insertTransitionShotAtomic).toHaveBeenCalledOnce();
    expect(timelineMocks.selectVideoTimelineSegment).toHaveBeenCalledWith(
      {
        storyId: STORY_ID,
        stableShotId: "transition-shot-0123456789abcdef",
        takeId: 41,
        selectionType: "full_take",
      },
      USER_ID
    );
  });

  it("视频端点按当前 Take 重新校验，且不伪造 sourceImageId", async () => {
    materialMocks.getStoryMaterialState.mockResolvedValue(videoMaterialState());

    const result = await confirmEditingTransition(videoCandidate(), USER_ID);

    expect(result.status).toBe("applied");
    expect(dbMocks.createVideoTakeIdempotently).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceImageId: null,
        parameterSnapshot: expect.objectContaining({
          candidate: expect.objectContaining({
            source: expect.objectContaining({
              mediaKind: "video",
              videoTakeId: 201,
            }),
            target: expect.objectContaining({
              mediaKind: "video",
              videoTakeId: 202,
            }),
          }),
        }),
      })
    );
    expect(videoMocks.submitViduTransition).toHaveBeenCalledOnce();
  });

  it("相同 candidate 已有 available take 时直接应用，不重新提交 302", async () => {
    storedTake = videoTake({
      status: "available",
      taskId: "vidu-task-existing",
      videoKey: "take-41.mp4",
      videoUrl: "/api/videos/take-41.mp4",
      extractionCapability: "available",
      parameterSnapshot: {
        kind: "editing-transition",
        submissionState: "accepted",
        appliedToTimeline: false,
      },
    });

    const result = await confirmEditingTransition(candidate(), USER_ID);

    expect(result.status).toBe("applied");
    expect(dbMocks.createVideoTakeIdempotently).not.toHaveBeenCalled();
    expect(videoMocks.uploadFileToVidu).not.toHaveBeenCalled();
    expect(videoMocks.submitViduTransition).not.toHaveBeenCalled();
    expect(videoMocks.waitForViduTransition).not.toHaveBeenCalled();
    expect(videoMocks.downloadVideoToFile).not.toHaveBeenCalled();
    expect(videoMocks.hardCutToLastFrame).not.toHaveBeenCalled();
    expect(
      editingTransitionRuntime.prepareCandidateFrames
    ).not.toHaveBeenCalled();
    expect(dbMocks.insertTransitionShotAtomic).toHaveBeenCalledOnce();
  });

  it("submissionState unknown 且无 taskId 时禁止自动重提", async () => {
    storedTake = videoTake({
      status: "unfollowable",
      taskId: null,
      errorMessage: "302 返回状态未知",
      parameterSnapshot: {
        kind: "editing-transition",
        submissionState: "unknown",
        appliedToTimeline: false,
      },
    });

    const result = await confirmEditingTransition(candidate(), USER_ID);

    expect(result).toMatchObject({
      status: "error",
      takeId: 41,
      retryable: false,
      submissionUnknown: true,
    });
    expect(videoMocks.uploadFileToVidu).not.toHaveBeenCalled();
    expect(videoMocks.submitViduTransition).not.toHaveBeenCalled();
    expect(videoMocks.waitForViduTransition).not.toHaveBeenCalled();
    expect(
      editingTransitionRuntime.prepareCandidateFrames
    ).not.toHaveBeenCalled();
    expect(dbMocks.insertTransitionShotAtomic).not.toHaveBeenCalled();
  });

  it("并发确认同一 candidate 时共享同一 Promise，且只付费提交一次", async () => {
    const currentCandidate = candidate("fedcba9876543210");
    const first = confirmEditingTransition(currentCandidate, USER_ID);
    const second = confirmEditingTransition(currentCandidate, USER_ID);

    expect(first).toBe(second);
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toEqual(secondResult);
    expect(firstResult.status).toBe("applied");
    expect(dbMocks.findVideoTakeByIdempotencyKey).toHaveBeenCalledOnce();
    expect(dbMocks.createVideoTakeIdempotently).toHaveBeenCalledOnce();
    expect(videoMocks.uploadFileToVidu).toHaveBeenCalledTimes(2);
    expect(videoMocks.submitViduTransition).toHaveBeenCalledOnce();
    expect(videoMocks.waitForViduTransition).toHaveBeenCalledOnce();
    expect(dbMocks.insertTransitionShotAtomic).toHaveBeenCalledOnce();
  });

  it("已有 taskId 的查询异常保持为可续查状态，不重新提交", async () => {
    storedTake = videoTake({
      status: "processing",
      taskId: "vidu-task-existing",
      parameterSnapshot: {
        kind: "editing-transition",
        candidate: candidate(),
        submissionState: "accepted",
      },
    });
    videoMocks.waitForViduTransition.mockResolvedValueOnce({
      status: "query_error",
      taskId: "vidu-task-existing",
      message: "供应商暂时没有返回 creation",
    });

    const result = await confirmEditingTransition(candidate(), USER_ID);

    expect(result).toMatchObject({
      status: "processing",
      takeId: 41,
      taskId: "vidu-task-existing",
    });
    expect(videoMocks.submitViduTransition).not.toHaveBeenCalled();
    expect(videoMocks.waitForViduTransition).toHaveBeenCalledWith(
      "vidu-task-existing"
    );
  });

  it("供应商已返回 taskId 但首次持久化失败时，保存同一任务并禁止重提", async () => {
    let failedOnce = false;
    dbMocks.updateVideoTake.mockImplementation(async (_id, _userId, patch) => {
      if (
        !failedOnce &&
        patch.status === "processing" &&
        patch.taskId === "vidu-task-1"
      ) {
        failedOnce = true;
        throw new Error("local persist busy");
      }
      if (!storedTake) return null;
      storedTake = { ...storedTake, ...patch, updatedAt: new Date() };
      return storedTake;
    });

    const result = await confirmEditingTransition(candidate(), USER_ID);

    expect(result).toMatchObject({
      status: "processing",
      takeId: 41,
      taskId: "vidu-task-1",
    });
    expect(videoMocks.submitViduTransition).toHaveBeenCalledOnce();
    expect(storedTake).toMatchObject({
      taskId: "vidu-task-1",
      status: "processing",
    });
    expect(videoMocks.waitForViduTransition).not.toHaveBeenCalled();
  });

  it("未取得数据库 claim 时返回 processing，且绝不调用付费提交", async () => {
    dbMocks.claimEditingTransitionSubmission.mockImplementationOnce(
      async () => {
        if (!storedTake) throw new Error("missing take");
        storedTake = videoTake({
          ...storedTake,
          parameterSnapshot: {
            ...((storedTake.parameterSnapshot ?? {}) as Record<
              string,
              unknown
            >),
            submissionState: "submitting",
          },
        });
        return {
          claimed: false,
          take: storedTake,
          reason: "already_claimed",
        };
      }
    );

    const result = await confirmEditingTransition(candidate(), USER_ID);

    expect(result).toMatchObject({
      status: "processing",
      takeId: 41,
    });
    expect(videoMocks.uploadFileToVidu).not.toHaveBeenCalled();
    expect(videoMocks.submitViduTransition).not.toHaveBeenCalled();
    expect(editingTransitionRuntime.prepareCandidateFrames).not.toHaveBeenCalled();
  });

  it("take 状态更新返回空值时 fail closed，不得调用 302 submit", async () => {
    dbMocks.updateVideoTake.mockResolvedValue(null);

    await expect(
      confirmEditingTransition(candidate(), USER_ID)
    ).rejects.toThrow("状态持久化失败");

    expect(videoMocks.submitViduTransition).not.toHaveBeenCalled();
  });
});
