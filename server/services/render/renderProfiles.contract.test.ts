import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV } from "../../_core/env";
import {
  getRenderProfile,
  listRenderProfiles,
  quoteRenderProfile,
  renderProfileAlternatives,
  RENDER_PROFILE_IDS,
  type RenderProfileId,
} from "@shared/renderProfiles";
import {
  estimateLocalImagePatchCost,
  estimatePublishingCoverCost,
  estimateStoryboardImageCost,
  estimateStoryboardMaskedEditCost,
  estimateStoryboardRetextureCost,
} from "@shared/imageRenderCost";
import { estimateShotVideoCost } from "@shared/shotDirector";
import { estimateViduQ2TransitionCny } from "@shared/videoRenderCost";
import { compositionQuote } from "@shared/bookImageComposition";
import { editImage, generateDraftImage, generateImage, resetCircuitBreaker } from "../imageGen";
import { submitShotVideo } from "../videoGen";
import { submitRender } from "./submitRender";
import { buildRenderSnapshot } from "./snapshot";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const BASE = "https://api.302.test";
async function localPatchFixture() {
  const { default: sharp } = await import("sharp");
  const width = 80, height = 40;
  const source = await sharp({ create: { width, height, channels: 4, background: { r: 23, g: 47, b: 83, alpha: 1 } } }).png().toBuffer();
  const raw = Buffer.alloc(width * height * 4, 255);
  for (let y = 4; y < 12; y++) for (let x = 62; x < 74; x++) raw[(y * width + x) * 4 + 3] = 0;
  const mask = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
  return { source: `data:image/png;base64,${source.toString("base64")}`, mask: `data:image/png;base64,${mask.toString("base64")}` };
}

const saved = { ...ENV };

type Captured = { url: string; method?: string; body: unknown };

function describeBody(body: unknown): unknown {
  if (typeof body === "string") {
    try { return scrub(JSON.parse(body)); } catch { return scrub(body); }
  }
  if (body instanceof FormData) {
    const out: Record<string, unknown[]> = {};
    for (const [key, value] of body.entries()) {
      (out[key] ??= []).push(typeof value === "string" ? scrub(value) : `[file ${(value as File).type || "application/octet-stream"}]`);
    }
    return out;
  }
  return body == null ? null : "[binary]";
}

function scrub(value: unknown): unknown {
  if (typeof value === "string") {
    if (/^data:image\//.test(value)) return "[inline-image]";
    if (value.length > 200 && /^[A-Za-z0-9+/=]+$/.test(value)) return "[base64]";
    return value;
  }
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v)]));
  return value;
}

/** Records every request, never touches the network, and fails each call so no flow continues. */
function capturingFetch() {
  const calls: Captured[] = [];
  const fetcher = vi.fn(async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method, body: describeBody(init?.body) });
    throw Object.assign(new Error("contract-capture: network disabled"), { code: "ECONNRESET" });
  });
  return { calls, fetcher };
}

function providerCalls(calls: Captured[]) {
  return calls.filter(call => /api\.302\.test|api\.legnext\.ai/.test(call.url));
}

beforeEach(() => {
  resetCircuitBreaker();
  vi.stubEnv("IMAGE_302_MJ_ROUTE_MODE", "");
  vi.stubEnv("LEGNEXT_API_KEY", "contract-legnext-key");
  ENV.api302Key = "contract-302-key";
  ENV.api302BaseUrl = BASE;
  ENV.falApiKey = "";
  ENV.forgeApiUrl = "";
  ENV.forgeApiKey = "";
  ENV.imageProviderDefault = "midjourney";
  ENV.image302GptModel = "gpt-image-1.5";
  ENV.image302GptSize = "1024x1024";
  ENV.image302GptQuality = "high";
  ENV.imagePrompt302Model = "";
  ENV.vision302ApiKey = "";
  ENV.openaiNextApiKey = "";
  ENV.video302SubmitPath = "";
  ENV.video302PollPath = "";
  ENV.video302Model = "";
});

afterEach(() => {
  Object.assign(ENV, saved);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const mjRetry = { mjOverloadRetryDelaysMs: [] as number[], sleep: async () => undefined };

describe("render profile contracts (mock fetch, request body snapshot)", () => {
  it("image.mj-302", async () => {
    const { calls, fetcher } = capturingFetch();
    await generateImage("a quiet harbour at dawn", { provider: "midjourney", fetcher, ...mjRetry });
    const submit = providerCalls(calls);
    expect(submit).toHaveLength(1);
    expect(submit[0].url).toBe(`${BASE}/mj/submit/imagine`);
    expect(submit[0]).toMatchSnapshot();
  });

  it("image.mj-302-turbo (dedicated channels only)", async () => {
    vi.stubEnv("IMAGE_302_MJ_ROUTE_MODE", "dedicated");
    const { calls, fetcher } = capturingFetch();
    await generateImage("a quiet harbour at dawn --turbo", { provider: "midjourney", fetcher, ...mjRetry });
    const submit = providerCalls(calls);
    expect(submit).toHaveLength(1);
    expect(submit[0].url).toBe(`${BASE}/mj-turbo/submit/imagine`);
    expect(submit[0]).toMatchSnapshot();
  });

  it("image.mj-302-relax (dedicated channels only)", async () => {
    vi.stubEnv("IMAGE_302_MJ_ROUTE_MODE", "dedicated");
    const { calls, fetcher } = capturingFetch();
    await generateImage("a quiet harbour at dawn --relax", { provider: "midjourney", fetcher, ...mjRetry });
    const submit = providerCalls(calls);
    expect(submit).toHaveLength(1);
    expect(submit[0].url).toBe(`${BASE}/mj-relax/submit/imagine`);
    expect(submit[0]).toMatchSnapshot();
  });

  it("image.mj-302-draft", async () => {
    const { calls, fetcher } = capturingFetch();
    await generateImage("a quiet harbour at dawn", { provider: "midjourney", mjDraft: true, renderProfileId: "image.mj-302-draft", fetcher, ...mjRetry });
    const submit = providerCalls(calls);
    expect(submit).toHaveLength(1);
    expect(submit[0]).toMatchSnapshot();
  });

  it("image.legnext-v7-fast", async () => {
    const { calls, fetcher } = capturingFetch();
    vi.stubGlobal("fetch", fetcher);
    const result = await submitRender("image.legnext-v7-fast", {
      prompt: "a quiet harbour at dawn",
      onAccepted: async () => undefined,
      options: { aspectRatio: "16:9", inlinePoll: false },
    });
    expect(result.status).toBe("error");
    const submit = providerCalls(calls);
    expect(submit).toHaveLength(1);
    expect(submit[0].url).toBe("https://api.legnext.ai/api/v1/diffusion");
    expect(submit[0]).toMatchSnapshot();
  });

  it("image.legnext-retexture", async () => {
    const { calls, fetcher } = capturingFetch();
    vi.stubGlobal("fetch", fetcher);
    const result = await submitRender("image.legnext-retexture", {
      prompt: "Refine existing colors. Preserve shapes and luminance.",
      onAccepted: async () => undefined,
      options: { referenceImageUrl: "https://cdn.example/original.png", editMode: "retexture", inlinePoll: false },
    });
    expect(result.status).toBe("error");
    expect(providerCalls(calls)).toEqual([{
      url: "https://api.legnext.ai/api/v1/retexture", method: "POST",
      body: { imgUrl: "https://cdn.example/original.png", remixPrompt: "Refine existing colors. Preserve shapes and luminance." },
    }]);
  });

  it("image.gpt-image.generate", async () => {
    const { calls, fetcher } = capturingFetch();
    await generateImage("a quiet harbour at dawn", { provider: "gpt-image", renderProfileId: "image.gpt-image.generate", fetcher });
    const submit = providerCalls(calls);
    expect(submit[0].url.startsWith(`${BASE}/v1/images/generations`)).toBe(true);
    expect(submit[0]).toMatchSnapshot();
  });

  it("image.gpt-image-2.5.generate", async () => {
    const { calls, fetcher } = capturingFetch();
    await generateImage("a quiet harbour at dawn", { provider: "gpt-image", gptImageModel: "gpt-image-2.5-sunburst", renderProfileId: "image.gpt-image-2.5.generate", fetcher });
    const submit = providerCalls(calls);
    expect(submit[0]).toMatchSnapshot();
  });

  it("image.gpt-image.edit", async () => {
    const { calls, fetcher } = capturingFetch();
    await editImage(PNG, "make it rain", { provider: "gpt-image", renderProfileId: "image.gpt-image.edit", fetcher });
    const submit = providerCalls(calls);
    expect(submit).toHaveLength(1);
    expect(submit[0].url.startsWith(`${BASE}/v1/images/edits`)).toBe(true);
    expect(submit[0]).toMatchSnapshot();
  });

  it("image.gpt-image-2.edit", async () => {
    const { calls, fetcher } = capturingFetch();
    await editImage(PNG, "make it rain", { provider: "gpt-image", gptImageModel: "gpt-image-2", referenceRevision: true, renderProfileId: "image.gpt-image-2.edit", fetcher });
    const submit = providerCalls(calls);
    expect(submit).toHaveLength(1);
    expect(submit[0]).toMatchSnapshot();
  });

  it("image.gpt-image-2.5.edit", async () => {
    const { calls, fetcher } = capturingFetch();
    await editImage(PNG, "make it rain", { provider: "gpt-image", gptImageModel: "gpt-image-2.5-sunburst", preferStructuralEdit: true, requireInputImage: true, renderProfileId: "image.gpt-image-2.5.edit", fetcher });
    const submit = providerCalls(calls);
    expect(submit).toHaveLength(1);
    expect(submit[0]).toMatchSnapshot();
  });

  it("image.gpt-image.local-patch", async () => {
    const { calls, fetcher } = capturingFetch();
    const { source, mask } = await localPatchFixture();
    await editImage(source, "fix the cup", { provider: "gpt-image", editMaskImageUrl: mask, localImagePatch: true, renderProfileId: "image.gpt-image.local-patch", fetcher });
    const submit = providerCalls(calls);
    expect(submit).toHaveLength(1);
    expect(submit[0]).toMatchSnapshot();
  });

  it("image.flux-kontext-pro", async () => {
    const { calls, fetcher } = capturingFetch();
    await generateImage("a quiet harbour at dawn", { provider: "gpt-image", referenceImageUrl: PNG, renderProfileId: "image.flux-kontext-pro", fetcher });
    const submit = providerCalls(calls);
    expect(submit).toHaveLength(1);
    expect(submit[0]).toMatchSnapshot();
  });

  it("image.flux-schnell-draft", async () => {
    const { calls, fetcher } = capturingFetch();
    await generateDraftImage("a quiet harbour at dawn", { fetcher });
    const submit = providerCalls(calls);
    expect(submit).toHaveLength(1);
    expect(submit[0]).toMatchSnapshot();
  });

  it("video.vidu-q2-pro-fast", async () => {
    const { calls, fetcher } = capturingFetch();
    const result = await submitShotVideo({ prompt: "slow push in", sourceImage: "https://cdn.example/frame.png", durationSec: 5, renderMode: "economy" }, { fetcher });
    expect(result.status).toBe("error");
    const submit = providerCalls(calls);
    expect(submit).toHaveLength(1);
    expect(submit[0].url).toBe(`${BASE}/vidu/ent/v2/img2video`);
    expect(submit[0]).toMatchSnapshot();
  });

  it("video.mj-video", async () => {
    ENV.video302SubmitPath = "/mj-turbo/submit/video";
    const { calls, fetcher } = capturingFetch();
    await submitShotVideo({ prompt: "slow push in", sourceImage: "https://cdn.example/frame.png", durationSec: 5 }, { fetcher });
    const submit = providerCalls(calls);
    expect(submit).toHaveLength(1);
    expect(submit[0].url).toBe(`${BASE}/mj-turbo/submit/video`);
    expect(submit[0]).toMatchSnapshot();
  });

  it("video.302-configured", async () => {
    ENV.video302SubmitPath = "/contract/video/submit";
    ENV.video302Model = "contract-video-model";
    const { calls, fetcher } = capturingFetch();
    await submitShotVideo({ prompt: "slow push in", sourceImage: "https://cdn.example/frame.png", durationSec: 5 }, { fetcher });
    const submit = providerCalls(calls);
    expect(submit).toHaveLength(1);
    expect(submit[0].url).toBe(`${BASE}/contract/video/submit`);
    expect(submit[0]).toMatchSnapshot();
  });

  it("video.vidu-q2-turbo-start-end", async () => {
    const { calls, fetcher } = capturingFetch();
    vi.stubGlobal("fetch", fetcher);
    await expect(submitRender("video.vidu-q2-turbo-start-end", { spec: {
      prompt: "door opens", firstImageUrl: "https://cdn.example/a.png", lastImageUrl: "https://cdn.example/b.png",
      durationSec: 2, resolution: "720p", movementAmplitude: "auto",
    } })).rejects.toThrow();
    const submit = providerCalls(calls);
    expect(submit).toHaveLength(1);
    expect(submit[0]).toMatchSnapshot();
  });

  it.each(["image.fal-flux-pro-ultra", "image.forge-edit"] as const)(
    "%s is disabled: explicit refusal, no request",
    async profileId => {
      expect(getRenderProfile(profileId).enabled).toBe(false);
      const { calls, fetcher } = capturingFetch();
      vi.stubGlobal("fetch", fetcher);
      const input = { prompt: "x", imageUrl: PNG, options: { fetcher }, route: { adapter: "disabled" } };
      const result = await submitRender(profileId, input as never) as { status: string; message: string };
      expect(result.status).toBe("error");
      expect(result.message).toContain("已停用");
      expect(result.message).toContain("没有自动改用其他供应商");
      expect(calls).toHaveLength(0);
    }
  );

  it("every enabled profile has a contract test above", () => {
    const source = readFileSync(__filename, "utf8");
    for (const profile of listRenderProfiles()) {
      if (profile.enabled) expect(source).toContain(`it("${profile.id}`);
    }
  });
});

describe("no implicit rerouting", () => {
  it("refuses a diffusion/edit profile mismatch before any request", async () => {
    const { calls, fetcher } = capturingFetch();
    vi.stubGlobal("fetch", fetcher);
    for (const id of ["image.legnext-v7-fast", "image.legnext-retexture"] as const) {
      const result = await submitRender(id, { prompt: "x", onAccepted: async () => undefined,
        options: { editMode: id === "image.legnext-v7-fast" ? "retexture" : undefined } });
      expect(result.status).toBe("error");
      expect(result.message).toContain("不一致");
    }
    expect(calls).toHaveLength(0);
  });
  it("a failing MJ submit is the only paid request: no Kontext, GPT, fal or Forge afterwards", async () => {
    ENV.forgeApiUrl = "https://forge.test";
    ENV.forgeApiKey = "forge-key";
    ENV.falApiKey = "fal-key";
    const { calls, fetcher } = capturingFetch();
    const result = await editImage("https://cdn.example/photo.png", "make it rain", { provider: "midjourney", fetcher, ...mjRetry });
    expect(result.status).toBe("error");
    const paid = calls.filter(call => call.method === "POST");
    expect(paid).toHaveLength(1);
    expect(paid[0].url).toContain("/mj/submit/imagine");
  });

  it("a failing GPT edit is not retried on Forge", async () => {
    ENV.forgeApiUrl = "https://forge.test";
    ENV.forgeApiKey = "forge-key";
    const { calls, fetcher } = capturingFetch();
    const result = await editImage(PNG, "make it rain", { provider: "gpt-image", fetcher });
    expect(result.status).toBe("error");
    expect(calls).toHaveLength(1);
    expect(calls.some(call => call.url.includes("forge.test"))).toBe(false);
  });

  it("fal requested without FAL_KEY is an explicit error listing alternatives, not GPT-image", async () => {
    ENV.imageProviderDefault = "fal";
    const { calls, fetcher } = capturingFetch();
    const result = await generateImage("a cat", { fetcher });
    expect(result.status).toBe("error");
    expect(result.message).toContain("可选档位");
    expect(result.message).toMatch(/image\.\S+（.+算力/);
    expect(calls).toHaveLength(0);
  });

  it("GPT-image without a 302 key is an explicit error, not fal", async () => {
    ENV.api302Key = "";
    ENV.falApiKey = "fal-key";
    const { calls, fetcher } = capturingFetch();
    const result = await generateImage("a cat", { provider: "gpt-image", fetcher });
    expect(result.status).toBe("error");
    expect(calls).toHaveLength(0);
  });

  it("a pinned profile that routing would not choose is refused before submitting", async () => {
    const { calls, fetcher } = capturingFetch();
    const result = await generateImage("a cat", { provider: "gpt-image", referenceImageUrl: PNG, renderProfileId: "image.gpt-image.generate", fetcher });
    expect(result.status).toBe("error");
    expect(result.message).toContain("image.flux-kontext-pro");
    expect(calls).toHaveLength(0);
  });

  it("a shot-video prompt over the profile limit is rejected, not trimmed or rerouted", async () => {
    const { calls, fetcher } = capturingFetch();
    const result = await submitShotVideo({ prompt: "x".repeat(2001), sourceImage: "https://cdn.example/frame.png", durationSec: 5, renderMode: "economy" }, { fetcher });
    expect(result.status).toBe("error");
    expect(calls).toHaveLength(0);
  });

  it("only render/executors.ts reaches the provider runners", () => {
    const root = path.resolve(__dirname, "../..");
    const runners = /\b(generateLegnextImage|submitViduTransition|submitViduSingleVideo|submitShotVideoForProfile|runImageRenderProfile|runLocalColorTransfer|transferImageColor)\(/;
    const allowed = new Set([
      "services/render/executors.ts",
      "services/legnextImage.ts",
      "services/videoTransition302.ts",
      "services/viduSingleVideo.ts",
      "services/videoGen.ts",
      "services/imageGen.ts",
      "services/render/adapters/localColorTransfer.ts",
    ]);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) { if (name !== "node_modules") walk(full); continue; }
        if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
        const rel = path.relative(root, full).split(path.sep).join("/");
        if (allowed.has(rel)) continue;
        const lines = readFileSync(full, "utf8").split("\n");
        lines.forEach((line, index) => {
          if (runners.test(line) && !/^\s*(\/\/|\*|import\b|export\s+(async\s+)?function)/.test(line)) offenders.push(`${rel}:${index + 1}`);
        });
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});

describe("image.local-color-transfer (0-price local profile)", () => {
  async function tinyPng(rgb: [number, number, number]) {
    const { default: sharp } = await import("sharp");
    return sharp({ create: { width: 16, height: 16, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }).png().toBuffer();
  }

  it("quotes 0 算力 and is never offered as a stand-in for paid profiles", () => {
    expect(quoteRenderProfile("image.local-color-transfer")).toMatchObject({ estimatedCny: 0, computeUnits: 0 });
    const profile = getRenderProfile("image.local-color-transfer");
    expect(profile).toMatchObject({ provider: "local", adapter: "local-color-transfer", endpoint: "local", enabled: true, outputCount: 1 });
    for (const id of RENDER_PROFILE_IDS) expect(renderProfileAlternatives(id).join("")).not.toContain("image.local-color-transfer");
    expect(buildRenderSnapshot("image.local-color-transfer", { params: { sourceImageId: 1, targetImageId: 2 } }).quote?.computeUnits).toBe(0);
  });

  it("image.local-color-transfer: goes through submitRender, computes locally, sends no request at all", async () => {
    const { calls, fetcher } = capturingFetch();
    vi.stubGlobal("fetch", fetcher);
    const result = await submitRender("image.local-color-transfer", { referenceBytes: await tinyPng([230, 170, 140]), targetBytes: await tinyPng([90, 140, 100]) });
    expect(result.status).toBe("ok");
    expect(result.status === "ok" && result.lMaxAbsDiff).toBeLessThanOrEqual(0.5);
    expect(calls).toHaveLength(0);
  });

  it("a bad image is an explicit error, not a reroute to a paid profile", async () => {
    const { calls, fetcher } = capturingFetch();
    vi.stubGlobal("fetch", fetcher);
    const result = await submitRender("image.local-color-transfer", { referenceBytes: new Uint8Array([1, 2, 3]), targetBytes: new Uint8Array([4, 5, 6]) });
    expect(result.status).toBe("error");
    expect(calls).toHaveLength(0);
  });
});

describe("quote = profile price = existing imageRenderCost result", () => {
  const expected: Partial<Record<RenderProfileId, () => number>> = {
    "image.mj-302": () => estimateStoryboardImageCost().estimatedCny,
    "image.mj-302-turbo": () => estimateStoryboardImageCost().estimatedCny,
    "image.mj-302-relax": () => estimateStoryboardImageCost().estimatedCny,
    "image.mj-302-draft": () => estimatePublishingCoverCost().estimatedCny,
    "image.legnext-v7-fast": () => estimateStoryboardImageCost().estimatedCny,
    "image.legnext-retexture": () => estimateStoryboardRetextureCost().estimatedCny,
    "image.gpt-image.generate": () => estimateStoryboardMaskedEditCost().estimatedCny,
    "image.gpt-image.edit": () => estimateStoryboardMaskedEditCost().estimatedCny,
    "image.gpt-image-2.edit": () => estimateStoryboardMaskedEditCost().estimatedCny,
    "image.gpt-image.local-patch": () => estimateLocalImagePatchCost().estimatedCny,
    "video.vidu-q2-pro-fast": () => estimateShotVideoCost({ durationSec: 5, motion: "low", priceProfile: "vidu-economy" }).estimatedCny,
    "video.mj-video": () => estimateShotVideoCost({ durationSec: 5, motion: "low", priceProfile: "mj-turbo" }).estimatedCny,
    "video.302-configured": () => estimateShotVideoCost({ durationSec: 5, motion: "low", priceProfile: "legacy" }).estimatedCny,
    "video.vidu-q2-turbo-start-end": () => estimateViduQ2TransitionCny({ durationSec: 2, resolution: "720p", uploadCount: 2 }).estimatedCny,
    "image.local-color-transfer": () => 0,
  };

  it.each(Object.entries(expected))("%s", (id, fn) => {
    expect(quoteRenderProfile(id as RenderProfileId, { durationSec: id.startsWith("video.vidu-q2-turbo") ? 2 : 5 })?.estimatedCny).toBe(fn!());
  });

  it("known prices: MJ 1.36, GPT-image-2 whole edit 2.86, local patch 0.54 算力", () => {
    expect(quoteRenderProfile("image.mj-302")?.computeUnits).toBe(1.36);
    expect(quoteRenderProfile("image.gpt-image-2.edit")?.computeUnits).toBe(2.86);
    expect(quoteRenderProfile("image.gpt-image.local-patch")?.computeUnits).toBe(0.54);
  });

  it("book composition profiles use compositionQuote unchanged", () => {
    const composition = { sources: [], instructions: ["warm light"], revision: false };
    for (const id of ["image.gpt-image-2.5.generate", "image.gpt-image-2.5.edit"] as const) {
      expect(quoteRenderProfile(id, { composition })?.estimatedCny).toBe(compositionQuote([], ["warm light"], false));
    }
  });

  it("profiles without an existing price stay unpriced (no invented price)", () => {
    for (const id of RENDER_PROFILE_IDS) {
      if (!(id in expected) && !id.startsWith("image.gpt-image-2.5")) expect(quoteRenderProfile(id)).toBeNull();
    }
  });

  it("the stored snapshot carries the same quote", () => {
    const snapshot = buildRenderSnapshot("image.gpt-image-2.edit", { params: { provider: "gpt-image", referenceImageUrl: "https://cdn.example/a.png" }, now: new Date("2026-11-11T00:00:00Z") });
    expect(snapshot.quote?.estimatedCny).toBe(estimateStoryboardMaskedEditCost().estimatedCny);
    expect(snapshot.params.referenceImageUrl ?? "[not-allowed]").not.toContain("https://");
  });
});
