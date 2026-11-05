import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ENV } from "../_core/env";
import { submitViduSingleVideo } from "./viduSingleVideo";
import { submitShotVideo, refreshShotVideoTask, getShotVideoProviderStatus } from "./videoGen";
import { estimateShotVideoCost, storyboardVideoRenderMode } from "../../shared/shotDirector";
import { formatComputeQuote } from "../../shared/computeMoney";
import { compileViduSinglePrompt, compileVideoPromptEngineering } from "./videoPromptEngineering";

const saved = { ...ENV };
const request = { prompt: "小男孩低头，纸船缓慢漂动", sourceImage: "data:image/png;base64,dGVzdA==", durationSec: 5 };
it("keeps user intent and visual constraints in the provider-sized prompt", () => {
  const engineering = compileVideoPromptEngineering({ shotNo: 1, draftPrompt: request.prompt,
    fallbackPrompt: request.prompt, currentShot: { action: "低头望向水面", cameraMove: "固定镜头", negativePrompt: "不要新增人物" } });
  const prompt = compileViduSinglePrompt(engineering);
  expect(prompt).toContain(request.prompt);
  expect(prompt).toContain("不要新增人物");
  expect(prompt).toContain("固定镜头");
  expect(prompt.length).toBeLessThanOrEqual(2000);
});
beforeEach(() => { ENV.api302Key = "test-key"; ENV.api302BaseUrl = "https://api.302.ai"; });
afterEach(() => { Object.assign(ENV, saved); vi.restoreAllMocks(); });

it("quotes one 720p result by actual duration, without changing MJ quotes", () => {
  const quote = (durationSec: number) => estimateShotVideoCost({ durationSec, motion: "low", priceProfile: "vidu-economy" }).estimatedCny;
  expect(formatComputeQuote(quote(5))).toBe("1.08 算力");
  expect(quote(1)).toBe(0.27);
  expect(quote(2)).toBe(0.34);
  expect(quote(10)).toBe(0.88);
  expect(() => quote(2.5)).toThrow();
  expect(() => quote(11)).toThrow();
  expect(estimateShotVideoCost({ durationSec: 5, motion: "low", priceProfile: "mj-turbo" }).estimatedCny).toBe(4.04);
  expect(storyboardVideoRenderMode(null)).toBe("economy");
  expect(storyboardVideoRenderMode('{"videoRenderMode":"existing"}')).toBe("existing");
});

it("submits exactly one explicit Vidu request with quoted model, duration and resolution", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ task_id: "vidu-1" })));
  const result = await submitShotVideo({ ...request, renderMode: "economy" }, { fetcher });
  expect(result).toMatchObject({ status: "ok", taskId: "vidu-1" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://api.302.ai/vidu/ent/v2/img2video");
  expect(JSON.parse(String(init.body))).toEqual({ model: "viduq2-pro-fast", images: [request.sourceImage], prompt: request.prompt, duration: 5, resolution: "720p", audio: false });
});

it("keeps unknown submissions unknown without retrying or switching to MJ", async () => {
  const fetcher = vi.fn(async () => { throw new Error("connection lost"); });
  expect(await submitViduSingleVideo(request, { fetcher })).toMatchObject({ status: "error", submissionState: "unknown" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("rejects invalid inputs before contacting the provider", async () => {
  const fetcher = vi.fn();
  expect(await submitViduSingleVideo({ ...request, durationSec: 0 }, { fetcher })).toMatchObject({ submissionState: "not_submitted" });
  expect(await submitViduSingleVideo({ ...request, prompt: "字".repeat(2001) }, { fetcher })).toMatchObject({ submissionState: "not_submitted" });
  expect(fetcher).not.toHaveBeenCalled();
});

it("distinguishes definitive rejection from an unknown accepted receipt", async () => {
  const rejected = await submitViduSingleVideo(request, { fetcher: vi.fn(async () => new Response('{"message":"bad image"}', { status: 400 })) });
  expect(rejected).toMatchObject({ submissionState: "not_submitted" });
  const missing = await submitViduSingleVideo(request, { fetcher: vi.fn(async () => new Response('{}')) });
  expect(missing).toMatchObject({ submissionState: "unknown" });
});

it("refreshes the recorded economy provider even when current default is MJ", async () => {
  ENV.video302SubmitPath = "/mj-turbo/submit/video";
  const fetcher = vi.fn(async () => new Response('{"state":"success","creations":[{"url":"https://cdn.example/video.mp4"}]}'));
  const result = await refreshShotVideoTask("vidu-1", { renderMode: "economy", fetcher });
  expect(result).toMatchObject({ status: "available", videoUrl: "https://cdn.example/video.mp4" });
  expect((fetcher.mock.calls[0] as unknown as [string])[0]).toBe("https://api.302.ai/vidu/ent/v2/tasks/vidu-1/creations");
  expect(getShotVideoProviderStatus("economy").model).toBe("viduq2-pro-fast");
  expect(getShotVideoProviderStatus().model).toBe("mj-video");
});
