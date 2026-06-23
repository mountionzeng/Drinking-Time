import { afterEach, describe, expect, it, vi } from "vitest";
import { ENV } from "../_core/env";
import {
  generateShotVideo,
  getShotVideoProviderStatus,
  submitShotVideo,
} from "./videoGen";

const saved = {
  api302Key: ENV.api302Key,
  api302BaseUrl: ENV.api302BaseUrl,
  video302Model: ENV.video302Model,
  video302SubmitPath: ENV.video302SubmitPath,
  video302PollPath: ENV.video302PollPath,
  video302ImageField: ENV.video302ImageField,
  video302Motion: ENV.video302Motion,
  video302PollMs: ENV.video302PollMs,
  video302TimeoutMs: ENV.video302TimeoutMs,
};

afterEach(() => {
  ENV.api302Key = saved.api302Key;
  ENV.api302BaseUrl = saved.api302BaseUrl;
  ENV.video302Model = saved.video302Model;
  ENV.video302SubmitPath = saved.video302SubmitPath;
  ENV.video302PollPath = saved.video302PollPath;
  ENV.video302ImageField = saved.video302ImageField;
  ENV.video302Motion = saved.video302Motion;
  ENV.video302PollMs = saved.video302PollMs;
  ENV.video302TimeoutMs = saved.video302TimeoutMs;
});

describe("generateShotVideo", () => {
  it("reports safe MJ-Video provider readiness without exposing the API key", () => {
    ENV.api302Key = "test-302-key";
    ENV.api302BaseUrl = "https://api.302.ai";
    ENV.video302Model = "";
    ENV.video302SubmitPath = "";
    ENV.video302PollPath = "";
    ENV.video302ImageField = "";
    ENV.video302Motion = "high";

    expect(getShotVideoProviderStatus()).toEqual({
      provider: "302",
      ready: true,
      missing: [],
      warnings: [],
      baseUrl: "https://api.302.ai",
      model: "mj-video",
      submitPath: "/mj/submit/video",
      pollPath: "/mj/task/{taskId}/fetch",
      imageField: "image",
      motion: "high",
    });
  });

  it("submits MJ-Video with mj-api-secret and prompt/motion/image", async () => {
    ENV.api302Key = "test-302-key";
    ENV.api302BaseUrl = "https://api.302.ai";
    ENV.video302Model = "";
    ENV.video302SubmitPath = "";
    ENV.video302PollPath = "";
    ENV.video302ImageField = "";
    ENV.video302Motion = "low";
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        code: 1,
        description: "提交成功",
        result: "1320098173412546",
      }),
    })) as unknown as typeof fetch;

    const result = await submitShotVideo(
      {
        prompt: "reeds moving gently",
        sourceImage: "https://file.302ai.cn/gpt/imgs/frame.png",
        durationSec: 5,
      },
      { fetcher }
    );

    expect(result).toMatchObject({
      status: "ok",
      taskId: "1320098173412546",
      submitUrl: "https://api.302.ai/mj/submit/video",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.302.ai/mj/submit/video",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "mj-api-secret": "test-302-key",
        },
      })
    );
    const body = JSON.parse(String((fetcher as any).mock.calls[0][1].body));
    expect(body).toEqual({
      prompt: "reeds moving gently",
      motion: "low",
      image: "https://file.302ai.cn/gpt/imgs/frame.png",
    });
  });

  it("fails clearly before a generic model is configured", async () => {
    ENV.api302Key = "test-302-key";
    ENV.video302Model = "";
    ENV.video302SubmitPath = "/302/submit/{model}";

    const result = await generateShotVideo({
      prompt: "move gently",
      sourceImage: "data:image/png;base64,AAAA",
    });

    expect(result).toEqual({
      status: "error",
      message:
        "VIDEO_302_MODEL 未配置。已准备好视频包，但还不知道要调用哪个 302 视频模型。",
    });
  });

  it("submits to the configured 302 model and accepts a direct video url", async () => {
    ENV.api302Key = "test-302-key";
    ENV.api302BaseUrl = "https://api.302.ai";
    ENV.video302Model = "test-video-model";
    ENV.video302SubmitPath = "/302/submit/{model}";
    ENV.video302ImageField = "image";
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({ videoUrl: "https://file.302.ai/shot.mp4" }),
    })) as unknown as typeof fetch;

    const result = await generateShotVideo(
      {
        prompt: "move gently",
        sourceImage: "data:image/png;base64,AAAA",
        subtitle: "我知道该往哪走",
        durationSec: 5,
      },
      { fetcher }
    );

    expect(result).toMatchObject({
      status: "ok",
      videoUrl: "https://file.302.ai/shot.mp4",
      prompt: "move gently",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.302.ai/302/submit/test-video-model",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-302-key",
        }),
      })
    );
    const body = JSON.parse(String((fetcher as any).mock.calls[0][1].body));
    expect(body.image).toBe("data:image/png;base64,AAAA");
    expect(body.subtitle).toBe("我知道该往哪走");
    expect(body.caption).toBe("我知道该往哪走");
  });

  it("reports an accepted task when no poll path is configured", async () => {
    ENV.api302Key = "test-302-key";
    ENV.video302Model = "test-video-model";
    ENV.video302SubmitPath = "/302/submit/{model}";
    ENV.video302PollPath = "";
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({ taskId: "task-1" }),
    })) as unknown as typeof fetch;

    const result = await generateShotVideo(
      {
        prompt: "move gently",
        sourceImage: "data:image/png;base64,AAAA",
      },
      { fetcher }
    );

    expect(result).toEqual({
      status: "error",
      taskId: "task-1",
      message: "视频任务已提交，但未配置 VIDEO_302_POLL_PATH，无法查询结果。",
    });
  });
});
