import { afterEach, describe, expect, it, vi } from "vitest";
import { ENV } from "../_core/env";
import {
  generateShotVideo,
  getShotVideoProviderStatus,
  refreshShotVideoTask,
  resolveShotVideoPollTarget,
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
  videoPrompt302Model: ENV.videoPrompt302Model,
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
  ENV.videoPrompt302Model = saved.videoPrompt302Model;
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
    ENV.videoPrompt302Model = "gpt-5.4-nano-2026-03-17";

    expect(getShotVideoProviderStatus()).toEqual({
      provider: "302",
      ready: true,
      missing: [],
      warnings: [],
      baseUrl: "https://api.302.ai",
      model: "mj-video",
      submitPath: "/mj-turbo/submit/video",
      pollPath: "/mj-turbo/task/{taskId}/fetch",
      imageField: "image",
      motion: "high",
      promptDirectorModel: "gpt-5.4-nano-2026-03-17",
      promptDirectorReady: true,
      outputAspectRatio: "1:1",
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
      submitUrl: "https://api.302.ai/mj-turbo/submit/video",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.302.ai/mj-turbo/submit/video",
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

  it("keeps the classified material lock when MJ trims a long video prompt", async () => {
    ENV.api302Key = "test-302-key";
    ENV.api302BaseUrl = "https://api.302.ai";
    ENV.video302Model = "";
    ENV.video302SubmitPath = "";
    ENV.video302PollPath = "";
    ENV.video302ImageField = "";
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        code: 1,
        description: "提交成功",
        result: "material-lock-task",
      }),
    })) as unknown as typeof fetch;
    const materialLock =
      "MATERIAL LOCK: watercolor on cold-pressed paper; preserve paper tooth, transparent washes, wet-on-wet blooms, pigment granulation and pooled wash edges in every frame; avoid oil impasto, photorealism, digital smoothing and texture flicker.";
    const motion =
      "MOTION: The woman turns her head first, then the camera makes one restrained lateral move and settles.";

    await submitShotVideo(
      {
        prompt: `${materialLock}\n${motion}\n${"continuity detail ".repeat(80)}`,
        sourceImage: "https://file.302ai.cn/gpt/imgs/frame.png",
      },
      { fetcher }
    );

    const body = JSON.parse(String((fetcher as any).mock.calls[0][1].body));
    expect(body.prompt).toMatch(/^MATERIAL LOCK:/);
    expect(body.prompt).toContain("cold-pressed paper");
    expect(body.prompt).toContain("texture flicker");
    expect(body.prompt).toContain("The woman turns her head first");
    expect(body.prompt.length).toBeLessThanOrEqual(500);
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
      submissionState: "not_submitted",
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

  it("keeps the four MJ video variants separate from the contact-sheet preview", async () => {
    ENV.api302Key = "test-302-key";
    ENV.api302BaseUrl = "https://api.302.ai";
    ENV.video302Model = "";
    ENV.video302SubmitPath = "/mj-turbo/submit/video";
    ENV.video302PollPath = "/mj-turbo/task/{taskId}/fetch";
    const fetcher = vi.fn(async () => ({
      ok: true,
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
    })) as unknown as typeof fetch;

    await expect(
      refreshShotVideoTask("mj-task-four", {
        fetcher,
        snapshot: { pollPath: "/mj-turbo/task/{taskId}/fetch", submitUrl: "https://api.302.ai/mj-turbo/submit/video" },
      })
    ).resolves.toEqual({
      status: "available",
      taskId: "mj-task-four",
      videoUrl: "https://file.302.ai/v1.mp4",
      previewVideoUrl: "https://file.302.ai/contact-sheet.mp4",
      candidateVideoUrls: [
        "https://file.302.ai/v1.mp4",
        "https://file.302.ai/v2.mp4",
        "https://file.302.ai/v3.mp4",
        "https://file.302.ai/v4.mp4",
      ],
    });
  });
});

describe("refreshShotVideoTask follows the submission snapshot", () => {
  function pollFetcher() {
    return vi.fn(async (_url: string) => ({ ok: true, status: 200, json: async () => ({ status: "IN_PROGRESS" }) })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  }

  it("polls the stored vendor route even after VIDEO_302_* changed", async () => {
    ENV.api302Key = "test-302-key";
    ENV.api302BaseUrl = "https://api.302ai.cn";
    ENV.video302SubmitPath = "/302/v2/video/{model}";
    ENV.video302PollPath = "/302/v2/video/fetch/{taskId}";
    const fetcher = pollFetcher();
    const result = await refreshShotVideoTask("task-1", {
      fetcher,
      snapshot: {
        submitPath: "/mj-turbo/submit/video",
        pollPath: "/mj-turbo/task/{taskId}/fetch",
        submitUrl: "https://api.302.ai/mj-turbo/submit/video",
      },
    });
    expect(result.status).toBe("processing");
    expect(String((fetcher as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0])).toBe("https://api.302.ai/mj-turbo/task/task-1/fetch");
  });

  it("derives the poll path from a stored submit path when the poll path was not stored", async () => {
    ENV.api302Key = "test-302-key";
    ENV.api302BaseUrl = "https://api.302.ai";
    ENV.video302SubmitPath = "/302/v2/video/{model}";
    ENV.video302PollPath = "/302/v2/video/fetch/{taskId}";
    const fetcher = pollFetcher();
    await refreshShotVideoTask("task-2", { fetcher, snapshot: { submitPath: "/mj/submit/video" } });
    expect(String((fetcher as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0])).toBe("https://api.302.ai/mj/task/task-2/fetch");
  });

  it("does not poll current config when the snapshot has no recoverable route", async () => {
    ENV.api302Key = "test-302-key";
    ENV.api302BaseUrl = "https://api.302ai.cn";
    ENV.video302SubmitPath = "/mj-turbo/submit/video";
    ENV.video302PollPath = "/mj-turbo/task/{taskId}/fetch";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetcher = pollFetcher();
    const result = await refreshShotVideoTask("task-3", { fetcher, snapshot: {} });
    expect(result).toMatchObject({ status: "unfollowable", unrecoverable: true });
    expect(fetcher).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no recoverable submission snapshot"), expect.anything());
    warn.mockRestore();
  });

  it("polls from renderProfile alone after VIDEO_302_* and the base URL changed", async () => {
    ENV.api302Key = "test-302-key";
    ENV.api302BaseUrl = "https://api.302ai.cn";
    ENV.video302SubmitPath = "/mj-turbo/submit/video";
    ENV.video302PollPath = "/mj-turbo/task/{taskId}/fetch";
    const fetcher = pollFetcher();
    const result = await refreshShotVideoTask("task-profile", {
      fetcher,
      snapshot: {
        renderProfile: {
          profileId: "video.302-configured",
          pollPath: "/302/v2/video/fetch/{taskId}",
          baseUrl: "https://api.302.ai",
        },
      },
    });
    expect(result.status).toBe("processing");
    expect(String((fetcher as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0])).toBe(
      "https://api.302.ai/302/v2/video/fetch/task-profile"
    );
  });

  it("keeps an economy task on the Vidu route after current config switches to MJ", async () => {
    ENV.api302Key = "test-302-key";
    ENV.api302BaseUrl = "https://api.302ai.cn";
    ENV.video302SubmitPath = "/mj-turbo/submit/video";
    ENV.video302PollPath = "/mj-turbo/task/{taskId}/fetch";
    const fetcher = pollFetcher();
    const result = await refreshShotVideoTask("vidu-economy", {
      fetcher,
      renderMode: "economy",
      snapshot: {
        renderMode: "economy",
        submitUrl: "https://api.302.ai/vidu/ent/v2/img2video",
        renderProfile: {
          profileId: "video.vidu-q2-pro-fast",
          pollPath: "/vidu/ent/v2/tasks/{taskId}/creations",
          baseUrl: "https://api.302.ai",
        },
      },
    });
    expect(result.status).toBe("processing");
    expect(String((fetcher as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0])).toBe(
      "https://api.302.ai/vidu/ent/v2/tasks/vidu-economy/creations"
    );
  });

  it("derives the Vidu poll path from a stored submit path without reading VIDEO_302_POLL_PATH", async () => {
    ENV.api302Key = "test-302-key";
    ENV.api302BaseUrl = "https://api.302ai.cn";
    ENV.video302PollPath = "/302/v2/video/fetch/{taskId}";
    const target = resolveShotVideoPollTarget({ submitPath: "/vidu/ent/v2/img2video" });
    expect(target).toMatchObject({
      pollPath: "/vidu/ent/v2/tasks/{taskId}/creations",
      baseUrl: "https://api.302.ai",
      source: "snapshot-submit-path",
    });
  });

  it("keeps the provider's original error on a confirmed failure", async () => {
    ENV.api302Key = "test-302-key";
    ENV.api302BaseUrl = "https://api.302.ai";
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ status: "FAILURE", failReason: "prompt parameter error or image not approved" }) })) as unknown as typeof fetch;
    const result = await refreshShotVideoTask("task-4", { fetcher, snapshot: { pollPath: "/mj-turbo/task/{taskId}/fetch" } });
    expect(result).toMatchObject({ status: "failed", providerConfirmed: true, providerError: { provider: "302-video", message: "prompt parameter error or image not approved" } });
  });
});
