import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV } from "../_core/env";
import {
  createImageSignal,
  createGeneratedImage,
  createStory,
  resetMemoryStateForTesting,
} from "../db";
import { startShotVideoJob } from "./videoJobs";

const saved = {
  api302Key: ENV.api302Key,
  databaseUrl: ENV.databaseUrl,
  video302Model: ENV.video302Model,
  video302SubmitPath: ENV.video302SubmitPath,
  video302PollPath: ENV.video302PollPath,
  video302ImageField: ENV.video302ImageField,
  video302Motion: ENV.video302Motion,
};

beforeEach(() => {
  resetMemoryStateForTesting();
  ENV.databaseUrl = "";
  ENV.api302Key = "test-302-key";
  ENV.video302Model = "test-video-model";
  ENV.video302SubmitPath = "/302/submit/{model}";
  ENV.video302PollPath = "";
  ENV.video302ImageField = "image_url";
  ENV.video302Motion = "low";
});

afterEach(() => {
  ENV.api302Key = saved.api302Key;
  ENV.databaseUrl = saved.databaseUrl;
  ENV.video302Model = saved.video302Model;
  ENV.video302SubmitPath = saved.video302SubmitPath;
  ENV.video302PollPath = saved.video302PollPath;
  ENV.video302ImageField = saved.video302ImageField;
  ENV.video302Motion = saved.video302Motion;
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
    });
    const requestBody = JSON.parse(
      String((globalThis.fetch as any).mock.calls[0][1].body)
    );
    expect(requestBody.image_url).toBe("data:image/png;base64,AAAA");
    expect(requestBody.prompt).toContain("gentle camera move");
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
      prompt: "gentle camera move",
      motion: "low",
      image: "data:image/png;base64,BBBB",
    });
    expect(requestBody.prompt).not.toContain("前一镜参考图");
    expect(requestBody.prompt).not.toContain("后一镜参考图");
    expect(requestBody.prompt).not.toContain("storage.example");
    expect(result.status === "ok" ? result.take.parameterSnapshot : null).toMatchObject({
      previousReferenceImageId: previousImage.id,
      nextReferenceImageId: nextImage.id,
    });
  });
});
