import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateImage,
  inpaintImage,
  isCircuitOpen,
  resetCircuitBreaker,
} from "./imageGen";

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
  beforeEach(() => {
    resetCircuitBreaker();
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
