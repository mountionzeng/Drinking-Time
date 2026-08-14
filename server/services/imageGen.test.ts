import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import sharp from "sharp";
import { randomBytes } from "node:crypto";
import {
  editImage,
  generateDraftImage,
  generateImage,
  getImageProviderStatus,
  inpaintImage,
  isCircuitOpen,
  resetCircuitBreaker,
  resume302GptImageTask,
  resume302MidjourneyTask,
} from "./imageGen";
import { ENV } from "../_core/env";
import { storagePut } from "../storage";

// ── Mocks ──

vi.mock("../storage", () => ({
  storagePut: vi.fn().mockResolvedValue({
    key: "generated/test.png",
    url: "https://storage.example.com/generated/test.png",
  }),
}));

// ── Helpers ──

const TEST_MJ_TIMEOUT_MS = 2_000;

function makeFetcher(
  responses: Array<{
    ok: boolean;
    status: number;
    statusText?: string;
    json?: unknown;
    arrayBuffer?: ArrayBuffer;
    text?: string;
  }>
) {
  let callIndex = 0;
  return vi.fn().mockImplementation(() => {
    const resp = responses[callIndex++] ?? responses[responses.length - 1];
    return Promise.resolve({
      ok: resp.ok,
      status: resp.status,
      statusText: resp.statusText,
      json: () => Promise.resolve(resp.json ?? {}),
      arrayBuffer: () =>
        Promise.resolve(resp.arrayBuffer ?? new ArrayBuffer(8)),
      text: () => Promise.resolve(resp.text ?? ""),
    });
  });
}

async function makeSolidPng(
  red: number,
  green: number,
  blue: number,
  alpha = 255
): Promise<Buffer> {
  return sharp(Buffer.from([red, green, blue, alpha]), {
    raw: { width: 1, height: 1, channels: 4 },
  })
    .png()
    .toBuffer();
}

describe("generateImage", () => {
  const originalEnv = {
    imageProviderDefault: ENV.imageProviderDefault,
    api302Key: ENV.api302Key,
    api302BaseUrl: ENV.api302BaseUrl,
    image302GptModel: ENV.image302GptModel,
    image302GptSize: ENV.image302GptSize,
    image302GptQuality: ENV.image302GptQuality,
    image302DraftTimeoutMs: ENV.image302DraftTimeoutMs,
    image302MjAuthHeader: ENV.image302MjAuthHeader,
    image302MjPollMs: ENV.image302MjPollMs,
    image302MjSubmitTimeoutMs: ENV.image302MjSubmitTimeoutMs,
    image302MjTimeoutMs: ENV.image302MjTimeoutMs,
    imagePrompt302Model: ENV.imagePrompt302Model,
    imagePrompt302TimeoutMs: ENV.imagePrompt302TimeoutMs,
    vision302ApiKey: ENV.vision302ApiKey,
    vision302BaseUrl: ENV.vision302BaseUrl,
    vision302Model: ENV.vision302Model,
    openaiNextApiKey: ENV.openaiNextApiKey,
    openaiNextBaseUrl: ENV.openaiNextBaseUrl,
    openaiNextVisionModel: ENV.openaiNextVisionModel,
    falApiKey: ENV.falApiKey,
  };

  beforeEach(() => {
    resetCircuitBreaker();
    ENV.imageProviderDefault = "fal";
    ENV.falApiKey = "test-fal-key";
    ENV.api302Key = "";
    ENV.api302BaseUrl = "https://api.302.ai";
    ENV.image302GptModel = "gpt-image-1.5";
    ENV.image302GptSize = "1024x1024";
    ENV.image302GptQuality = "high";
    ENV.image302DraftTimeoutMs = "100";
    ENV.image302MjAuthHeader = "bearer";
    ENV.image302MjPollMs = "1";
    ENV.image302MjSubmitTimeoutMs = "100";
    ENV.image302MjTimeoutMs = String(TEST_MJ_TIMEOUT_MS);
    ENV.imagePrompt302Model = "";
    ENV.imagePrompt302TimeoutMs = "100";
    ENV.vision302ApiKey = "";
    ENV.vision302BaseUrl = "https://api.302.ai";
    ENV.vision302Model = "";
    ENV.openaiNextApiKey = "";
    ENV.openaiNextBaseUrl = "https://api.openai-next.com";
    ENV.openaiNextVisionModel = "qwen3-vl-plus";
  });

  afterEach(() => {
    ENV.imageProviderDefault = originalEnv.imageProviderDefault;
    ENV.api302Key = originalEnv.api302Key;
    ENV.api302BaseUrl = originalEnv.api302BaseUrl;
    ENV.image302GptModel = originalEnv.image302GptModel;
    ENV.image302GptSize = originalEnv.image302GptSize;
    ENV.image302GptQuality = originalEnv.image302GptQuality;
    ENV.image302DraftTimeoutMs = originalEnv.image302DraftTimeoutMs;
    ENV.image302MjAuthHeader = originalEnv.image302MjAuthHeader;
    ENV.image302MjPollMs = originalEnv.image302MjPollMs;
    ENV.image302MjSubmitTimeoutMs = originalEnv.image302MjSubmitTimeoutMs;
    ENV.image302MjTimeoutMs = originalEnv.image302MjTimeoutMs;
    ENV.imagePrompt302Model = originalEnv.imagePrompt302Model;
    ENV.imagePrompt302TimeoutMs = originalEnv.imagePrompt302TimeoutMs;
    ENV.vision302ApiKey = originalEnv.vision302ApiKey;
    ENV.vision302BaseUrl = originalEnv.vision302BaseUrl;
    ENV.vision302Model = originalEnv.vision302Model;
    ENV.openaiNextApiKey = originalEnv.openaiNextApiKey;
    ENV.openaiNextBaseUrl = originalEnv.openaiNextBaseUrl;
    ENV.openaiNextVisionModel = originalEnv.openaiNextVisionModel;
    ENV.falApiKey = originalEnv.falApiKey;
  });

  it("returns ok with imageUrl on success", async () => {
    const fetcher = makeFetcher([
      {
        ok: true,
        status: 200,
        json: { images: [{ url: "https://fal.ai/result.png" }] },
      },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(16) },
    ]);

    const result = await generateImage("a cat", { fetcher });

    expect(result.status).toBe("ok");
    // 新契约：imageUrl 一律是同源稳定路由；远程备份成功时 imageKey 记远程 key
    expect(result.imageUrl).toMatch(/^\/api\/images\/.+\.png$/);
    // 备份改为发射后不管：imageKey = 本地生成的确定性 storageKey，不再等远程返回
    expect(result.imageKey).toMatch(/^generated\/.+\.png$/);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("returns error on fal.ai HTTP 500", async () => {
    const fetcher = makeFetcher([{ ok: false, status: 500 }]);

    const result = await generateImage("a cat", { fetcher });

    expect(result.status).toBe("error");
    expect(result.message).toContain("500");
  });

  it("returns error when fal.ai returns no images", async () => {
    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { images: [] } },
    ]);

    const result = await generateImage("a cat", { fetcher });

    expect(result.status).toBe("error");
    expect(result.message).toContain("no images");
  });

  it("returns error on timeout", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), 50)
          )
      );

    const result = await generateImage("a cat", { fetcher });

    expect(result.status).toBe("error");
    expect(result.message).toBe("timeout");
  });

  it("opens circuit breaker after 3 consecutive failures", async () => {
    const fetcher = makeFetcher([{ ok: false, status: 500 }]);

    await generateImage("a", { fetcher });
    await generateImage("b", { fetcher });
    await generateImage("c", { fetcher });

    expect(isCircuitOpen()).toBe(true);

    const freshFetcher = vi.fn();
    const result = await generateImage("d", { fetcher: freshFetcher });

    expect(result.status).toBe("error");
    expect(result.message).toContain("暂时停用");
    expect(freshFetcher).not.toHaveBeenCalled();
  });

  it("passes aspectRatio and seed to fal.ai", async () => {
    const fetcher = makeFetcher([
      {
        ok: true,
        status: 200,
        json: { images: [{ url: "https://fal.ai/r.png" }] },
      },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(8) },
    ]);

    await generateImage("a cat", { fetcher, aspectRatio: "16:9", seed: 42 });

    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.aspect_ratio).toBe("16:9");
    expect(body.seed).toBe(42);
  });

  it("falls back to fal.ai when 302 provider is selected without a key", async () => {
    const fetcher = makeFetcher([
      {
        ok: true,
        status: 200,
        json: { images: [{ url: "https://fal.ai/r.png" }] },
      },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(8) },
    ]);

    const result = await generateImage("a cat", {
      fetcher,
      provider: "gpt-image",
    });

    expect(result.status).toBe("ok");
    expect(fetcher.mock.calls[0][0]).toContain("fal-ai/flux-pro");
  });

  it("redirects fal→302 GPT-image when no fal key but a 302 key exists", async () => {
    const savedFalKey = ENV.falApiKey;
    ENV.falApiKey = ""; // 本机没有 fal key
    ENV.api302Key = "test-302-key"; // 却配了 302 key
    try {
      const fetcher = makeFetcher([
        {
          ok: true,
          status: 200,
          json: { data: [{ url: "https://file.302.ai/r.png" }] },
        },
        { ok: true, status: 200, arrayBuffer: new ArrayBuffer(8) },
      ]);
      // 不传 provider → 默认 resolve 成 fal；但没 fal key、有 302 key → 应自动改走 302 gpt-image
      const result = await generateImage("a cat", { fetcher });
      expect(result.status).toBe("ok");
      expect(fetcher.mock.calls[0][0]).toContain("/v1/images/generations");
      expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(
        "Bearer test-302-key"
      );
    } finally {
      ENV.falApiKey = savedFalKey;
    }
  });

  it("uses 302 GPT-image and stores base64 image bytes", async () => {
    ENV.api302Key = "test-302-key";
    const b64 = Buffer.from("test-image").toString("base64");
    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { data: [{ b64_json: b64 }] } },
    ]);

    const result = await generateImage("a cat", {
      fetcher,
      provider: "gpt-image",
      aspectRatio: "16:9",
    });

    expect(result.status).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain("/v1/images/generations");
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer test-302-key"
    );
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.model).toBe("gpt-image-1.5");
    expect(body.prompt).toBe("a cat");
    expect(body.size).toBe("1536x1024");
  });

  it("uses 302 GPT-image url response and downloads before storage", async () => {
    ENV.api302Key = "test-302-key";
    const fetcher = makeFetcher([
      {
        ok: true,
        status: 200,
        json: { data: [{ url: "https://file.302.ai/result.png" }] },
      },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(12) },
    ]);

    const result = await generateImage("a cat", {
      fetcher,
      provider: "gpt-image",
    });

    expect(result.status).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toBe("https://file.302.ai/result.png");
  });

  it("submits GPT-image asynchronously and polls until the image is ready", async () => {
    ENV.api302Key = "test-302-key";
    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { task_id: "gpt-task-1" } },
      {
        ok: true,
        status: 200,
        json: { status_code: 200, data: "", err: "result pending" },
      },
      {
        ok: true,
        status: 200,
        json: {
          status_code: 200,
          data: "https://file.302.ai/async-result.png",
          err: "",
        },
      },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(12) },
    ]);

    const result = await generateImage("a patient cat", {
      fetcher,
      provider: "gpt-image",
      gptPollIntervalMs: 1,
      gptTimeoutMs: 100,
    });

    expect(result.status).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[0][0]).toContain("async=true");
    expect(fetcher.mock.calls[1][0]).toContain(
      "/async_result?task_id=gpt-task-1"
    );
    expect(fetcher.mock.calls[3][0]).toBe(
      "https://file.302.ai/async-result.png"
    );
  });

  it("resumes an accepted GPT-image task without submitting a second paid job", async () => {
    ENV.api302Key = "test-302-key";
    const fetcher = makeFetcher([
      {
        ok: true,
        status: 200,
        json: {
          status_code: 200,
          data: "https://file.302.ai/resumed-result.png",
          err: "",
        },
      },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(12) },
    ]);

    const result = await resume302GptImageTask("accepted-task-1", {
      fetcher,
      gptPollIntervalMs: 1,
      gptTimeoutMs: 100,
    });

    expect(result.status).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toContain(
      "/async_result?task_id=accepted-task-1"
    );
    expect(fetcher.mock.calls[0][1].method).toBe("GET");
  });

  it("returns error on 302 GPT-image HTTP failure", async () => {
    ENV.api302Key = "test-302-key";
    const fetcher = makeFetcher([{ ok: false, status: 502 }]);

    const result = await generateImage("a cat", {
      fetcher,
      provider: "gpt-image",
    });

    expect(result.status).toBe("error");
    expect(result.message).toContain("502");
  });

  it("returns error when 302 GPT-image returns no images", async () => {
    ENV.api302Key = "test-302-key";
    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { data: [] } },
    ]);

    const result = await generateImage("a cat", {
      fetcher,
      provider: "gpt-image",
    });

    expect(result.status).toBe("error");
    expect(result.message).toContain("没有返回图片");
  });

  it("returns error on 302 GPT-image timeout", async () => {
    ENV.api302Key = "test-302-key";
    const fetcher = vi.fn().mockRejectedValue(new Error("timeout"));

    const result = await generateImage("a cat", {
      fetcher,
      provider: "gpt-image",
    });

    expect(result.status).toBe("error");
    expect(result.message).toContain("302 GPT-image 生成失败");
    expect(result.message).toContain("timeout");
  });

  it("allows GPT-image generation to use a budget longer than the generic 30s path", async () => {
    vi.useFakeTimers();
    try {
      ENV.api302Key = "test-302-key";
      const png = await makeSolidPng(20, 30, 40);
      const fetcher = vi.fn().mockImplementationOnce(
        () =>
          new Promise(resolve => {
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  status: 200,
                  json: async () => ({
                    data: [{ b64_json: png.toString("base64") }],
                  }),
                }),
              40
            );
          })
      );

      const resultPromise = generateImage("patient cover", {
        fetcher,
        provider: "gpt-image",
        gptTimeoutMs: 100,
      });
      await vi.advanceTimersByTimeAsync(50);

      await expect(resultPromise).resolves.toMatchObject({ status: "ok" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses 302 Midjourney submit, polls, downloads, and stores image", async () => {
    ENV.api302Key = "test-302-key";
    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { code: 1, result: "task-1" } },
      {
        ok: true,
        status: 200,
        json: { status: "IN_PROGRESS", progress: "50%" },
      },
      {
        ok: true,
        status: 200,
        json: { status: "SUCCESS", imageUrl: "https://file.302.ai/mj.png" },
      },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(18) },
    ]);

    const result = await generateImage("a cat", {
      fetcher,
      provider: "midjourney",
      aspectRatio: "16:9",
      mjPollIntervalMs: 1,
      mjTimeoutMs: TEST_MJ_TIMEOUT_MS,
    });

    expect(result.status).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[0][0]).toContain("/mj/submit/imagine");
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer test-302-key"
    );
    expect(JSON.parse(fetcher.mock.calls[0][1].body).prompt).toContain(
      "--ar 16:9"
    );
    expect(JSON.parse(fetcher.mock.calls[0][1].body).prompt).toContain(
      "--turbo"
    );
    expect(fetcher.mock.calls[1][0]).toContain("/mj/task/task-1/fetch");
    expect(fetcher.mock.calls[3][0]).toBe("https://file.302.ai/mj.png");
  });

  it("starts the Midjourney polling budget only after the paid task is accepted", async () => {
    vi.useFakeTimers();
    try {
      ENV.api302Key = "test-302-key";
      const fetcher = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise(resolve => {
              setTimeout(
                () =>
                  resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({ code: 1, result: "slow-submit-task" }),
                  }),
                80
              );
            })
        )
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ status: "IN_PROGRESS" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            status: "SUCCESS",
            imageUrl: "https://file.302.ai/slow-submit.png",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          arrayBuffer: async () => new ArrayBuffer(18),
        });

      const resultPromise = generateImage("a patient cat", {
        fetcher,
        provider: "midjourney",
        mjSubmitTimeoutMs: 100,
        mjPollIntervalMs: 10,
        mjTimeoutMs: 30,
      });
      await vi.advanceTimersByTimeAsync(100);

      await expect(resultPromise).resolves.toMatchObject({ status: "ok" });
      expect(fetcher).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resumes an accepted Midjourney task without submitting it again", async () => {
    ENV.api302Key = "test-302-key";
    const fetcher = makeFetcher([
      {
        ok: true,
        status: 200,
        json: {
          status: "SUCCESS",
          imageUrl: "https://file.302.ai/resumed.png",
        },
      },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(18) },
    ]);

    const result = await resume302MidjourneyTask("task-already-paid", {
      fetcher,
      mjPollIntervalMs: 1,
      mjTimeoutMs: TEST_MJ_TIMEOUT_MS,
    });

    expect(result.status).toBe("ok");
    expect(fetcher.mock.calls[0][0]).toContain(
      "/mj/task/task-already-paid/fetch"
    );
    expect(
      fetcher.mock.calls.some(call =>
        String(call[0]).includes("/mj/submit/imagine")
      )
    ).toBe(false);
  });

  it("stores every 302 Midjourney object-array candidate in provider order", async () => {
    ENV.api302Key = "test-302-key";
    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { code: 1, result: "task-object-urls" } },
      {
        ok: true,
        status: 200,
        json: {
          status: "SUCCESS",
          imageUrl: "",
          imageUrls: [
            { url: "https://file.302.ai/mj-first.png" },
            { url: "https://file.302.ai/mj-second.png" },
            { url: "https://file.302.ai/mj-third.png" },
            { url: "https://file.302.ai/mj-fourth.png" },
          ],
        },
      },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(18) },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(18) },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(18) },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(18) },
    ]);

    const result = await generateImage("a portrait cover", {
      fetcher,
      provider: "midjourney",
      aspectRatio: "3:4",
      mjPollIntervalMs: 1,
      mjTimeoutMs: TEST_MJ_TIMEOUT_MS,
    });

    expect(result.status).toBe("ok");
    expect(fetcher.mock.calls[2][0]).toBe("https://file.302.ai/mj-first.png");
    expect(fetcher.mock.calls.slice(2).map(call => call[0])).toEqual([
      "https://file.302.ai/mj-first.png",
      "https://file.302.ai/mj-second.png",
      "https://file.302.ai/mj-third.png",
      "https://file.302.ai/mj-fourth.png",
    ]);
    expect(result.candidates).toHaveLength(4);
    expect(result.imageUrl).toBe(result.candidates?.[0]?.imageUrl);
  });

  it("prefers individual Midjourney candidates over a combined imageUrl", async () => {
    ENV.api302Key = "test-302-key";
    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { code: 1, result: "task-grid" } },
      {
        ok: true,
        status: 200,
        json: {
          status: "SUCCESS",
          imageUrl: "https://file.302.ai/mj-grid.png",
          imageUrls: [
            { url: "https://file.302.ai/mj-1.png" },
            { url: "https://file.302.ai/mj-2.png" },
            { url: "https://file.302.ai/mj-3.png" },
            { url: "https://file.302.ai/mj-4.png" },
          ],
        },
      },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(18) },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(18) },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(18) },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(18) },
    ]);

    const result = await generateImage("a portrait cover", {
      fetcher,
      provider: "midjourney",
      aspectRatio: "3:4",
      mjPollIntervalMs: 1,
      mjTimeoutMs: TEST_MJ_TIMEOUT_MS,
    });

    expect(result.status).toBe("ok");
    expect(fetcher.mock.calls.slice(2).map(call => call[0])).toEqual([
      "https://file.302.ai/mj-1.png",
      "https://file.302.ai/mj-2.png",
      "https://file.302.ai/mj-3.png",
      "https://file.302.ai/mj-4.png",
    ]);
    expect(result.candidates).toHaveLength(4);
  });

  it("keeps polling after one transient Midjourney poll timeout", async () => {
    ENV.api302Key = "test-302-key";
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ code: 1, result: "task-retry" }),
      })
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: "SUCCESS",
          imageUrl: "https://file.302.ai/mj-retry.png",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(18),
      });

    const result = await generateImage("a resilient cat", {
      fetcher,
      provider: "midjourney",
      mjPollIntervalMs: 1,
      mjTimeoutMs: TEST_MJ_TIMEOUT_MS,
    });

    expect(result.status).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(isCircuitOpen()).toBe(false);
  });

  it("默认给 Midjourney 加 --turbo，但不覆盖调用方已写的模式", async () => {
    ENV.api302Key = "test-302-key";
    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { code: 1, result: "task-1" } },
      {
        ok: true,
        status: 200,
        json: { status: "SUCCESS", imageUrl: "https://file.302.ai/mj.png" },
      },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(18) },
    ]);

    const result = await generateImage("a cat --relax", {
      fetcher,
      provider: "midjourney",
      mjPollIntervalMs: 1,
      mjTimeoutMs: TEST_MJ_TIMEOUT_MS,
    });

    expect(result.status).toBe("ok");
    const submittedPrompt = JSON.parse(fetcher.mock.calls[0][1].body).prompt;
    expect(submittedPrompt).toContain("--relax");
    expect(submittedPrompt).not.toContain("--turbo");
  });

  it("存储代理失败（302 没有 storage 接口返回 503）时落本地、由 /local-images 同源提供，打通展示链路", async () => {
    ENV.api302Key = "test-302-key";
    // 模拟「把 302 网关当存储用」会触发的 503：storagePut 抛错
    vi.mocked(storagePut).mockRejectedValueOnce(
      new Error(
        "Storage upload failed (503 Service Unavailable): 当前无可用模型"
      )
    );
    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { code: 1, result: "task-1" } },
      {
        ok: true,
        status: 200,
        json: { status: "SUCCESS", imageUrl: "https://file.302.ai/mj.png" },
      },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(18) },
    ]);

    const result = await generateImage("a cat", {
      fetcher,
      provider: "midjourney",
      mjPollIntervalMs: 1,
      mjTimeoutMs: TEST_MJ_TIMEOUT_MS,
    });

    // 本地优先架构：存储 503 完全不影响出图 —— imageUrl 永远是同源稳定路由，
    // 手机从本机一定能加载到（外部图床 / 手机外网不可达时尤其关键）。
    expect(result.status).toBe("ok");
    expect(result.imageUrl).toMatch(/^\/api\/images\//);
    expect(result.imageKey).toMatch(/^generated\//);
  });

  it("supports 302 Midjourney mj-api-secret header mode", async () => {
    ENV.api302Key = "test-302-key";
    ENV.image302MjAuthHeader = "mj-api-secret";
    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { code: 1, result: "task-1" } },
      {
        ok: true,
        status: 200,
        json: { status: "SUCCESS", imageUrl: "https://file.302.ai/mj.png" },
      },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(18) },
    ]);

    const result = await generateImage("a cat", {
      fetcher,
      provider: "midjourney",
      mjPollIntervalMs: 1,
      mjTimeoutMs: TEST_MJ_TIMEOUT_MS,
    });

    expect(result.status).toBe("ok");
    expect(fetcher.mock.calls[0][1].headers["mj-api-secret"]).toBe(
      "test-302-key"
    );
  });

  it("returns error when 302 Midjourney task fails", async () => {
    ENV.api302Key = "test-302-key";
    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { code: 1, result: "task-1" } },
      {
        ok: true,
        status: 200,
        json: { status: "FAILURE", failReason: "blocked" },
      },
    ]);

    const result = await generateImage("a cat", {
      fetcher,
      provider: "midjourney",
      mjPollIntervalMs: 1,
      mjTimeoutMs: TEST_MJ_TIMEOUT_MS,
    });

    expect(result.status).toBe("error");
    expect(result.message).toBe("blocked");
  });

  it("marks a transport failure before the Midjourney receipt as submission-uncertain", async () => {
    ENV.api302Key = "test-302-key";
    const fetcher = vi.fn().mockRejectedValue(
      Object.assign(new Error("fetch failed"), {
        cause: new Error("other side closed"),
      })
    );

    const result = await generateImage("a cat", {
      fetcher,
      provider: "midjourney",
    });

    expect(result).toMatchObject({
      status: "error",
      submissionUncertain: true,
    });
    // "fetch failed" alone names no cause; the reason lives in `cause` and has
    // to survive, otherwise nothing downstream can classify the failure.
    expect(result.message).toContain("fetch failed");
    expect(result.message).toContain("other side closed");
  });

  it("returns the accepted Midjourney receipt when its persistence callback fails", async () => {
    ENV.api302Key = "test-302-key";
    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { code: 1, result: "task-kept" } },
    ]);

    const result = await generateImage("a cat", {
      fetcher,
      provider: "midjourney",
      onMidjourneyTaskAccepted: () => {
        throw new Error("local receipt write failed");
      },
    });

    expect(result).toMatchObject({
      status: "error",
      message: "local receipt write failed",
      submissionUncertain: false,
      providerTaskId: "task-kept",
    });
  });

  it("returns error when 302 Midjourney task times out", async () => {
    ENV.api302Key = "test-302-key";
    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { code: 1, result: "task-1" } },
      { ok: true, status: 200, json: { status: "IN_PROGRESS" } },
    ]);

    const result = await generateImage("a cat", {
      fetcher,
      provider: "midjourney",
      mjPollIntervalMs: 5,
      mjTimeoutMs: 1,
    });

    expect(result.status).toBe("error");
    expect(result.message).toContain("timeout");
    expect(isCircuitOpen()).toBe(true);
    expect(getImageProviderStatus()).toMatchObject({
      ready: false,
      lastFailure: {
        provider: "midjourney",
        message: "302 Midjourney task timeout",
      },
    });

    const blockedFetcher = vi.fn();
    const blocked = await generateImage("another paid request", {
      fetcher: blockedFetcher,
      provider: "midjourney",
    });
    expect(blocked.status).toBe("error");
    expect(blocked.message).toContain("暂时停用");
    expect(blockedFetcher).not.toHaveBeenCalled();
  });
});

describe("editImage", () => {
  const originalEnv = {
    api302Key: ENV.api302Key,
    api302BaseUrl: ENV.api302BaseUrl,
    image302GptModel: ENV.image302GptModel,
    image302GptSize: ENV.image302GptSize,
    image302GptQuality: ENV.image302GptQuality,
    imagePrompt302Model: ENV.imagePrompt302Model,
    imagePrompt302TimeoutMs: ENV.imagePrompt302TimeoutMs,
    vision302ApiKey: ENV.vision302ApiKey,
    vision302BaseUrl: ENV.vision302BaseUrl,
    vision302Model: ENV.vision302Model,
    openaiNextApiKey: ENV.openaiNextApiKey,
    openaiNextBaseUrl: ENV.openaiNextBaseUrl,
    openaiNextVisionModel: ENV.openaiNextVisionModel,
    forgeApiUrl: ENV.forgeApiUrl,
    forgeApiKey: ENV.forgeApiKey,
    imageProviderDefault: ENV.imageProviderDefault,
  };

  beforeEach(() => {
    resetCircuitBreaker();
    ENV.api302Key = "test-302-key";
    ENV.api302BaseUrl = "https://api.302.ai";
    ENV.image302GptModel = "gpt-image-1.5";
    ENV.image302GptSize = "1024x1024";
    ENV.image302GptQuality = "high";
    ENV.imagePrompt302Model = "";
    ENV.imagePrompt302TimeoutMs = "100";
    ENV.vision302ApiKey = "";
    ENV.vision302BaseUrl = "https://api.302.ai";
    ENV.vision302Model = "";
    ENV.openaiNextApiKey = "";
    ENV.openaiNextBaseUrl = "https://api.openai-next.com";
    ENV.openaiNextVisionModel = "qwen3-vl-plus";
    ENV.forgeApiUrl = "";
    ENV.forgeApiKey = "";
    // 这些用例专测 gpt-image 图生图 → Forge 的兜底链；显式钉成 gpt-image，
    // 避开「默认 provider=midjourney 时图生图先走 MJ」的新分支。
    ENV.imageProviderDefault = "gpt-image";
  });

  afterEach(() => {
    ENV.api302Key = originalEnv.api302Key;
    ENV.api302BaseUrl = originalEnv.api302BaseUrl;
    ENV.image302GptModel = originalEnv.image302GptModel;
    ENV.image302GptSize = originalEnv.image302GptSize;
    ENV.image302GptQuality = originalEnv.image302GptQuality;
    ENV.imagePrompt302Model = originalEnv.imagePrompt302Model;
    ENV.imagePrompt302TimeoutMs = originalEnv.imagePrompt302TimeoutMs;
    ENV.vision302ApiKey = originalEnv.vision302ApiKey;
    ENV.vision302BaseUrl = originalEnv.vision302BaseUrl;
    ENV.vision302Model = originalEnv.vision302Model;
    ENV.openaiNextApiKey = originalEnv.openaiNextApiKey;
    ENV.openaiNextBaseUrl = originalEnv.openaiNextBaseUrl;
    ENV.openaiNextVisionModel = originalEnv.openaiNextVisionModel;
    ENV.forgeApiUrl = originalEnv.forgeApiUrl;
    ENV.forgeApiKey = originalEnv.forgeApiKey;
    ENV.imageProviderDefault = originalEnv.imageProviderDefault;
  });

  it("302-only 时走 images edits multipart 并存储返回图片", async () => {
    const b64 = Buffer.from("edited-image").toString("base64");
    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { data: [{ b64_json: b64 }] } },
    ]);

    const result = await editImage(
      "data:image/png;base64,aW1hZ2U=",
      "把这张照片改成夜晚微光",
      { fetcher }
    );

    expect(result.status).toBe("ok");
    expect(result.imageUrl).toMatch(/^\/api\/images\/.+\.png$/);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain("/v1/images/edits");
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer test-302-key"
    );
    expect(fetcher.mock.calls[0][1].headers["Content-Type"]).toBeUndefined();
    const form = fetcher.mock.calls[0][1].body as FormData;
    expect(form.get("model")).toBe("gpt-image-1.5");
    expect(form.get("prompt")).toBe("把这张照片改成夜晚微光");
    expect(form.get("image")).toBeTruthy();
  });

  it("未显式选择 MJ 时 referenceImageUrl 优先用 FLUX Kontext", async () => {
    const b64 = Buffer.from("kontext-image").toString("base64");
    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { data: [{ b64_json: b64 }] } },
    ]);

    const result = await editImage(
      "data:image/png;base64,b2xkLW1haW4taW1hZ2U=",
      "跟随视频参考的画风重绘",
      {
        fetcher,
        provider: "gpt-image",
        referenceImageUrl: "data:image/png;base64,cmVmZXJlbmNlLWZyYW1l",
        referenceIdentityImageUrl: "data:image/png;base64,aWRlbnRpdHktY3JvcA==",
      }
    );

    expect(result.status).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain("/v1/images/generations");
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.model).toBe("flux-kontext-pro");
    expect(body.input_image).toBe("data:image/png;base64,cmVmZXJlbmNlLWZyYW1l");
    expect(body.prompt).toContain("Reference identity lock");
    expect(body.prompt).toContain("face outline and proportions");
    expect(body.prompt).toContain("Lower-face continuity is critical");
    expect(body.prompt).toContain("do not round, widen, square off");
    expect(body.prompt).toContain("decorative eye motifs");
    expect(body.prompt).toContain("跟随视频参考的画风重绘");
  });

  it("有透明遮罩时优先走 302 GPT-image edits，并把 mask 作为 multipart 上传", async () => {
    const source = await makeSolidPng(255, 0, 0);
    const generated = await makeSolidPng(0, 0, 255);
    const mask = await makeSolidPng(0, 0, 0, 0);
    const fetcher = makeFetcher([
      {
        ok: true,
        status: 200,
        json: { data: [{ b64_json: generated.toString("base64") }] },
      },
    ]);

    const result = await editImage(
      `data:image/png;base64,${source.toString("base64")}`,
      "只把白色短裙延长为裙摆触地的白色及地长裙",
      {
        fetcher,
        provider: "gpt-image",
        referenceImageUrl: `data:image/png;base64,${source.toString("base64")}`,
        editMaskImageUrl: `data:image/png;base64,${mask.toString("base64")}`,
      }
    );

    expect(result.status).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain("/v1/images/edits");
    const form = fetcher.mock.calls[0][1].body as FormData;
    expect(form.get("model")).toBe("gpt-image-1.5");
    expect(form.get("size")).toBe("1024x1024");
    expect(form.get("quality")).toBe("high");
    expect(form.get("image")).toBeTruthy();
    expect(form.get("mask")).toBeTruthy();
    expect(form.get("prompt")).toBe("只把白色短裙延长为裙摆触地的白色及地长裙");
  });

  it("遮罩编辑保存结果时强制保留遮罩外的原图像素", async () => {
    const source = await sharp(
      Buffer.from([
        255,
        0,
        0,
        255, // editable red pixel
        0,
        255,
        0,
        255, // protected green pixel
      ]),
      { raw: { width: 2, height: 1, channels: 4 } }
    )
      .png()
      .toBuffer();
    const generated = await sharp(
      Buffer.from([
        0,
        0,
        255,
        255, // edited blue pixel
        255,
        255,
        0,
        255, // unwanted yellow change outside the mask
      ]),
      { raw: { width: 2, height: 1, channels: 4 } }
    )
      .png()
      .toBuffer();
    const mask = await sharp(
      Buffer.from([
        0,
        0,
        0,
        0, // transparent = editable
        0,
        0,
        0,
        255, // opaque = protected
      ]),
      { raw: { width: 2, height: 1, channels: 4 } }
    )
      .png()
      .toBuffer();
    const fetcher = makeFetcher([
      {
        ok: true,
        status: 200,
        json: { data: [{ b64_json: generated.toString("base64") }] },
      },
    ]);
    vi.mocked(storagePut).mockClear();

    const result = await editImage(
      `data:image/png;base64,${source.toString("base64")}`,
      "只修改透明遮罩内的像素",
      {
        fetcher,
        provider: "gpt-image",
        editMaskImageUrl: `data:image/png;base64,${mask.toString("base64")}`,
      }
    );

    expect(result.status).toBe("ok");
    const storedBytes = vi.mocked(storagePut).mock.calls.at(-1)?.[1];
    expect(storedBytes).toBeTruthy();
    const pixels = await sharp(Buffer.from(storedBytes!))
      .ensureAlpha()
      .raw()
      .toBuffer();
    expect([...pixels]).toEqual([
      0,
      0,
      255,
      255, // generated pixel inside the editable mask
      0,
      255,
      0,
      255, // original pixel outside the editable mask
    ]);
  });

  it("遮罩编辑允许 GPT-image 响应超过通用 30 秒上限", async () => {
    vi.useFakeTimers();
    try {
      const source = await makeSolidPng(255, 0, 0);
      const generated = await makeSolidPng(0, 0, 255);
      const mask = await makeSolidPng(0, 0, 0, 0);
      const fetcher = vi.fn().mockImplementation(
        () =>
          new Promise(resolve => {
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  status: 200,
                  json: () =>
                    Promise.resolve({
                      data: [{ b64_json: generated.toString("base64") }],
                    }),
                  arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
                }),
              31_000
            );
          })
      );

      const resultPromise = editImage(
        `data:image/png;base64,${source.toString("base64")}`,
        "只把白色短裙延长为裙摆触地的白色及地长裙",
        {
          fetcher,
          provider: "gpt-image",
          editMaskImageUrl: `data:image/png;base64,${mask.toString("base64")}`,
        }
      );
      await vi.advanceTimersByTimeAsync(31_000);

      await expect(resultPromise).resolves.toMatchObject({ status: "ok" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("FLUX 参考图编辑先提取五官脸型再生成", async () => {
    ENV.vision302ApiKey = "test-vision-key";
    ENV.vision302Model = "gemini-3-pro-preview";
    const b64 = Buffer.from("kontext-image").toString("base64");
    const identityText =
      "Small oval face, narrow pointed chin, delicate straight nose, softly full lips, pale painted skin, short dark hair silhouette, white blindfold covering the eyes with horizontal folds.";
    const fetcher = makeFetcher([
      {
        ok: true,
        status: 200,
        json: {
          choices: [{ message: { content: identityText } }],
        },
      },
      { ok: true, status: 200, json: { data: [{ b64_json: b64 }] } },
    ]);

    const result = await editImage(
      "data:image/png;base64,b2xkLW1haW4taW1hZ2U=",
      "保持画廊里的蒙眼女人，冷绿色光线",
      {
        fetcher,
        provider: "gpt-image",
        referenceImageUrl: "data:image/png;base64,cmVmZXJlbmNlLWZyYW1l",
        referenceIdentityImageUrl: "data:image/png;base64,aWRlbnRpdHktY3JvcA==",
      }
    );

    expect(result.status).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://api.302.ai/v1/chat/completions"
    );
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer test-vision-key"
    );
    const visionBody = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(visionBody.model).toBe("gemini-3-pro-preview");
    expect(visionBody.messages[0].content).toContain(
      "Prioritize lower-face geometry"
    );
    expect(visionBody.messages[1].content[0].text).toContain(
      "Be precise about the chin and mouth"
    );
    expect(visionBody.messages[1].content[1].image_url.url).toBe(
      "data:image/png;base64,aWRlbnRpdHktY3JvcA=="
    );

    expect(fetcher.mock.calls[1][0]).toContain("/v1/images/generations");
    const body = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(body.model).toBe("flux-kontext-pro");
    expect(body.input_image).toBe("data:image/png;base64,cmVmZXJlbmNlLWZyYW1l");
    expect(body.prompt).toContain("Extracted visible identity traits");
    expect(body.prompt).toContain(identityText);
    expect(body.prompt).toContain("Do not recast the face");
  });

  it("302 图生图端点失败且没有 Forge 回退时返回中文错误、不抛出", async () => {
    const fetcher = makeFetcher([{ ok: false, status: 502 }]);

    const result = await editImage(
      "data:image/jpeg;base64,aW1hZ2U=",
      "换成电影海报质感",
      { fetcher }
    );

    expect(result.status).toBe("error");
    expect(result.message).toContain("302 图生图暂时不可用");
    expect(result.message).toContain("Forge 回退也不可用");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("302 图生图不可用时回退 Forge 原图编辑链路", async () => {
    ENV.forgeApiUrl = "https://forge.example";
    ENV.forgeApiKey = "test-forge-key";
    const b64 = Buffer.from("forge-edited").toString("base64");
    const fetcher = makeFetcher([
      { ok: false, status: 503 },
      {
        ok: true,
        status: 200,
        json: { image: { b64Json: b64, mimeType: "image/png" } },
      },
    ]);

    const result = await editImage(
      "data:image/png;base64,aW1hZ2U=",
      "保留人物，换成雨夜",
      { fetcher }
    );

    expect(result.status).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toContain("/v1/images/edits");
    expect(fetcher.mock.calls[1][0]).toContain(
      "images.v1.ImageService/GenerateImage"
    );
    const forgeBody = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(forgeBody.original_images[0]).toMatchObject({
      b64Json: "aW1hZ2U=",
      mimeType: "image/png",
    });
  });

  it("provider=midjourney 时图生图走 MJ，并把照片放进 base64Array", async () => {
    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { code: 1, result: "task-1" } },
      {
        ok: true,
        status: 200,
        json: { status: "SUCCESS", imageUrl: "https://file.302.ai/mj.png" },
      },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(18) },
    ]);

    const result = await editImage(
      "data:image/png;base64,aW1hZ2U=",
      "把这一刻画成电影感画面",
      {
        fetcher,
        provider: "midjourney",
        mjPollIntervalMs: 1,
        mjTimeoutMs: TEST_MJ_TIMEOUT_MS,
      }
    );

    expect(result.status).toBe("ok");
    expect(fetcher.mock.calls[0][0]).toContain("/mj/submit/imagine");
    const submitBody = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(submitBody.base64Array).toHaveLength(1); // 照片进了 base64Array（MJ image prompt）
    expect(submitBody.base64Array[0]).toContain("base64,");
  });

  it("故事版 MJ 只传递已工程化的提示词，不在 provider 层写死服装与主色", async () => {
    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { code: 1, result: "task-context" } },
      {
        ok: true,
        status: 200,
        json: {
          status: "SUCCESS",
          imageUrl: "https://file.302.ai/mj-grid.png",
        },
      },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(18) },
    ]);

    const result = await editImage(
      "data:image/png;base64,cHJpbWFyeQ==",
      "保持人物、服装和红黑色彩，生成四宫格粗选",
      {
        fetcher,
        provider: "midjourney",
        referenceImageUrl: "data:image/png;base64,cHJpbWFyeQ==",
        referenceContextImageUrls: ["data:image/png;base64,bmVpZ2hib3I="],
        primaryReferenceLock: true,
        requireInputImage: true,
        mjPollIntervalMs: 1,
        mjTimeoutMs: TEST_MJ_TIMEOUT_MS,
      }
    );

    expect(result.status).toBe("ok");
    expect(fetcher.mock.calls[0][0]).toContain("/mj/submit/imagine");
    expect(fetcher.mock.calls[0][0]).not.toContain("/v1/images/generations");
    const submitBody = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(submitBody.base64Array).toHaveLength(1);
    expect(submitBody.prompt).toContain("保持人物、服装和红黑色彩");
    expect(submitBody.prompt).not.toContain("floor-length gown");
    expect(submitBody.prompt).not.toContain("blue, cyan, or teal cast");
  });

  it("requireInputImage=true 时 MJ 图生图失败不会回落纯文生图", async () => {
    const fetcher = makeFetcher([
      {
        ok: true,
        status: 200,
        json: { code: 0, description: "malformed image prompt" },
      },
    ]);

    const result = await editImage(
      "data:image/png;base64,aW1hZ2U=",
      "把照片重绘成故事画风的人物锚点",
      {
        fetcher,
        provider: "midjourney",
        requireInputImage: true,
        mjPollIntervalMs: 1,
        mjTimeoutMs: TEST_MJ_TIMEOUT_MS,
      }
    );

    expect(result.status).toBe("error");
    expect(result.message).toContain("未能基于输入照片完成");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const submitBody = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(submitBody.base64Array).toHaveLength(1);
  });
});

describe("inpaintImage", () => {
  const savedFalKey = ENV.falApiKey;
  beforeEach(() => {
    resetCircuitBreaker();
    // 函数已加「没 fal key 就快速失败」的守卫；现有用例靠注入 fetcher 验证网络分支，
    // 所以这里给个测试 key，让它们能越过守卫走到 fetcher。
    ENV.falApiKey = "test-fal-key";
  });
  afterEach(() => {
    ENV.falApiKey = savedFalKey;
  });

  it("returns ok with imageUrl on success", async () => {
    const fetcher = makeFetcher([
      {
        ok: true,
        status: 200,
        json: { images: [{ url: "https://fal.ai/inpainted.png" }] },
      },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(16) },
    ]);

    const result = await inpaintImage(
      "https://img.test/original.png",
      "https://img.test/mask.png",
      "old wooden chair",
      { fetcher }
    );

    expect(result.status).toBe("ok");
    expect(result.imageUrl).toBe(
      "https://storage.example.com/generated/test.png"
    );

    // Verify inpaint request body
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.image_url).toBe("https://img.test/original.png");
    expect(body.mask_url).toBe("https://img.test/mask.png");
    expect(body.prompt).toBe("old wooden chair");
  });

  it("returns error on fal.ai failure", async () => {
    const fetcher = makeFetcher([{ ok: false, status: 503 }]);

    const result = await inpaintImage(
      "https://img.test/original.png",
      "https://img.test/mask.png",
      "old wooden chair",
      { fetcher }
    );

    expect(result.status).toBe("error");
    expect(result.message).toContain("503");
  });

  it("没配 FAL_KEY 时立即报清晰错误、不打网络（这就是修掉「喂图 timeout」的那道守卫）", async () => {
    ENV.falApiKey = ""; // 用户的真实情况：只有 302 key，没有 fal key
    const fetcher = vi.fn();

    const result = await inpaintImage(
      "https://img.test/original.png",
      "https://img.test/mask.png",
      "old wooden chair",
      { fetcher }
    );

    expect(result.status).toBe("error");
    expect(result.message).toContain("fal.ai"); // 看得懂的中文提示，而不是裸 "timeout"
    expect(fetcher).not.toHaveBeenCalled(); // 关键：根本没去打 fal.run，不会再挂 30s
  });
});

describe("Midjourney 角色参考 / 风格参考（U4 跨镜头一致）", () => {
  const saved = {
    imageProviderDefault: ENV.imageProviderDefault,
    api302Key: ENV.api302Key,
    image302MjPollMs: ENV.image302MjPollMs,
    image302MjSubmitTimeoutMs: ENV.image302MjSubmitTimeoutMs,
    image302MjTimeoutMs: ENV.image302MjTimeoutMs,
  };

  beforeEach(() => {
    resetCircuitBreaker();
    ENV.imageProviderDefault = "midjourney";
    ENV.api302Key = "test-302-key";
    ENV.image302MjPollMs = "1";
    ENV.image302MjSubmitTimeoutMs = "200";
    ENV.image302MjTimeoutMs = String(TEST_MJ_TIMEOUT_MS);
  });

  afterEach(() => {
    ENV.imageProviderDefault = saved.imageProviderDefault;
    ENV.api302Key = saved.api302Key;
    ENV.image302MjPollMs = saved.image302MjPollMs;
    ENV.image302MjSubmitTimeoutMs = saved.image302MjSubmitTimeoutMs;
    ENV.image302MjTimeoutMs = saved.image302MjTimeoutMs;
  });

  // MJ 文生图三步：submit → poll(SUCCESS) → 下载
  function mjFetcher(imageUrl = "https://file.302.ai/out.png") {
    return makeFetcher([
      { ok: true, status: 200, json: { code: 1, result: "task123" } },
      { ok: true, status: 200, json: { status: "SUCCESS", imageUrl } },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(16) },
    ]);
  }

  it("characterRef（公网 URL）→ 提交给 MJ 的 prompt 追加 v7 --oref <url>", async () => {
    const fetcher = mjFetcher();
    const result = await generateImage("a person walking in the rain", {
      fetcher,
      characterRef: "https://file.302.ai/hero.png",
    });
    expect(result.status).toBe("ok");
    const submitBody = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(submitBody.prompt).toContain("--oref https://file.302.ai/hero.png");
    expect(submitBody.prompt).toContain("--v 7");
    expect(submitBody.prompt).not.toContain("--cref");
  });

  it("styleRef（公网 URL）→ 提交给 MJ 的 prompt 追加 --sref <url>", async () => {
    const fetcher = mjFetcher();
    await generateImage("a quiet room", {
      fetcher,
      styleRef: "https://file.302.ai/style.png",
    });
    const submitBody = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(submitBody.prompt).toContain("--sref https://file.302.ai/style.png");
  });

  it("mjDraft → 提交给 MJ 的 prompt 使用 v7 --draft，且不再追加 turbo", async () => {
    const fetcher = mjFetcher();
    await generateImage("a quiet office doorway", {
      fetcher,
      mjDraft: true,
    });
    const submitBody = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(submitBody.prompt).toContain("--draft");
    expect(submitBody.prompt).toContain("--v 7");
    expect(submitBody.prompt).not.toContain("--turbo");
    expect(submitBody.prompt).not.toContain("--quality 0.25");
  });

  it("无 characterRef/styleRef → prompt 不含 --oref/--sref，也不强制 v7", async () => {
    const fetcher = mjFetcher();
    await generateImage("a plain scene", { fetcher });
    const submitBody = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(submitBody.prompt).not.toContain("--oref");
    expect(submitBody.prompt).not.toContain("--sref");
    expect(submitBody.prompt).not.toContain("--v 7");
  });

  it("data URI 的 characterRef → 不追加 --oref（oref 需公网 URL，降级垫图）", async () => {
    const fetcher = mjFetcher();
    await generateImage("a scene", {
      fetcher,
      characterRef: "data:image/png;base64,AAAA",
    });
    const submitBody = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(submitBody.prompt).not.toContain("--oref");
    expect(submitBody.prompt).not.toContain("--v 7");
  });

  it("MJ 出图默认追加单镜头规则和负面词（压制拼贴/分屏/多小图）", async () => {
    const fetcher = mjFetcher();
    await generateImage("a person holding stones", { fetcher });
    const submitBody = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(submitBody.prompt).toContain("Single-frame rule:");
    expect(submitBody.prompt).toContain("--no");
    expect(submitBody.prompt).toMatch(/deformed hands|extra fingers/);
    const noSection = submitBody.prompt.split("--no")[1] ?? "";
    expect(noSection).toMatch(/collage|thumbnails|panels/);
    expect(noSection).toMatch(/text/);
    expect(noSection).toMatch(/letters/);
    expect(noSection).toMatch(/numbers/);
    expect(noSection).toMatch(/signage/);
    expect(noSection).not.toMatch(
      /multi-panel|side-by-side|contact sheet|poster board|水印/
    );
  });

  it("断连失败保留 cause，任务编号才不会被当成不可恢复", async () => {
    const terminated = Object.assign(new Error("terminated"), {
      cause: "SocketError: other side closed",
    });
    const fetcher = vi
      .fn()
      // Submit accepts the paid job, Midjourney reports SUCCESS, and the socket
      // then drops while the finished images are being downloaded.
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ code: 1, result: "task-terminated" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: "SUCCESS",
          imageUrl: "https://file.302.ai/out.png",
        }),
      })
      .mockRejectedValue(terminated);
    const onMidjourneyTaskAccepted = vi.fn();

    const result = await generateImage("a woman before an audience", {
      fetcher,
      onMidjourneyTaskAccepted,
    });

    expect(onMidjourneyTaskAccepted).toHaveBeenCalledWith("task-terminated");
    expect(result.status).toBe("error");
    // The bare "terminated" reads as unrecoverable; the cause is what proves
    // this was a transport drop over an already-paid job.
    expect(result.message).toContain("terminated");
    expect(result.message).toContain("other side closed");
  });

  it("图生图断连时保留「提交结果未知」，不把可能已扣费的任务说成安全失败", async () => {
    const fetcher = vi.fn().mockRejectedValue(
      Object.assign(new Error("fetch failed"), {
        cause: "SocketError: other side closed",
      })
    );

    const result = await editImage(
      "data:image/png;base64,cGljaw==",
      "a scene",
      { fetcher, provider: "midjourney", requireInputImage: true }
    );

    expect(result.status).toBe("error");
    expect(result.message).toContain("图生图未能基于输入照片完成");
    // Dropping this flag is what lets the UI offer a retry on a job 302 may
    // already have accepted and billed.
    expect(result.submissionUncertain).toBe(true);
  });

  it("图生图失败但已拿到任务编号时，付费凭据必须继续向上传递", async () => {
    const fetcher = vi
      .fn()
      // Submit is accepted (paid), then the connection dies while polling.
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ code: 1, result: "task-edit-paid" }),
      })
      .mockRejectedValue(new Error("terminated"));

    const result = await editImage(
      "data:image/png;base64,cGljaw==",
      "a scene",
      {
        fetcher,
        provider: "midjourney",
        requireInputImage: true,
        mjPollIntervalMs: 1,
        mjTimeoutMs: TEST_MJ_TIMEOUT_MS,
      }
    );

    expect(result.status).toBe("error");
    expect(result.providerTaskId).toBe("task-edit-paid");
  });

  it("MJ 图生图把参考图压成小体积再提交，避免数 MB 请求体被网络切断", async () => {
    // A cover candidate is a multi-megabyte PNG; raw base64 pushes one submit
    // past 8 MB with three references, which is what keeps getting cut.
    // Noise, not flat colour: real cover art barely compresses as PNG, which is
    // why the candidates on disk are 1.6–2.0 MB apiece.
    const width = 700;
    const height = 900;
    const noise = randomBytes(width * height * 3);
    const bigPng = await sharp(noise, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer();
    const rawBase64Bytes = Math.ceil((bigPng.byteLength * 4) / 3);
    expect(rawBase64Bytes).toBeGreaterThan(1_000_000);

    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { code: 1, result: "task-compressed" } },
      {
        ok: true,
        status: 200,
        json: { status: "SUCCESS", imageUrl: "https://file.302.ai/out.png" },
      },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(16) },
    ]);

    await editImage(
      `data:image/png;base64,${bigPng.toString("base64")}`,
      "a woman before an audience",
      { fetcher, provider: "midjourney", requireInputImage: true }
    );

    const submitBody = JSON.parse(fetcher.mock.calls[0][1].body);
    const sent: string[] = submitBody.base64Array;
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/^data:image\/jpeg;base64,/);
    expect(sent[0]!.length).toBeLessThan(rawBase64Bytes);
    // Pure noise is JPEG's worst case — real cover art compresses far harder.
    // Even so, three references must stay well below the multi-megabyte POST
    // size this network keeps cutting.
    expect(sent[0]!.length).toBeLessThan(rawBase64Bytes / 4);
    expect(sent[0]!.length).toBeLessThan(800_000);
  }, 20_000);

  it("图生图失败改写文案时不丢「提交结果未知」，避免把可能已扣费的提交说成安全重试", async () => {
    // The socket dies before 302 returns a task id: nothing proves the paid job
    // was rejected, so the uncertainty must survive the message rewrite.
    const fetcher = vi.fn().mockRejectedValue(
      Object.assign(new Error("fetch failed"), {
        cause: "SocketError: other side closed",
      })
    );

    // A data URI reference needs no download, so the only fetch — the one that
    // drops — is the paid /mj/submit/imagine call itself.
    const result = await editImage(
      "data:image/png;base64,aW1hZ2U=",
      "a woman before an audience",
      { fetcher, provider: "midjourney", requireInputImage: true }
    );

    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("/mj/submit/imagine"),
      expect.anything()
    );

    expect(result.status).toBe("error");
    expect(result.message).toContain("MJ 图生图未能基于输入照片完成");
    expect(result.submissionUncertain).toBe(true);
  });

  it("MJ 负面词压制会自带文字的版式与印刷装饰（杂志封面/刊头/边框/签名）", async () => {
    const fetcher = mjFetcher();
    await generateImage("a person standing among roots", { fetcher });
    const submitBody = JSON.parse(fetcher.mock.calls[0][1].body);
    const noSection = submitBody.prompt.split("--no")[1] ?? "";
    for (const term of [
      "magazine cover",
      "masthead",
      "poster",
      "newspaper",
      "barcode",
      "watermark",
      "border",
      "artist signature",
    ]) {
      expect(noSection).toContain(term);
    }
  });

  it("已显式带 --no 时合并不可覆盖的无字负面词且不重复参数", async () => {
    const fetcher = mjFetcher();
    await generateImage("a cat --no dogs", { fetcher });
    const submitBody = JSON.parse(fetcher.mock.calls[0][1].body);
    expect((submitBody.prompt.match(/--no/g) || []).length).toBe(1);
    expect(submitBody.prompt.indexOf("Single-frame rule:")).toBeLessThan(
      submitBody.prompt.indexOf("--no dogs")
    );
    const noSection = submitBody.prompt.split("--no")[1] ?? "";
    expect(noSection).toMatch(/dogs/);
    expect(noSection).toMatch(/text/);
    expect(noSection).toMatch(/letters/);
    expect(noSection).toMatch(/numbers/);
    expect(noSection).toMatch(/logos/);
  });

  it("用户明确要求拼贴/多镜头时不追加单镜头禁令", async () => {
    const fetcher = mjFetcher();
    await generateImage("make this a four panel collage of memories", {
      fetcher,
    });
    const submitBody = JSON.parse(fetcher.mock.calls[0][1].body);
    const noSection = submitBody.prompt.split("--no")[1] ?? "";
    expect(submitBody.prompt).not.toContain("Single-frame rule:");
    expect(noSection).toMatch(/deformed hands|extra fingers/);
    expect(noSection).not.toMatch(/collage|panels|storyboard|grid/);
  });

  it("characterWeight 跟随 oref → prompt 追加 --ow（人物锁定强度）", async () => {
    const fetcher = mjFetcher();
    await generateImage("a person", {
      fetcher,
      characterRef: "https://file.302.ai/hero.png",
      characterWeight: 100,
    });
    const submitBody = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(submitBody.prompt).toContain("--oref https://file.302.ai/hero.png");
    expect(submitBody.prompt).toContain("--ow 100");
    expect(submitBody.prompt).toContain("--v 7");
  });

  it("MJ submit 使用独立超时，不受任务轮询总超时限制", async () => {
    const fetcher = vi.fn().mockImplementation(() => new Promise(() => {}));

    const result = await generateImage("a slow submit", {
      fetcher,
      mjSubmitTimeoutMs: 1,
      mjTimeoutMs: 10_000,
    });

    expect(result.status).toBe("error");
    expect(result.message).toBe("timeout");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("草稿图使用独立短超时，避免快轨卡成慢轨", async () => {
    ENV.api302Key = "test-302-key";
    ENV.image302DraftTimeoutMs = "1";
    const fetcher = vi.fn().mockImplementation(() => new Promise(() => {}));

    const result = await generateDraftImage("a fast storyboard sketch", {
      fetcher,
    });

    expect(result.status).toBe("error");
    expect(result.message).toBe("timeout");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("imageWeight（图生图）→ prompt 追加 --iw（场景/垫图强度）", async () => {
    const fetcher = makeFetcher([
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(8) }, // readImageInput 下载垫图
      { ok: true, status: 200, json: { code: 1, result: "task" } }, // submit
      {
        ok: true,
        status: 200,
        json: { status: "SUCCESS", imageUrl: "https://file.302.ai/out.png" },
      }, // poll
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(8) }, // download
    ]);
    await editImage("https://file.302.ai/base.png", "a scene", {
      fetcher,
      imageWeight: 0.5,
    });
    const submitBody = JSON.parse(fetcher.mock.calls[1][1].body); // submit 是第 2 个 call
    expect(submitBody.prompt).toContain("--iw 0.5");
  });
});
