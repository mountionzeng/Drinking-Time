import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  editImage,
  generateImage,
  inpaintImage,
  isCircuitOpen,
  resetCircuitBreaker,
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

function makeFetcher(responses: Array<{
  ok: boolean;
  status: number;
  statusText?: string;
  json?: unknown;
  arrayBuffer?: ArrayBuffer;
  text?: string;
}>) {
  let callIndex = 0;
  return vi.fn().mockImplementation(() => {
    const resp = responses[callIndex++] ?? responses[responses.length - 1];
    return Promise.resolve({
      ok: resp.ok,
      status: resp.status,
      statusText: resp.statusText,
      json: () => Promise.resolve(resp.json ?? {}),
      arrayBuffer: () => Promise.resolve(resp.arrayBuffer ?? new ArrayBuffer(8)),
      text: () => Promise.resolve(resp.text ?? ""),
    });
  });
}

describe("generateImage", () => {
  const originalEnv = {
    imageProviderDefault: ENV.imageProviderDefault,
    api302Key: ENV.api302Key,
    api302BaseUrl: ENV.api302BaseUrl,
    image302GptModel: ENV.image302GptModel,
    image302GptSize: ENV.image302GptSize,
    image302GptQuality: ENV.image302GptQuality,
    image302MjAuthHeader: ENV.image302MjAuthHeader,
    image302MjPollMs: ENV.image302MjPollMs,
    image302MjTimeoutMs: ENV.image302MjTimeoutMs,
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
    ENV.image302MjAuthHeader = "bearer";
    ENV.image302MjPollMs = "1";
    ENV.image302MjTimeoutMs = "100";
  });

  afterEach(() => {
    ENV.imageProviderDefault = originalEnv.imageProviderDefault;
    ENV.api302Key = originalEnv.api302Key;
    ENV.api302BaseUrl = originalEnv.api302BaseUrl;
    ENV.image302GptModel = originalEnv.image302GptModel;
    ENV.image302GptSize = originalEnv.image302GptSize;
    ENV.image302GptQuality = originalEnv.image302GptQuality;
    ENV.image302MjAuthHeader = originalEnv.image302MjAuthHeader;
    ENV.image302MjPollMs = originalEnv.image302MjPollMs;
    ENV.image302MjTimeoutMs = originalEnv.image302MjTimeoutMs;
    ENV.falApiKey = originalEnv.falApiKey;
  });

  it("returns ok with imageUrl on success", async () => {
    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { images: [{ url: "https://fal.ai/result.png" }] } },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(16) },
    ]);

    const result = await generateImage("a cat", { fetcher });

    expect(result.status).toBe("ok");
    expect(result.imageUrl).toBe("https://storage.example.com/generated/test.png");
    expect(result.imageKey).toBe("generated/test.png");
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
    const fetcher = vi.fn().mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 50)),
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
    expect(result.message).toBe("circuit breaker open");
    expect(freshFetcher).not.toHaveBeenCalled();
  });

  it("passes aspectRatio and seed to fal.ai", async () => {
    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { images: [{ url: "https://fal.ai/r.png" }] } },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(8) },
    ]);

    await generateImage("a cat", { fetcher, aspectRatio: "16:9", seed: 42 });

    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.aspect_ratio).toBe("16:9");
    expect(body.seed).toBe(42);
  });

  it("falls back to fal.ai when 302 provider is selected without a key", async () => {
    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { images: [{ url: "https://fal.ai/r.png" }] } },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(8) },
    ]);

    const result = await generateImage("a cat", { fetcher, provider: "gpt-image" });

    expect(result.status).toBe("ok");
    expect(fetcher.mock.calls[0][0]).toContain("fal-ai/flux-pro");
  });

  it("redirects fal→302 GPT-image when no fal key but a 302 key exists", async () => {
    const savedFalKey = ENV.falApiKey;
    ENV.falApiKey = ""; // 本机没有 fal key
    ENV.api302Key = "test-302-key"; // 却配了 302 key
    try {
      const fetcher = makeFetcher([
        { ok: true, status: 200, json: { data: [{ url: "https://file.302.ai/r.png" }] } },
        { ok: true, status: 200, arrayBuffer: new ArrayBuffer(8) },
      ]);
      // 不传 provider → 默认 resolve 成 fal；但没 fal key、有 302 key → 应自动改走 302 gpt-image
      const result = await generateImage("a cat", { fetcher });
      expect(result.status).toBe("ok");
      expect(fetcher.mock.calls[0][0]).toContain("/v1/images/generations");
      expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer test-302-key");
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
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer test-302-key");
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.model).toBe("gpt-image-1.5");
    expect(body.prompt).toBe("a cat");
    expect(body.size).toBe("1536x1024");
  });

  it("uses 302 GPT-image url response and downloads before storage", async () => {
    ENV.api302Key = "test-302-key";
    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { data: [{ url: "https://file.302.ai/result.png" }] } },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(12) },
    ]);

    const result = await generateImage("a cat", { fetcher, provider: "gpt-image" });

    expect(result.status).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toBe("https://file.302.ai/result.png");
  });

  it("returns error on 302 GPT-image HTTP failure", async () => {
    ENV.api302Key = "test-302-key";
    const fetcher = makeFetcher([{ ok: false, status: 502 }]);

    const result = await generateImage("a cat", { fetcher, provider: "gpt-image" });

    expect(result.status).toBe("error");
    expect(result.message).toContain("502");
  });

  it("returns error when 302 GPT-image returns no images", async () => {
    ENV.api302Key = "test-302-key";
    const fetcher = makeFetcher([{ ok: true, status: 200, json: { data: [] } }]);

    const result = await generateImage("a cat", { fetcher, provider: "gpt-image" });

    expect(result.status).toBe("error");
    expect(result.message).toContain("没有返回图片");
  });

  it("returns error on 302 GPT-image timeout", async () => {
    ENV.api302Key = "test-302-key";
    const fetcher = vi.fn().mockRejectedValue(new Error("timeout"));

    const result = await generateImage("a cat", { fetcher, provider: "gpt-image" });

    expect(result.status).toBe("error");
    expect(result.message).toContain("302 GPT-image 生成失败");
    expect(result.message).toContain("timeout");
  });

  it("uses 302 Midjourney submit, polls, downloads, and stores image", async () => {
    ENV.api302Key = "test-302-key";
    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { code: 1, result: "task-1" } },
      { ok: true, status: 200, json: { status: "IN_PROGRESS", progress: "50%" } },
      { ok: true, status: 200, json: { status: "SUCCESS", imageUrl: "https://file.302.ai/mj.png" } },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(18) },
    ]);

    const result = await generateImage("a cat", {
      fetcher,
      provider: "midjourney",
      aspectRatio: "16:9",
      mjPollIntervalMs: 1,
      mjTimeoutMs: 100,
    });

    expect(result.status).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[0][0]).toContain("/mj/submit/imagine");
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer test-302-key");
    expect(JSON.parse(fetcher.mock.calls[0][1].body).prompt).toContain("--ar 16:9");
    expect(JSON.parse(fetcher.mock.calls[0][1].body).prompt).toContain("--turbo");
    expect(fetcher.mock.calls[1][0]).toContain("/mj/task/task-1/fetch");
    expect(fetcher.mock.calls[3][0]).toBe("https://file.302.ai/mj.png");
  });

  it("默认给 Midjourney 加 --turbo，但不覆盖调用方已写的模式", async () => {
    ENV.api302Key = "test-302-key";
    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { code: 1, result: "task-1" } },
      { ok: true, status: 200, json: { status: "SUCCESS", imageUrl: "https://file.302.ai/mj.png" } },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(18) },
    ]);

    const result = await generateImage("a cat --relax", {
      fetcher,
      provider: "midjourney",
      mjPollIntervalMs: 1,
      mjTimeoutMs: 100,
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
      new Error("Storage upload failed (503 Service Unavailable): 当前无可用模型"),
    );
    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { code: 1, result: "task-1" } },
      { ok: true, status: 200, json: { status: "SUCCESS", imageUrl: "https://file.302.ai/mj.png" } },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(18) },
    ]);

    const result = await generateImage("a cat", {
      fetcher,
      provider: "midjourney",
      mjPollIntervalMs: 1,
      mjTimeoutMs: 100,
    });

    // 不再因为存储 503 整条失败，也不再依赖外部图床：落到本地、由 /local-images 同源提供，
    // 手机从本机一定能加载到（外部图床 / 手机外网不可达时尤其关键）。
    expect(result.status).toBe("ok");
    expect(result.imageUrl).toMatch(/^\/local-images\//);
    expect(result.imageKey).toMatch(/^\/local-images\//);
  });

  it("supports 302 Midjourney mj-api-secret header mode", async () => {
    ENV.api302Key = "test-302-key";
    ENV.image302MjAuthHeader = "mj-api-secret";
    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { code: 1, result: "task-1" } },
      { ok: true, status: 200, json: { status: "SUCCESS", imageUrl: "https://file.302.ai/mj.png" } },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(18) },
    ]);

    const result = await generateImage("a cat", {
      fetcher,
      provider: "midjourney",
      mjPollIntervalMs: 1,
      mjTimeoutMs: 100,
    });

    expect(result.status).toBe("ok");
    expect(fetcher.mock.calls[0][1].headers["mj-api-secret"]).toBe("test-302-key");
  });

  it("returns error when 302 Midjourney task fails", async () => {
    ENV.api302Key = "test-302-key";
    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { code: 1, result: "task-1" } },
      { ok: true, status: 200, json: { status: "FAILURE", failReason: "blocked" } },
    ]);

    const result = await generateImage("a cat", {
      fetcher,
      provider: "midjourney",
      mjPollIntervalMs: 1,
      mjTimeoutMs: 100,
    });

    expect(result.status).toBe("error");
    expect(result.message).toBe("blocked");
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
  });
});

describe("editImage", () => {
  const originalEnv = {
    api302Key: ENV.api302Key,
    api302BaseUrl: ENV.api302BaseUrl,
    image302GptModel: ENV.image302GptModel,
    image302GptSize: ENV.image302GptSize,
    image302GptQuality: ENV.image302GptQuality,
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
      { fetcher },
    );

    expect(result.status).toBe("ok");
    expect(result.imageUrl).toBe("https://storage.example.com/generated/test.png");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain("/v1/images/edits");
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer test-302-key");
    expect(fetcher.mock.calls[0][1].headers["Content-Type"]).toBeUndefined();
    const form = fetcher.mock.calls[0][1].body as FormData;
    expect(form.get("model")).toBe("gpt-image-1.5");
    expect(form.get("prompt")).toBe("把这张照片改成夜晚微光");
    expect(form.get("image")).toBeTruthy();
  });

  it("302 图生图端点失败且没有 Forge 回退时返回中文错误、不抛出", async () => {
    const fetcher = makeFetcher([{ ok: false, status: 502 }]);

    const result = await editImage(
      "data:image/jpeg;base64,aW1hZ2U=",
      "换成电影海报质感",
      { fetcher },
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
      { ok: true, status: 200, json: { image: { b64Json: b64, mimeType: "image/png" } } },
    ]);

    const result = await editImage(
      "data:image/png;base64,aW1hZ2U=",
      "保留人物，换成雨夜",
      { fetcher },
    );

    expect(result.status).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toContain("/v1/images/edits");
    expect(fetcher.mock.calls[1][0]).toContain("images.v1.ImageService/GenerateImage");
    const forgeBody = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(forgeBody.original_images[0]).toMatchObject({
      b64Json: "aW1hZ2U=",
      mimeType: "image/png",
    });
  });

  it("provider=midjourney 时图生图走 MJ，并把照片放进 base64Array", async () => {
    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { code: 1, result: "task-1" } },
      { ok: true, status: 200, json: { status: "SUCCESS", imageUrl: "https://file.302.ai/mj.png" } },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(18) },
    ]);

    const result = await editImage(
      "data:image/png;base64,aW1hZ2U=",
      "把这一刻画成电影感画面",
      { fetcher, provider: "midjourney", mjPollIntervalMs: 1, mjTimeoutMs: 100 },
    );

    expect(result.status).toBe("ok");
    expect(fetcher.mock.calls[0][0]).toContain("/mj/submit/imagine");
    const submitBody = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(submitBody.base64Array).toHaveLength(1); // 照片进了 base64Array（MJ image prompt）
    expect(submitBody.base64Array[0]).toContain("base64,");
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
      { ok: true, status: 200, json: { images: [{ url: "https://fal.ai/inpainted.png" }] } },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(16) },
    ]);

    const result = await inpaintImage(
      "https://img.test/original.png",
      "https://img.test/mask.png",
      "old wooden chair",
      { fetcher },
    );

    expect(result.status).toBe("ok");
    expect(result.imageUrl).toBe("https://storage.example.com/generated/test.png");

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
      { fetcher },
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
      { fetcher },
    );

    expect(result.status).toBe("error");
    expect(result.message).toContain("fal.ai"); // 看得懂的中文提示，而不是裸 "timeout"
    expect(fetcher).not.toHaveBeenCalled(); // 关键：根本没去打 fal.run，不会再挂 30s
  });
});
