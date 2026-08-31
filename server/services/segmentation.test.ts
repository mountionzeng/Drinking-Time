import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import sharp from "sharp";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  resolveStoredMaskUrl,
  segmentAtPoint,
  segmentWithinPolygon,
  isCircuitOpen,
  resetCircuitBreaker,
} from "./segmentation";
import { ENV } from "../_core/env";
import { storageGet, storagePut } from "../storage";
import { invokeVisionJson, visionChannelConfigured } from "./visionChannel";

vi.mock("./visionChannel", () => ({
  invokeVisionJson: vi.fn(),
  visionChannelConfigured: vi.fn(() => false),
}));

// ── Mocks ──

vi.mock("../storage", () => ({
  storagePut: vi.fn().mockImplementation(async (key: string) => ({
    key,
    url: `https://storage.example.com/${key}`,
  })),
  storageGet: vi.fn().mockImplementation(async (key: string) => ({
    key,
    url: `https://storage.example.com/${key}`,
  })),
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
  const savedFalKey = ENV.falApiKey;
  let sourceBytes: Buffer;
  let selectedMaskBytes: Buffer;
  let invalidMaskBytes: Buffer;
  beforeEach(async () => {
    resetCircuitBreaker();
    vi.mocked(storagePut).mockClear();
    vi.mocked(storagePut).mockImplementation(async (key: string) => ({
      key,
      url: `https://storage.example.com/${key}`,
    }));
    // 函数已加「没 fal key 就快速失败」的守卫；现有用例靠注入 fetcher 验证网络分支，
    // 所以这里给个测试 key，让它们能越过守卫走到 fetcher。
    ENV.falApiKey = "test-fal-key";
    sourceBytes = await sharp({
      create: { width: 320, height: 320, channels: 4, background: "black" },
    }).png().toBuffer();
    const raw = Buffer.alloc(320 * 320 * 4, 0);
    for (let y = 195; y < 206; y += 1) {
      for (let x = 95; x < 106; x += 1) {
        const offset = (y * 320 + x) * 4;
        raw[offset] = 255;
        raw[offset + 1] = 255;
        raw[offset + 2] = 255;
      }
    }
    for (let offset = 3; offset < raw.length; offset += 4) raw[offset] = 255;
    selectedMaskBytes = await sharp(raw, {
      raw: { width: 320, height: 320, channels: 4 },
    }).png().toBuffer();
    invalidMaskBytes = await sharp({
      create: { width: 320, height: 320, channels: 4, background: "white" },
    }).png().toBuffer();
  });
  afterEach(() => {
    ENV.falApiKey = savedFalKey;
  });

  it("returns mask when SAM2 finds an object", async () => {
    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { masks: [{ url: "https://fal.ai/mask.png" }] } },
      { ok: true, status: 200, arrayBuffer: Uint8Array.from(selectedMaskBytes).buffer },
    ]);

    const result = await segmentAtPoint("https://img.test/photo.png", 100, 200, { fetcher, sourceBytes });

    expect(result.status).toBe("ok");
    expect(result.maskUrl).toContain("-edit.png");
    expect(result.maskKey).toContain("-edit.png");
    expect(result.previewMaskUrl).toContain("-preview.png");
    expect(result.width).toBe(320);
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

    const result = await segmentAtPoint("https://img.test/photo.png", 0, 0, { fetcher, sourceBytes });

    expect(result.status).toBe("ok");
    expect(result.maskUrl).toBeNull();
    expect(result.maskKey).toBeNull();
  });

  it("skips an invalid first proposal and uses the next safe click mask", async () => {
    const fetcher = makeFetcher([
      {
        ok: true,
        status: 200,
        json: { masks: [{ url: "https://fal.ai/invalid.png" }, { url: "https://fal.ai/valid.png" }] },
      },
      { ok: true, status: 200, arrayBuffer: Uint8Array.from(invalidMaskBytes).buffer },
      { ok: true, status: 200, arrayBuffer: Uint8Array.from(selectedMaskBytes).buffer },
    ]);

    const result = await segmentAtPoint("https://img.test/photo.png", 100, 200, {
      fetcher,
      sourceBytes,
    });

    expect(result.status).toBe("ok");
    expect(result.maskKey).toContain("-edit.png");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("fails closed when every SAM proposal is unsafe", async () => {
    const fetcher = makeFetcher([
      {
        ok: true,
        status: 200,
        json: { masks: [{ url: "https://fal.ai/invalid-1.png" }, { url: "https://fal.ai/invalid-2.png" }] },
      },
      { ok: true, status: 200, arrayBuffer: Uint8Array.from(invalidMaskBytes).buffer },
      { ok: true, status: 200, arrayBuffer: Uint8Array.from(invalidMaskBytes).buffer },
    ]);

    const result = await segmentAtPoint("https://img.test/photo.png", 100, 200, {
      fetcher,
      sourceBytes,
    });

    expect(result).toMatchObject({
      status: "error",
      message: "没有识别到可安全编辑的单个物体",
    });
  });

  it("returns error on SAM2 API failure", async () => {
    const fetcher = makeFetcher([
      { ok: false, status: 500 },
    ]);

    const result = await segmentAtPoint("https://img.test/photo.png", 50, 50, { fetcher, sourceBytes });

    expect(result.status).toBe("error");
    expect(result.message).toContain("500");
  });

  it("returns error on timeout", async () => {
    const fetcher = vi.fn().mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 50)),
    );

    const result = await segmentAtPoint("https://img.test/photo.png", 50, 50, { fetcher, sourceBytes });

    expect(result.status).toBe("error");
    expect(result.message).toBe("timeout");
  });

  it("rejects link-local source addresses before any request", async () => {
    const fetcher = vi.fn();

    const result = await segmentAtPoint("https://169.254.169.254/latest/meta-data", 1, 1, {
      fetcher,
      resolveRemoteHosts: false,
    });

    expect(result).toMatchObject({ status: "error", message: "远程地址不安全" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not follow source redirects", async () => {
    const fetcher = makeFetcher([{ ok: false, status: 302 }]);

    const result = await segmentAtPoint("https://images.example.test/source.png", 1, 1, {
      fetcher,
      resolveRemoteHosts: false,
    });

    expect(result.status).toBe("error");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("aborts a mask response body that outlives the request deadline", async () => {
    let aborted = false;
    const fetcher = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (fetcher.mock.calls.length === 1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ masks: [{ url: "https://fal.ai/mask.png" }] }),
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        });
      }
      init?.signal?.addEventListener("abort", () => { aborted = true; });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
        arrayBuffer: () => new Promise<ArrayBuffer>(() => {}),
      });
    });

    const result = await segmentAtPoint("https://img.test/photo.png", 100, 200, {
      fetcher,
      sourceBytes,
      requestTimeoutMs: 5,
    });

    expect(result).toMatchObject({ status: "error" });
    expect(aborted).toBe(true);
  });

  it("opens circuit breaker after 3 consecutive failures", async () => {
    const fetcher = makeFetcher([{ ok: false, status: 500 }]);

    await segmentAtPoint("https://img.test/a.png", 0, 0, { fetcher, sourceBytes });
    await segmentAtPoint("https://img.test/b.png", 0, 0, { fetcher, sourceBytes });
    await segmentAtPoint("https://img.test/c.png", 0, 0, { fetcher, sourceBytes });

    expect(isCircuitOpen()).toBe(true);

    // Subsequent requests short-circuit without calling fetcher
    const freshFetcher = vi.fn();
    const result = await segmentAtPoint("https://img.test/d.png", 0, 0, { fetcher: freshFetcher, sourceBytes });

    expect(result.status).toBe("error");
    expect(result.message).toBe("circuit breaker open");
    expect(freshFetcher).not.toHaveBeenCalled();
  });

  it("没配 FAL_KEY 时立即报清晰错误、不打网络（这就是修掉「喂图 timeout」的那道守卫）", async () => {
    ENV.falApiKey = ""; // 用户的真实情况：只有 302 key，没有 fal key
    const fetcher = vi.fn();

    const result = await segmentAtPoint("https://img.test/photo.png", 10, 10, { fetcher });

    expect(result.status).toBe("error");
    expect(result.message).toContain("fal.ai"); // 给的是看得懂的中文提示，而不是裸 "timeout"
    expect(fetcher).not.toHaveBeenCalled(); // 关键：根本没去打 fal.run，不会再挂 30s
  });

  it("polls a fal queue receipt without submitting a second request", async () => {
    const fetcher = makeFetcher([
      {
        ok: true,
        status: 200,
        json: {
          status_url: "https://queue.fal.run/status/req-1",
          response_url: "https://queue.fal.run/result/req-1",
        },
      },
      { ok: true, status: 200, json: { status: "COMPLETED" } },
      { ok: true, status: 200, json: { masks: [{ url: "https://fal.ai/mask.png" }] } },
      { ok: true, status: 200, arrayBuffer: Uint8Array.from(selectedMaskBytes).buffer },
    ]);

    const result = await segmentAtPoint("https://img.test/photo.png", 100, 200, {
      fetcher,
      sourceBytes,
      pollIntervalMs: 0,
    });

    expect(result.status).toBe("ok");
    expect(fetcher.mock.calls.filter(([url]) => url.includes("fal-ai/sam2"))).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});

describe("segmentWithinPolygon", () => {
  const polygon = [
    { x: 10, y: 10 },
    { x: 60, y: 10 },
    { x: 60, y: 70 },
    { x: 10, y: 70 },
  ];

  beforeEach(() => {
    resetCircuitBreaker();
    vi.mocked(storagePut).mockClear();
    vi.mocked(storagePut).mockImplementation(async (key: string) => ({
      key,
      url: `https://storage.example.com/${key}`,
    }));
  });

  it("uses semantic segmentation and clips the object mask to the lasso", async () => {
    const savedFalKey = ENV.falApiKey;
    ENV.falApiKey = "test-fal-key";
    const sourceBytes = await sharp({
      create: { width: 4, height: 4, channels: 4, background: "black" },
    }).png().toBuffer();
    const providerRaw = Buffer.alloc(4 * 4 * 4, 0);
    for (let offset = 3; offset < providerRaw.length; offset += 4) {
      providerRaw[offset] = 255;
    }
    for (let y = 1; y <= 2; y += 1) {
      for (let x = 1; x <= 2; x += 1) {
        const offset = (y * 4 + x) * 4;
        providerRaw[offset] = 255;
        providerRaw[offset + 1] = 255;
        providerRaw[offset + 2] = 255;
      }
    }
    const providerMask = await sharp(providerRaw, {
      raw: { width: 4, height: 4, channels: 4 },
    }).png().toBuffer();
    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { masks: [{ url: "https://fal.ai/object.png" }] } },
      { ok: true, status: 200, arrayBuffer: Uint8Array.from(providerMask).buffer },
    ]);
    try {
      const result = await segmentWithinPolygon(
        "https://img.test/photo.png",
        [
          { x: 0.5, y: 0.5 },
          { x: 2, y: 0.5 },
          { x: 2, y: 3.5 },
          { x: 0.5, y: 3.5 },
        ],
        { fetcher, sourceBytes, scope: { userId: 7, storyId: 8, imageId: 9 } }
      );

      expect(result.status).toBe("ok");
      const body = JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string);
      expect(body.point_coords).toHaveLength(1);
      expect(body.point_labels).toEqual([1]);
      const editBytes = vi.mocked(storagePut).mock.calls[0]?.[1] as Uint8Array;
      const alpha = [...await sharp(editBytes).ensureAlpha().raw().toBuffer()]
        .filter((_, index) => index % 4 === 3);
      expect(alpha.filter(value => value === 0)).toHaveLength(2);
    } finally {
      ENV.falApiKey = savedFalKey;
    }
  });

  it("uploads a local source image before asking the remote semantic provider", async () => {
    const savedFalKey = ENV.falApiKey;
    ENV.falApiKey = "test-fal-key";
    const sourceBytes = await sharp({
      create: { width: 100, height: 80, channels: 4, background: "black" },
    }).png().toBuffer();
    const providerMask = await sharp({
      create: { width: 100, height: 80, channels: 4, background: "black" },
    }).png().toBuffer();
    const fetcher = makeFetcher([
      { ok: true, status: 200, json: { masks: [{ url: "https://fal.ai/object.png" }] } },
      { ok: true, status: 200, arrayBuffer: Uint8Array.from(providerMask).buffer },
    ]);
    try {
      await segmentWithinPolygon("/api/images/local-source.png", polygon, {
        fetcher,
        sourceBytes,
        scope: { userId: 7, storyId: 8, imageId: 9 },
      });

      expect(storagePut).toHaveBeenCalledWith(
        expect.stringMatching(/^segmentation-inputs\/7\/8\/9\//),
        expect.any(Uint8Array),
        "image/png"
      );
      const body = JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string);
      expect(body.image_url).toMatch(/^https:\/\/storage\.example\.com\/segmentation-inputs\//);
    } finally {
      ENV.falApiKey = savedFalKey;
    }
  });

  it("fails closed without semantic segmentation instead of turning the lasso into a paid mask", async () => {
    const savedFalKey = ENV.falApiKey;
    ENV.falApiKey = "";
    const fetcher = vi.fn();
    try {
      const result = await segmentWithinPolygon(
        "https://img.test/photo.png",
        polygon,
        { fetcher }
      );
      expect(result).toMatchObject({
        status: "error",
        message: expect.stringMatching(/语义|fal\.ai/),
      });
      expect(fetcher).not.toHaveBeenCalled();
      expect(storagePut).not.toHaveBeenCalled();
    } finally {
      ENV.falApiKey = savedFalKey;
    }
  });

  it("uses the configured vision channel to derive a semantic contour instead of reusing the lasso", async () => {
    const savedFalKey = ENV.falApiKey;
    ENV.falApiKey = "";
    const sourceBytes = await sharp({
      create: { width: 100, height: 100, channels: 4, background: "black" },
    }).png().toBuffer();
    vi.mocked(visionChannelConfigured).mockReturnValueOnce(true);
    vi.mocked(invokeVisionJson).mockResolvedValueOnce({
      modelLabel: "qwen3-vl-plus",
      text: JSON.stringify({
        found: true,
        anchor: { x: 300, y: 300 },
        contour: [
          { x: 150, y: 150 },
          { x: 600, y: 150 },
          { x: 600, y: 600 },
          { x: 150, y: 600 },
        ],
      }),
    });
    try {
      const result = await segmentWithinPolygon(
        "https://img.test/photo.png",
        [
          { x: 10, y: 10 },
          { x: 70, y: 10 },
          { x: 70, y: 70 },
          { x: 10, y: 70 },
        ],
        { sourceBytes, scope: { userId: 7, storyId: 8, imageId: 9 } }
      );

      expect(result.status).toBe("ok");
      expect(invokeVisionJson).toHaveBeenCalledWith(expect.objectContaining({
        userText: expect.stringContaining("Lasso search hint"),
        imageUrls: [expect.stringMatching(/^data:image\/png;base64,/)],
      }));
      const editBytes = vi.mocked(storagePut).mock.calls[0]?.[1] as Uint8Array;
      const alpha = [...await sharp(editBytes).ensureAlpha().raw().toBuffer()]
        .filter((_, index) => index % 4 === 3);
      expect(alpha.filter(value => value === 0)).toHaveLength(2_025);
    } finally {
      ENV.falApiKey = savedFalKey;
    }
  });

  it("fails closed when the vision channel does not return a valid semantic contour", async () => {
    const savedFalKey = ENV.falApiKey;
    ENV.falApiKey = "";
    const sourceBytes = await sharp({
      create: { width: 100, height: 100, channels: 4, background: "black" },
    }).png().toBuffer();
    vi.mocked(visionChannelConfigured).mockReturnValueOnce(true);
    vi.mocked(invokeVisionJson).mockResolvedValueOnce({
      modelLabel: "qwen3-vl-plus",
      text: JSON.stringify({ found: true, anchor: { x: 100, y: 100 }, contour: [] }),
    });
    try {
      const result = await segmentWithinPolygon(
        "https://img.test/photo.png",
        [
          { x: 10, y: 10 },
          { x: 70, y: 10 },
          { x: 70, y: 70 },
          { x: 10, y: 70 },
        ],
        { sourceBytes }
      );
      expect(result).toMatchObject({
        status: "error",
        message: expect.stringMatching(/可验证的对象轮廓/),
      });
      expect(storagePut).not.toHaveBeenCalled();
    } finally {
      ENV.falApiKey = savedFalKey;
    }
  });

  it("uses the durable local mask for the later paid edit before remote storage", async () => {
    const savedLocalImageDir = ENV.localImageDir;
    const savedFalKey = ENV.falApiKey;
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mask-storage-"));
    ENV.localImageDir = directory;
    vi.mocked(storageGet).mockClear();
    const sourceBytes = await sharp({
      create: { width: 100, height: 80, channels: 4, background: "black" },
    }).png().toBuffer();
    try {
      ENV.falApiKey = "test-fal-key";
      const providerRaw = Buffer.alloc(100 * 80 * 4, 255);
      for (let y = 20; y < 60; y += 1) {
        for (let x = 10; x < 40; x += 1) {
          const offset = (y * 100 + x) * 4;
          providerRaw[offset] = 0;
          providerRaw[offset + 1] = 0;
          providerRaw[offset + 2] = 0;
        }
      }
      const providerMask = await sharp(providerRaw, {
        raw: { width: 100, height: 80, channels: 4 },
      }).png().toBuffer();
      const fetcher = makeFetcher([
        { ok: true, status: 200, json: { masks: [{ url: "https://fal.ai/object.png" }] } },
        { ok: true, status: 200, arrayBuffer: Uint8Array.from(providerMask).buffer },
      ]);
      const result = await segmentWithinPolygon(
        "https://img.test/photo.png",
        polygon,
        { fetcher, sourceBytes, scope: { userId: 7, storyId: 8, imageId: 9 } }
      );
      if (result.status !== "ok" || !result.maskKey || !result.maskUrl) {
        throw new Error("mask creation failed");
      }
      const localFileName = path.basename(result.maskUrl);
      await fs.writeFile(path.join(directory, localFileName), "local-mask");

      await expect(resolveStoredMaskUrl(result.maskKey)).resolves.toBe(
        result.maskUrl
      );
      expect(storageGet).not.toHaveBeenCalled();
    } finally {
      ENV.localImageDir = savedLocalImageDir;
      ENV.falApiKey = savedFalKey;
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

});
