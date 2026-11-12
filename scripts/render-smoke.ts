/**
 * 渲染档位冒烟（只构造请求，不发送）：
 *   pnpm exec tsx scripts/render-smoke.ts --dry-run [--json]
 *
 * 对每个档位走一遍真实的提交代码，用一个"只记录、永远失败"的 fetch 截下第一笔供应商请求，
 * 打印 URL 和（脱敏后的）请求体。保证：
 * - 不读取、不打印任何真实密钥：进程内先写入占位 key，再加载服务代码；
 * - 全局 fetch 和每个调用的 fetcher 都被替换，任何请求都不会离开本机；
 * - 停用档位只验证会被显式拒绝。
 */
const PLACEHOLDER = "dry-run-placeholder-key";

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

function describeBody(body: unknown): unknown {
  if (typeof body === "string") {
    try { return scrub(JSON.parse(body)); } catch { return scrub(body); }
  }
  if (body instanceof FormData) {
    const out: Record<string, unknown[]> = {};
    for (const [key, value] of body.entries()) (out[key] ??= []).push(typeof value === "string" ? scrub(value) : "[file]");
    return out;
  }
  return body == null ? null : "[binary]";
}

type Captured = { url: string; method?: string; body: unknown };

async function localPatchFixture() {
  const { default: sharp } = await import("sharp");
  const width = 80, height = 40;
  const source = await sharp({ create: { width, height, channels: 4, background: { r: 23, g: 47, b: 83, alpha: 1 } } }).png().toBuffer();
  const raw = Buffer.alloc(width * height * 4, 255);
  for (let y = 4; y < 12; y++) for (let x = 62; x < 74; x++) raw[(y * width + x) * 4 + 3] = 0;
  const mask = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
  return { source: `data:image/png;base64,${source.toString("base64")}`, mask: `data:image/png;base64,${mask.toString("base64")}` };
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes("--dry-run")) {
    console.error("render-smoke 只支持 --dry-run（只构造请求，不发送）。");
    process.exit(2);
  }
  const json = args.includes("--json");

  process.env.NODE_ENV = "development";
  for (const name of ["API302_KEY", "IMAGE_302_API_KEY", "LEGNEXT_API_KEY", "FAL_KEY", "OPENAI_NEXT_API_KEY", "VISION_302_API_KEY"]) process.env[name] = PLACEHOLDER;
  process.env.JWT_SECRET ||= "dry-run-placeholder-jwt-secret-000000";

  let calls: Captured[] = [];
  const fetcher = async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method, body: describeBody(init?.body) });
    throw Object.assign(new Error("dry-run: network disabled"), { code: "ECONNRESET" });
  };
  globalThis.fetch = fetcher as typeof fetch;

  const { ENV } = await import("../server/_core/env");
  Object.assign(ENV, {
    api302Key: PLACEHOLDER, api302BaseUrl: "https://api.302.ai", falApiKey: "", forgeApiUrl: "", forgeApiKey: "",
    imagePrompt302Model: "", vision302ApiKey: "", openaiNextApiKey: "", video302SubmitPath: "", video302PollPath: "", video302Model: "",
  });
  const { listRenderProfiles } = await import("../shared/renderProfiles");
  const { generateImage, editImage, generateDraftImage, resetCircuitBreaker } = await import("../server/services/imageGen");
  const { submitShotVideo } = await import("../server/services/videoGen");
  const { submitRender } = await import("../server/services/render/submitRender");

  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const prompt = "a quiet harbour at dawn";
  const mj = { provider: "midjourney" as const, fetcher, mjOverloadRetryDelaysMs: [], sleep: async () => undefined };
  const frame = { prompt: "slow push in", sourceImage: "https://cdn.example/frame.png", durationSec: 5 };
  const runs: Record<string, () => Promise<unknown>> = {
    "image.mj-302": () => generateImage(prompt, mj),
    "image.mj-302-turbo": () => { process.env.IMAGE_302_MJ_ROUTE_MODE = "dedicated"; return generateImage(`${prompt} --turbo`, mj); },
    "image.mj-302-relax": () => { process.env.IMAGE_302_MJ_ROUTE_MODE = "dedicated"; return generateImage(`${prompt} --relax`, mj); },
    "image.mj-302-draft": () => generateImage(prompt, { ...mj, mjDraft: true, renderProfileId: "image.mj-302-draft" }),
    "image.legnext-v7-fast": () => submitRender("image.legnext-v7-fast", { prompt, onAccepted: async () => undefined, options: { aspectRatio: "16:9", inlinePoll: false } }),
    "image.legnext-retexture": () => submitRender("image.legnext-retexture", { prompt, onAccepted: async () => undefined, options: {} } as never),
    "image.gpt-image.generate": () => generateImage(prompt, { provider: "gpt-image", renderProfileId: "image.gpt-image.generate", fetcher }),
    "image.gpt-image.edit": () => editImage(PNG, "make it rain", { provider: "gpt-image", renderProfileId: "image.gpt-image.edit", fetcher }),
    "image.gpt-image-2.edit": () => editImage(PNG, "make it rain", { provider: "gpt-image", gptImageModel: "gpt-image-2", referenceRevision: true, renderProfileId: "image.gpt-image-2.edit", fetcher }),
    "image.gpt-image.local-patch": async () => {
      const { source, mask } = await localPatchFixture();
      return editImage(source, "fix the cup", { provider: "gpt-image", editMaskImageUrl: mask, localImagePatch: true, renderProfileId: "image.gpt-image.local-patch", fetcher });
    },
    "image.gpt-image-2.5.generate": () => generateImage(prompt, { provider: "gpt-image", gptImageModel: "gpt-image-2.5-sunburst", renderProfileId: "image.gpt-image-2.5.generate", fetcher }),
    "image.gpt-image-2.5.edit": () => editImage(PNG, "make it rain", { provider: "gpt-image", gptImageModel: "gpt-image-2.5-sunburst", preferStructuralEdit: true, requireInputImage: true, renderProfileId: "image.gpt-image-2.5.edit", fetcher }),
    "image.flux-kontext-pro": () => generateImage(prompt, { provider: "gpt-image", referenceImageUrl: PNG, renderProfileId: "image.flux-kontext-pro", fetcher }),
    "image.flux-schnell-draft": () => generateDraftImage(prompt, { fetcher }),
    "image.fal-flux-pro-ultra": () => generateImage(prompt, { provider: "fal", fetcher }),
    "image.forge-edit": () => submitRender("image.forge-edit", { prompt, imageUrl: PNG, options: { fetcher }, route: { adapter: "disabled" } } as never),
    "video.vidu-q2-pro-fast": () => submitShotVideo({ ...frame, renderMode: "economy" }, { fetcher }),
    "video.mj-video": () => { ENV.video302SubmitPath = "/mj-turbo/submit/video"; return submitShotVideo(frame, { fetcher }); },
    "video.302-configured": () => { ENV.video302SubmitPath = "/configured/video/submit"; ENV.video302Model = "configured-model"; return submitShotVideo(frame, { fetcher }); },
    "image.local-color-transfer": async () => {
      const { default: sharp } = await import("sharp");
      const tiny = (r: number, g: number, b: number) => sharp({ create: { width: 16, height: 16, channels: 3, background: { r, g, b } } }).png().toBuffer();
      return submitRender("image.local-color-transfer", { referenceBytes: await tiny(230, 170, 140), targetBytes: await tiny(90, 140, 100) });
    },
    "video.vidu-q2-turbo-start-end": () => submitRender("video.vidu-q2-turbo-start-end", { spec: {
      prompt: "door opens", firstImageUrl: "https://cdn.example/a.png", lastImageUrl: "https://cdn.example/b.png",
      durationSec: 2, resolution: "720p", movementAmplitude: "auto",
    } }),
  };

  const report: Array<Record<string, unknown>> = [];
  let failures = 0;
  for (const profile of listRenderProfiles()) {
    calls = [];
    resetCircuitBreaker();
    delete process.env.IMAGE_302_MJ_ROUTE_MODE;
    ENV.video302SubmitPath = ""; ENV.video302Model = "";
    const run = runs[profile.id];
    let message: string | undefined;
    let localOk = false;
    try {
      const result = run ? await run() : undefined;
      message = (result as { message?: string } | undefined)?.message;
      localOk = (result as { status?: string } | undefined)?.status === "ok";
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    const submitted = calls.filter(call => call.method === "POST")[0];
    // 本地档位：必须算出结果，而且一条网络请求都不能有。
    const ok = !run ? false : profile.provider === "local" ? localOk && calls.length === 0 : profile.enabled ? Boolean(submitted) : calls.length === 0;
    if (!ok) failures += 1;
    report.push({
      profileId: profile.id, enabled: profile.enabled, ok,
      request: submitted ? { url: submitted.url, body: submitted.body } : null,
      ...(profile.enabled ? {} : { refusal: message }),
      ...(profile.provider === "local" && ok ? { localNote: "本地计算，0 算力，无网络请求" } : {}),
      ...(!ok ? { note: !run ? "没有冒烟用例" : profile.provider === "local" ? `本地档位失败或发出了请求：${message ?? ""}` : profile.enabled ? `没有构造出请求：${message ?? ""}` : "停用档位发出了请求" } : {}),
    });
  }
  if (json) console.log(JSON.stringify(report, null, 2));
  else for (const row of report) {
    const request = row.request as { url: string; body: unknown } | null;
    console.log(`${row.ok ? "✓" : "✗"} ${row.profileId}${row.enabled ? "" : "（停用）"}  ${request ? request.url : (row.refusal ?? row.localNote ?? row.note ?? "")}`);
    if (request) console.log(`    ${JSON.stringify(request.body)}`);
    if (row.note) console.log(`    ${row.note}`);
  }
  console.log(`\n${report.length} 个档位，${failures} 个失败；没有发出任何网络请求。`);
  process.exit(failures ? 1 : 0);
}

main().catch(error => {
  console.error("render-smoke 失败：", error instanceof Error ? error.message : error);
  process.exit(1);
});
