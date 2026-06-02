import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateImage,
  inpaintImage,
  isCircuitOpen,
  resetCircuitBreaker,
} from "./imageGen";
import { ENV } from "../_core/env";

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
  json?: unknown;
  arrayBuffer?: ArrayBuffer;
}>) {
  let callIndex = 0;
  return vi.fn().mockImplementation(() => {
    const resp = responses[callIndex++] ?? responses[responses.length - 1];
    return Promise.resolve({
      ok: resp.ok,
      status: resp.status,
      json: () => Promise.resolve(resp.json ?? {}),
      arrayBuffer: () => Promise.resolve(resp.arrayBuffer ?? new ArrayBuffer(8)),
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
  };

  beforeEach(() => {
    resetCircuitBreaker();
    ENV.imageProviderDefault = "fal";
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
    expect(result.message).toContain("no images");
  });

  it("returns error on 302 GPT-image timeout", async () => {
    ENV.api302Key = "test-302-key";
    const fetcher = vi.fn().mockRejectedValue(new Error("timeout"));

    const result = await generateImage("a cat", { fetcher, provider: "gpt-image" });

    expect(result.status).toBe("error");
    expect(result.message).toBe("timeout");
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
    expect(fetcher.mock.calls[1][0]).toContain("/mj/task/task-1/fetch");
    expect(fetcher.mock.calls[3][0]).toBe("https://file.302.ai/mj.png");
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

describe("inpaintImage", () => {
  beforeEach(() => {
    resetCircuitBreaker();
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
});
