import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  segmentAtPoint,
  isCircuitOpen,
  resetCircuitBreaker,
} from "./segmentation";

// ── Mocks ──

vi.mock("../storage", () => ({
  storagePut: vi.fn().mockResolvedValue({
    key: "masks/test.png",
    url: "https://storage.example.com/masks/test.png",
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

describe("segmentAtPoint", () => {
  beforeEach(() => {
    resetCircuitBreaker();
  });

  it("returns mask when SAM2 finds an object", async () => {
    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { masks: [{ url: "https://fal.ai/mask.png" }] } },
      { ok: true, status: 200, arrayBuffer: new ArrayBuffer(16) },
    ]);

    const result = await segmentAtPoint("https://img.test/photo.png", 100, 200, { fetcher });

    expect(result.status).toBe("ok");
    expect(result.maskUrl).toBe("https://storage.example.com/masks/test.png");
    expect(result.maskKey).toBe("masks/test.png");
    expect(fetcher).toHaveBeenCalledTimes(2);

    // Verify SAM2 request body
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toContain("sam2");
    const body = JSON.parse(init.body);
    expect(body.point_coords).toEqual([[100, 200]]);
    expect(body.point_labels).toEqual([1]);
  });

  it("returns null mask when clicking empty area", async () => {
    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { masks: [] } },
    ]);

    const result = await segmentAtPoint("https://img.test/photo.png", 0, 0, { fetcher });

    expect(result.status).toBe("ok");
    expect(result.maskUrl).toBeNull();
    expect(result.maskKey).toBeNull();
  });

  it("returns error on SAM2 API failure", async () => {
    const fetcher = makeFetcher([
      { ok: false, status: 500 },
    ]);

    const result = await segmentAtPoint("https://img.test/photo.png", 50, 50, { fetcher });

    expect(result.status).toBe("error");
    expect(result.message).toContain("500");
  });

  it("returns error on timeout", async () => {
    const fetcher = vi.fn().mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 50)),
    );

    const result = await segmentAtPoint("https://img.test/photo.png", 50, 50, { fetcher });

    expect(result.status).toBe("error");
    expect(result.message).toBe("timeout");
  });

  it("opens circuit breaker after 3 consecutive failures", async () => {
    const fetcher = makeFetcher([{ ok: false, status: 500 }]);

    await segmentAtPoint("https://img.test/a.png", 0, 0, { fetcher });
    await segmentAtPoint("https://img.test/b.png", 0, 0, { fetcher });
    await segmentAtPoint("https://img.test/c.png", 0, 0, { fetcher });

    expect(isCircuitOpen()).toBe(true);

    // Subsequent requests short-circuit without calling fetcher
    const freshFetcher = vi.fn();
    const result = await segmentAtPoint("https://img.test/d.png", 0, 0, { fetcher: freshFetcher });

    expect(result.status).toBe("error");
    expect(result.message).toBe("circuit breaker open");
    expect(freshFetcher).not.toHaveBeenCalled();
  });
});
