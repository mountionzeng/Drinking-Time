import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV } from "../_core/env";
import {
  createImageSignal,
  createGeneratedImage,
  createStory,
  createVideoTake,
  getStoryVideoTakes,
  resetMemoryStateForTesting,
} from "../db";
import {
  explainVideoProviderError,
  isUnknownVideoSubmissionFailure,
  refreshVideoTakeStatus,
  sanitizeVideoPrompt,
  startShotVideoJob,
} from "./videoJobs";
import { migrateStoryPromptLineage } from "./promptLineageMigration";
import { getStoryPromptProjection } from "./promptLineage";

const saved = {
  api302Key: ENV.api302Key,
  api302BaseUrl: ENV.api302BaseUrl,
  databaseUrl: ENV.databaseUrl,
  video302Model: ENV.video302Model,
  video302SubmitPath: ENV.video302SubmitPath,
  video302PollPath: ENV.video302PollPath,
  video302ImageField: ENV.video302ImageField,
  video302Motion: ENV.video302Motion,
  videoPrompt302Model: ENV.videoPrompt302Model,
  videoPrompt302TimeoutMs: ENV.videoPrompt302TimeoutMs,
};

beforeEach(() => {
  resetMemoryStateForTesting();
  ENV.databaseUrl = "";
  ENV.api302Key = "test-302-key";
  ENV.api302BaseUrl = "https://api.302.ai";
  ENV.video302Model = "test-video-model";
  ENV.video302SubmitPath = "/302/submit/{model}";
  ENV.video302PollPath = "";
  ENV.video302ImageField = "image_url";
  ENV.video302Motion = "low";
  ENV.videoPrompt302Model = "";
  ENV.videoPrompt302TimeoutMs = "30000";
});

afterEach(() => {
  ENV.api302Key = saved.api302Key;
  ENV.api302BaseUrl = saved.api302BaseUrl;
  ENV.databaseUrl = saved.databaseUrl;
  ENV.video302Model = saved.video302Model;
  ENV.video302SubmitPath = saved.video302SubmitPath;
  ENV.video302PollPath = saved.video302PollPath;
  ENV.video302ImageField = saved.video302ImageField;
  ENV.video302Motion = saved.video302Motion;
  ENV.videoPrompt302Model = saved.videoPrompt302Model;
  ENV.videoPrompt302TimeoutMs = saved.videoPrompt302TimeoutMs;
  vi.unstubAllGlobals();
});

describe("videoJobs", () => {
  async function selectImage(storyId: number, imageId: number) {
    await createImageSignal({
      userId: 1,
      storyId,
      imageId,
      action: "swipe_right",
      metadata: null,
    });
  }

  async function migrateStoryPrompts(storyId: number, body: unknown) {
    await migrateStoryPromptLineage({
      storyId,
      userId: 1,
      body,
      source: "initial",
    });
    const projection = await getStoryPromptProjection({ storyId, userId: 1 });
    expect(projection).not.toBeNull();
    return projection!;
  }

  it("creates a processing take from a story frame without storing raw image input in the snapshot", async () => {
    const story = await createStory({
      userId: 1,
      projectId: null,
      title: "故事",
      body: {
        cards: [],
        characters: [],
        shots: [
          {
            stableShotId: "shot-05",
            shotIdentity: "shot-05",
            shotNo: 5,
            subject: "前一镜",
            action: "走近",
            dialogue: "",
            shotType: "",
            beat: "build",
            cameraAngle: "",
            cameraMove: "",
            location: "",
            timeLight: "",
            mood: "",
            sound: "",
            styleRef: "",
            note: "",
            emotion: "",
            sourceCardContent: "",
          },
          {
            stableShotId: "shot-06",
            shotIdentity: "shot-06",
            shotNo: 6,
            subject: "窗边",
            action: "转身",
            dialogue: "",
            shotType: "",
            beat: "turn",
            cameraAngle: "",
            cameraMove: "",
            location: "",
            timeLight: "",
            mood: "",
            sound: "",
            styleRef: "",
            note: "",
            emotion: "",
            sourceCardContent: "",
          },
          {
            stableShotId: "shot-07",
            shotIdentity: "shot-07",
            shotNo: 7,
            subject: "后一镜",
            action: "离开",
            dialogue: "",
            shotType: "",
            beat: "release",
            cameraAngle: "",
            cameraMove: "",
            location: "",
            timeLight: "",
            mood: "",
            sound: "",
            styleRef: "",
            note: "",
            emotion: "",
            sourceCardContent: "",
          },
        ],
      },
    });
    const previousImage = await createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: 1,
      shotNo: "SH05",
      shotIdentity: "shot-05",
      imageUrl: "data:image/png;base64,BBBB",
      imageKey: null,
      prompt: "previous selected frame",
      generationType: "initial",
      isCurrent: true,
    });
    const image = await createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: 1,
      shotNo: "SH06",
      shotIdentity: "shot-06",
      imageUrl: "data:image/png;base64,AAAA",
      imageKey: null,
      prompt: "frame prompt",
      generationType: "initial",
      isCurrent: true,
    });
    const nextImage = await createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: 1,
      shotNo: "SH07",
      shotIdentity: "shot-07",
      imageUrl: "data:image/png;base64,CCCC",
      imageKey: null,
      prompt: "next selected frame",
      generationType: "initial",
      isCurrent: true,
    });
    await selectImage(story.id, previousImage.id);
    await selectImage(story.id, image.id);
    await selectImage(story.id, nextImage.id);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ taskId: "task-6" }),
      }))
    );

    const result = await startShotVideoJob(
      {
        storyId: story.id,
        shotNo: 6,
        stableShotId: "shot-06",
        imageId: image.id,
        previousReferenceImageId: previousImage.id,
        nextReferenceImageId: nextImage.id,
        prompt: "gentle camera move",
        durationSec: 5,
      },
      1
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.take).toMatchObject({
      status: "processing",
      taskId: "task-6",
      stableShotId: "shot-06",
      sourceImageId: image.id,
    });
    expect(JSON.stringify(result.take.parameterSnapshot)).not.toContain(
      "data:image"
    );
    expect(JSON.stringify(result.take.parameterSnapshot)).toContain(
      "[source-image]"
    );
    expect(result.take.parameterSnapshot).toMatchObject({
      model: "test-video-model",
      submitPath: "/302/submit/{model}",
      imageField: "image_url",
      motion: "low",
      previousReferenceImageId: previousImage.id,
      previousReferenceShotNo: "SH05",
      nextReferenceImageId: nextImage.id,
      nextReferenceShotNo: "SH07",
      promptDirector: {
        engineering: {
          version: "video-prompt-engineering/v2",
          editorHardConstraints: expect.stringContaining("转身"),
          continuityIn: expect.stringContaining("前一镜参考图：SH05"),
          continuityOut: expect.stringContaining("后一镜参考图：SH07"),
          finalPrompt: expect.stringContaining("Editor hard constraints"),
        },
      },
    });
    const requestBody = JSON.parse(
      String((globalThis.fetch as any).mock.calls[0][1].body)
    );
    expect(requestBody.image_url).toBe("data:image/png;base64,AAAA");
    expect(requestBody.prompt).toContain("Editor hard constraints");
    expect(requestBody.prompt).toContain("转身");
    expect(requestBody.prompt).toContain("前一镜参考图：SH05");
    expect(requestBody.prompt).toContain("后一镜参考图：SH07");
    expect(requestBody.prompt).toContain("previous selected frame");
    expect(requestBody.prompt).toContain("next selected frame");
  });

  it("rejects a pending source image before submitting a video job", async () => {
    const story = await createStory({
      userId: 1,
      projectId: null,
      title: "故事",
      body: {
        shots: [
          {
            stableShotId: "shot-01",
            shotIdentity: "shot-01",
            shotNo: 1,
            subject: "窗边",
          },
        ],
      },
    });
    const image = await createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: 1,
      shotNo: "SH01",
      shotIdentity: "shot-01",
      imageUrl: "data:image/png;base64,AAAA",
      imageKey: null,
      prompt: "pending frame",
      generationType: "initial",
      isCurrent: true,
    });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const result = await startShotVideoJob(
      {
        storyId: story.id,
        shotNo: 1,
        stableShotId: "shot-01",
        imageId: image.id,
        prompt: "gentle camera move",
      },
      1
    );

    expect(result).toEqual({
      status: "error",
      error: "首帧图不存在或不属于当前镜头",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a stale video compilation id before calling the provider", async () => {
    const body = {
      shots: [
        {
          stableShotId: "shot-01",
          shotIdentity: "shot-01",
          shotNo: 1,
          subject: "窗边",
          cameraMove: "固定机位",
        },
      ],
    };
    const story = await createStory({
      userId: 1,
      projectId: null,
      title: "故事",
      body,
    });
    const image = await createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: 1,
      shotNo: "SH01",
      shotIdentity: "shot-01",
      imageUrl: "data:image/png;base64,AAAA",
      imageKey: null,
      prompt: "selected frame",
      generationType: "initial",
      isCurrent: true,
    });
    await selectImage(story.id, image.id);
    const projection = await migrateStoryPrompts(story.id, body);
    const head = projection.compilationHeads.find(
      item => item.stableShotId === "shot-01" && item.modality === "video"
    );
    expect(head).toBeTruthy();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const result = await startShotVideoJob(
      {
        storyId: story.id,
        shotNo: 1,
        stableShotId: "shot-01",
        promptCompilationId: (head?.currentCompilationId ?? 0) + 999,
        imageId: image.id,
        prompt: "outdated prompt",
      },
      1
    );

    expect(result).toEqual({
      status: "error",
      error: "当前镜头的视频提示词已经更新，请刷新后重试",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps MJ-Video submitted prompt free of adjacent-reference text", async () => {
    ENV.video302Model = "";
    ENV.video302SubmitPath = "/mj/submit/video";
    ENV.video302PollPath = "";
    ENV.video302ImageField = "";
    const story = await createStory({
      userId: 1,
      projectId: null,
      title: "故事",
      body: {
        shots: [
          {
            stableShotId: "shot-01",
            shotIdentity: "shot-01",
            shotNo: 1,
            subject: "前一镜",
          },
          {
            stableShotId: "shot-02",
            shotIdentity: "shot-02",
            shotNo: 2,
            subject: "当前镜",
          },
          {
            stableShotId: "shot-03",
            shotIdentity: "shot-03",
            shotNo: 3,
            subject: "后一镜",
          },
        ],
      },
    });
    const previousImage = await createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: 1,
      shotNo: "SH01",
      shotIdentity: "shot-01",
      imageUrl: "https://storage.example/previous.png",
      imageKey: null,
      prompt: "previous selected frame",
      generationType: "initial",
      isCurrent: true,
    });
    const image = await createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: 1,
      shotNo: "SH02",
      shotIdentity: "shot-02",
      imageUrl: "data:image/png;base64,BBBB",
      imageKey: null,
      prompt: "current selected frame",
      generationType: "initial",
      isCurrent: true,
    });
    const nextImage = await createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: 1,
      shotNo: "SH03",
      shotIdentity: "shot-03",
      imageUrl: "https://storage.example/next.png",
      imageKey: null,
      prompt: "next selected frame",
      generationType: "initial",
      isCurrent: true,
    });
    await selectImage(story.id, previousImage.id);
    await selectImage(story.id, image.id);
    await selectImage(story.id, nextImage.id);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ code: 1, result: "mj-task-2" }),
      }))
    );

    const result = await startShotVideoJob(
      {
        storyId: story.id,
        shotNo: 2,
        stableShotId: "shot-02",
        imageId: image.id,
        previousReferenceImageId: previousImage.id,
        nextReferenceImageId: nextImage.id,
        prompt: "gentle camera move\n前一镜参考图：https://bad.example/ref.png",
        durationSec: 5,
      },
      1
    );

    expect(result.status).toBe("ok");
    const requestBody = JSON.parse(
      String((globalThis.fetch as any).mock.calls[0][1].body)
    );
    expect(requestBody).toMatchObject({
      motion: "low",
      image: "data:image/png;base64,BBBB",
    });
    expect(requestBody.prompt).toContain("USER REQUIREMENT");
    expect(requestBody.prompt).toContain("gentle camera move");
    expect(requestBody.prompt.length).toBeLessThanOrEqual(500);
    expect(requestBody.prompt).not.toContain("前一镜参考图");
    expect(requestBody.prompt).not.toContain("后一镜参考图");
    expect(requestBody.prompt).not.toContain("storage.example");
    expect(
      result.status === "ok" ? result.take.parameterSnapshot : null
    ).toMatchObject({
      previousReferenceImageId: previousImage.id,
      nextReferenceImageId: nextImage.id,
    });
  });

  it("reduces a storyboard recipe to the motion fields MJ-Video needs", () => {
    const prompt = sanitizeVideoPrompt(`
图生视频任务：只生成 SH02 的 3-5 秒短片片段。
使用当前关键帧作为首帧，保持人物、构图、色调和故事上下文一致。
镜头要传达的信息：记录一个身体正在流失能量的瞬间。
主体：空荡的房间，下午的光。
动作：坐在沙发边缘，身体微微前倾，手搭在膝盖上。
表演：先屏住呼吸，再缓慢抬眼。
环境变化：窗帘只被现有微风轻轻带动。
相机运动：稳定轻微推进，避免夸张转场。
主体运动路径：人物留在原位，不横穿画面。
字幕/旁白含义：我最近一直都在昏昏欲睡的状态。
情绪色调：平静，像在陈述天气。
限制：不要生成文字水印。
Negative: no floating objects, characters obey physics.
    `);

    expect(prompt).toContain("坐在沙发边缘");
    expect(prompt).toContain("先屏住呼吸");
    expect(prompt).toContain("窗帘只被现有微风轻轻带动");
    expect(prompt).toContain("稳定轻微推进");
    expect(prompt).toContain("人物留在原位");
    expect(prompt).not.toContain("镜头要传达的信息");
    expect(prompt).not.toContain("昏昏欲睡");
    expect(prompt).not.toContain("Negative");
    expect(prompt.length).toBeLessThanOrEqual(320);
  });

  it("puts current action before a stale core prompt when preparing MJ motion", () => {
    const prompt = sanitizeVideoPrompt(`
核心视频提示：旧方案要求人物不动并缓慢推进，后面还有大量旧镜头说明占据提示词长度。
动作：女主在黑暗中快速撑开一个自己的空间。
相机运动：相机快速后撤，跟随双臂向两侧打开。
    `);

    expect(prompt).toMatch(/^女主在黑暗中快速撑开/);
    expect(prompt.indexOf("相机快速后撤")).toBeLessThan(
      prompt.indexOf("旧方案要求人物不动")
    );
  });

  it("treats a submit timeout as an unknown paid result", () => {
    expect(isUnknownVideoSubmissionFailure("video generation timeout")).toBe(
      true
    );
    expect(isUnknownVideoSubmissionFailure("fetch failed")).toBe(true);
    expect(isUnknownVideoSubmissionFailure("HTTP 400")).toBe(false);
  });

  it("submits again when the matching prior take failed", async () => {
    const story = await createStory({
      userId: 1,
      projectId: null,
      title: "故事",
      body: {
        shots: [
          {
            stableShotId: "shot-02",
            shotIdentity: "shot-02",
            shotNo: 2,
            subject: "沙发边的人",
          },
        ],
      },
    });
    const image = await createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: 1,
      shotNo: "SH02",
      shotIdentity: "shot-02",
      imageUrl: "data:image/png;base64,BBBB",
      imageKey: null,
      prompt: "current selected frame",
      generationType: "initial",
      isCurrent: true,
    });
    await selectImage(story.id, image.id);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          message: "Prompt parameter error or image not approved",
        }),
      })
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ code: 1, result: "retry-task" }),
      });
    vi.stubGlobal("fetch", fetch);
    const input = {
      storyId: story.id,
      shotNo: 2,
      stableShotId: "shot-02",
      imageId: image.id,
      prompt: "gentle camera move",
    };

    const first = await startShotVideoJob(input, 1);
    const retry = await startShotVideoJob(input, 1);
    const duplicateClick = await startShotVideoJob(input, 1);
    const explicitRerender = await startShotVideoJob(
      { ...input, rerenderRequestId: "manual-rerender-1" },
      1
    );

    expect(first.status).toBe("error");
    expect(retry.status).toBe("ok");
    expect(duplicateClick.status).toBe("ok");
    expect(explicitRerender.status).toBe("ok");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(first.take?.id).not.toBe(retry.take?.id);
    expect(duplicateClick.take?.id).toBe(retry.take?.id);
    expect(explicitRerender.take?.id).not.toBe(retry.take?.id);
  });

  it("turns the MJ approval error into an actionable message", () => {
    expect(
      explainVideoProviderError("Prompt parameter error or image not approved")
    ).toBe(
      "302/MJ 未通过视频提示词或首帧审核。请简化动作描述；若仍失败，请更换当前主图后重试。"
    );
  });

  it("runs the 302 visual director before MJ and records its analysis in the take snapshot", async () => {
    ENV.video302Model = "";
    ENV.video302SubmitPath = "/mj/submit/video";
    ENV.video302PollPath = "";
    ENV.video302ImageField = "";
    ENV.videoPrompt302Model = "gpt-5.4-nano-2026-03-17";
    const story = await createStory({
      userId: 1,
      projectId: null,
      title: "一个人陷入持续的昏睡",
      body: {
        shots: [
          {
            stableShotId: "shot-01",
            shotIdentity: "shot-01",
            shotNo: 1,
            intent: "建立困意弥漫的空间",
          },
          {
            stableShotId: "shot-02",
            shotIdentity: "shot-02",
            shotNo: 2,
            intent: "记录身体正在流失能量的瞬间",
            action: "坐在沙发边缘，身体微微前倾",
            cameraMove: "缓慢推进",
            videoPrompt: "用户最新要求：人物先屏息，再抬眼，相机随后响应",
          },
          {
            stableShotId: "shot-03",
            shotIdentity: "shot-03",
            shotNo: 3,
            intent: "让房间随时间变暗",
          },
        ],
      },
    });
    const image = await createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: 1,
      shotNo: "SH02",
      shotIdentity: "shot-02",
      imageUrl: "data:image/png;base64,BBBB",
      imageKey: null,
      prompt: "current selected frame",
      generationType: "initial",
      isCurrent: true,
    });
    await selectImage(story.id, image.id);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          model: "gpt-5.4-nano-2026-03-17",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  visualSummary: "男子坐在沙发边缘。",
                  narrativeIntent: "身体疲惫与平静表达形成反差。",
                  subjectMotion: "slow breathing",
                  cameraMotion: "a gentle push-in",
                  continuity: "保持暖光和构图。",
                  recommendedMotion: "low",
                  finalPrompt:
                    "The seated man breathes slowly and lowers his gaze. A gentle push-in preserves his face, pose, warm light, and original composition.",
                  confidence: 0.9,
                }),
              },
            },
          ],
        }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ code: 1, result: "mj-task-directed" }),
      });
    vi.stubGlobal("fetch", fetch);

    const result = await startShotVideoJob(
      {
        storyId: story.id,
        shotNo: 2,
        stableShotId: "shot-02",
        imageId: image.id,
        characterReferenceImageUrl: "data:image/png;base64,IDENTITY",
        storyStyleReferenceImageUrl: "data:image/png;base64,COVER",
        prompt: "动作：坐在沙发边缘\n相机运动：缓慢推进",
        subtitle: "我最近一直都在昏昏欲睡的状态",
        durationSec: 5,
      },
      1
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toBe(
      "https://api.302.ai/v1/chat/completions"
    );
    const directorBody = JSON.parse(String(fetch.mock.calls[0][1].body));
    expect(directorBody.messages[1].content[0].text).toContain(
      "用户最新要求：人物先屏息，再抬眼，相机随后响应"
    );
    expect(directorBody.messages[1].content[2].text).toContain("人物身份基准");
    expect(directorBody.messages[1].content[3].image_url.url).toContain(
      "IDENTITY"
    );
    expect(directorBody.messages[1].content[4].text).toContain("故事正式封面");
    expect(directorBody.messages[1].content[5].image_url.url).toContain(
      "COVER"
    );
    expect(fetch.mock.calls[1][0]).toBe("https://api.302.ai/mj/submit/video");
    const mjBody = JSON.parse(String(fetch.mock.calls[1][1].body));
    expect(mjBody.prompt).toContain("breathes slowly");
    expect(mjBody.prompt).toContain(
      "用户最新要求：人物先屏息，再抬眼，相机随后响应"
    );
    expect(mjBody.prompt).not.toContain("昏昏欲睡");
    expect(result.take.prompt).toBe(mjBody.prompt);
    expect(result.take.parameterSnapshot).toMatchObject({
      characterReferenceImageUrl: "inline-image",
      storyStyleReferenceImageUrl: "inline-image",
      promptDirector: {
        source: "302-vision",
        model: "gpt-5.4-nano-2026-03-17",
        engineering: {
          userRequirement: "用户最新要求：人物先屏息，再抬眼，相机随后响应",
        },
        analysis: {
          visualSummary: "男子坐在沙发边缘。",
          recommendedMotion: "low",
        },
      },
    });
    expect(JSON.stringify(result.take.parameterSnapshot)).not.toContain(
      "data:image"
    );
  });

  it("submits an editor-approved director prompt without rewriting it a second time", async () => {
    ENV.video302Model = "";
    ENV.video302SubmitPath = "/mj/submit/video";
    ENV.video302PollPath = "";
    ENV.video302ImageField = "";
    ENV.videoPrompt302Model = "gpt-5.4-nano-2026-03-17";
    const story = await createStory({
      userId: 1,
      projectId: null,
      title: "SheSelf",
      body: {
        shots: [
          {
            stableShotId: "shot-0107",
            shotIdentity: "shot-0107",
            shotNo: 7,
            cueCode: "0107",
            action: "女主头上出现一只眼睛，相机给眼睛特写并接下一镜首帧",
          },
        ],
      },
    });
    const image = await createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: 1,
      shotNo: "SH07",
      shotIdentity: "shot-0107",
      imageUrl: "data:image/png;base64,APPROVED",
      imageKey: null,
      prompt: "current selected frame",
      generationType: "initial",
      isCurrent: true,
    });
    await selectImage(story.id, image.id);
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ code: 1, result: "mj-task-approved" }),
    }));
    vi.stubGlobal("fetch", fetch);
    const approvedPrompt =
      "The woman holds still as the existing eye above her becomes the visual focus. A controlled dolly pushes toward the eye and settles on a matching composition for the next shot.";

    const result = await startShotVideoJob(
      {
        storyId: story.id,
        shotNo: 7,
        stableShotId: "shot-0107",
        imageId: image.id,
        prompt: approvedPrompt,
        directorPromptApproved: true,
        durationSec: 5,
      },
      1
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("https://api.302.ai/mj/submit/video");
    const body = JSON.parse(String(fetch.mock.calls[0][1].body));
    expect(body.prompt).toBe(approvedPrompt);
    expect(result.take.prompt).toBe(approvedPrompt);
    expect(result.take.parameterSnapshot).toMatchObject({
      promptDirector: {
        source: "editor-approved",
      },
    });
  });

  it("turns an MJ contact-sheet result into four selectable video takes", async () => {
    ENV.video302Model = "";
    ENV.video302SubmitPath = "/mj/submit/video";
    ENV.video302PollPath = "/mj/task/{taskId}/fetch";
    ENV.video302ImageField = "";
    const story = await createStory({
      userId: 1,
      projectId: null,
      title: "四版本选择",
      body: { shots: [{ stableShotId: "shot-01", shotNo: 1 }] },
    });
    const parent = await createVideoTake({
      storyId: story.id,
      userId: 1,
      stableShotId: "shot-01",
      sourceImageId: null,
      status: "available",
      taskId: "mj-task-four",
      provider: "302",
      model: "mj-video",
      prompt: "a motivated camera move",
      durationSec: 5,
      aspectRatio: "1:1",
      videoUrl: "/api/videos/contact-sheet.mp4",
      parameterSnapshot: { resultSelectionRule: "first-valid-url" },
      extractionCapability: "available",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          status: "SUCCESS",
          videoUrl: "https://file.302.ai/contact-sheet.mp4",
          videoUrls: [
            { url: "https://file.302.ai/v1.mp4" },
            { url: "https://file.302.ai/v2.mp4" },
            { url: "https://file.302.ai/v3.mp4" },
            { url: "https://file.302.ai/v4.mp4" },
          ],
        }),
      }))
    );

    const refreshed = await refreshVideoTakeStatus(parent.id, 1);

    expect(refreshed.status).toBe("ok");
    if (refreshed.status !== "ok") return;
    expect(refreshed.take.status).toBe("unfollowable");
    expect(refreshed.take.parameterSnapshot).toMatchObject({
      resultSelectionRule: "user-select-variant",
      candidateVideoCount: 4,
      candidateTakeIds: expect.arrayContaining([
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
      ]),
    });
    const takes = await getStoryVideoTakes(story.id, 1);
    const variants = takes.filter(take => take.id !== parent.id);
    expect(variants).toHaveLength(4);
    expect(variants.map(take => take.status)).toEqual([
      "available",
      "available",
      "available",
      "available",
    ]);
    expect(
      variants
        .map(
          take =>
            (take.parameterSnapshot as Record<string, unknown>)
              .mjVideoVariantLabel
        )
        .sort()
    ).toEqual(["V1", "V2", "V3", "V4"]);
  });
});
