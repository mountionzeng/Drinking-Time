import { afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ save: vi.fn(), access: vi.fn(), download: vi.fn(), publicUrl: vi.fn() }));
vi.mock("./legnextImageDownload", () => ({ downloadLegnextImage: m.download }));
vi.mock("./imageGen", () => ({ storeImageBytes: m.save, toPublicImageUrl: m.publicUrl }));
vi.mock("./computeRequestAccess", () => ({ assertComputeRequestAccess: m.access }));
import { generateLegnextImage, legnextPrompt, resumeLegnextImage } from "./legnextImage";
const id = "12345678-1234-1234-1234-123456789abc";
const receipt = `legnext:${id}`;
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetAllMocks(); });
it("pins V7 Fast and strips switches that change price", () => {
  expect(legnextPrompt("boat --v 6 --turbo --draft --q 4 --ar 1:1")).toBe("boat --v 7 --fast --ar 3:4");
});
it("sends all uploaded book references to Legnext in exactly one paid request", async () => {
  vi.stubEnv("LEGNEXT_API_KEY", "test");
  m.publicUrl.mockImplementation(async (source: string) => `https://files.example.com/${source.split('/').pop()}`);
  const fetcher = vi.fn().mockResolvedValue({ok:true,json:async()=>({job_id:id})});
  vi.stubGlobal("fetch",fetcher);
  await generateLegnextImage("teapot",vi.fn(),{inlinePoll:false,referenceImageUrl:"/api/images/first.png",referenceContextImageUrls:["/api/images/second.png"],aspectRatio:"16:9"});
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe("https://api.legnext.ai/api/v1/diffusion");
  const prompt = JSON.parse(fetcher.mock.calls[0][1].body).text;
  expect(prompt).toContain("https://files.example.com/first.png https://files.example.com/second.png");
  expect(prompt).toContain("--v 7 --fast --ar 16:9");
});
it("does not submit or silently drop references when one upload fails", async () => {
  vi.stubEnv("LEGNEXT_API_KEY", "test");
  m.publicUrl.mockResolvedValueOnce("https://files.example.com/first.png").mockResolvedValueOnce(undefined);
  const fetcher=vi.fn(); vi.stubGlobal("fetch",fetcher);
  const result=await generateLegnextImage("teapot",vi.fn(),{referenceImageUrl:"/api/images/first.png",referenceContextImageUrls:["/api/images/second.png"]});
  expect(result.message).toContain("本次没有提交图片任务");
  expect(result.message).not.toContain("先保存图片到仓库");
  expect(fetcher).not.toHaveBeenCalled();
});
it("fails closed without a key and does not call 302", async () => {
  vi.stubEnv("LEGNEXT_API_KEY", ""); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  expect((await generateLegnextImage("boat", vi.fn())).status).toBe("error");
  expect(fetcher).not.toHaveBeenCalled();
});
it("does not retry ambiguous paid submission", async () => {
  vi.stubEnv("LEGNEXT_API_KEY", "test"); const fetcher = vi.fn().mockRejectedValue(new Error("secret")); vi.stubGlobal("fetch", fetcher);
  expect(await generateLegnextImage("boat", vi.fn())).toMatchObject({ status: "error", submissionUncertain: true });
  expect(fetcher).toHaveBeenCalledTimes(1); expect(m.access).toHaveBeenCalledOnce();
});
it("preserves receipt if durable acceptance callback fails; no poll or second POST", async () => {
  vi.stubEnv("LEGNEXT_API_KEY", "test"); const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ job_id: id }) }); vi.stubGlobal("fetch", fetcher);
  const accepted = vi.fn().mockRejectedValue(new Error("disk"));
  expect(await generateLegnextImage("boat", accepted)).toMatchObject({ providerTaskId: receipt });
  expect(accepted).toHaveBeenCalledWith(receipt); expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each(["pending", "processing", "retry", "staged"])("resumes %s only by GET", async status => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status }) }); vi.stubGlobal("fetch", fetcher);
  expect(await resumeLegnextImage(receipt)).toMatchObject({ providerTaskId: receipt, errorCode: "timeout_pending" });
  expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0][1].method).toBeUndefined();
});
it("distinguishes provider-confirmed failure from a retryable pending response", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "failed" }) });
  vi.stubGlobal("fetch", fetcher);
  const result = await resumeLegnextImage(receipt);
  expect(result).toMatchObject({ status: "error", providerTaskId: receipt });
  expect(result.errorCode).not.toBe("timeout_pending");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("persists all four completed outputs with stable keys before success", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ status: "completed", output: { image_urls: [1,2,3,4].map(n => `https://images.sexapi.ai/${n}.png`) } }) })
    .mockResolvedValue({ ok: true, arrayBuffer: async () => Uint8Array.from([137,80,78,71]).buffer });
  vi.stubGlobal("fetch", fetcher); m.save.mockImplementation(async (_bytes, _mime, o) => ({ imageUrl: "/api/images/" + o.storageKey, imageKey: o.storageKey }));
  m.download.mockResolvedValue(Uint8Array.from([137,80,78,71]));
  const result = await resumeLegnextImage(receipt);
  expect(result.status).toBe("ok"); expect(result.candidates).toHaveLength(4); expect(m.save).toHaveBeenCalledTimes(4);
  expect(result.imageUrl).not.toContain(id);
});
it("refuses unexpected asset hosts without fetching them", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "completed", output: { image_urls: Array(4).fill("http://127.0.0.1/private") } }) }); vi.stubGlobal("fetch", fetcher);
  expect(await resumeLegnextImage(receipt)).toMatchObject({ status: "error", providerTaskId: receipt }); expect(fetcher).toHaveBeenCalledTimes(1);
});
it("inlinePoll:false returns pending right after the durable receipt, without any GET", async () => {
  vi.stubEnv("LEGNEXT_API_KEY", "test"); const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ job_id: id }) }); vi.stubGlobal("fetch", fetcher);
  const accepted = vi.fn().mockResolvedValue(undefined);
  expect(await generateLegnextImage("boat", accepted, { inlinePoll: false })).toMatchObject({ status: "error", providerTaskId: receipt });
  expect(accepted).toHaveBeenCalledWith(receipt); expect(fetcher).toHaveBeenCalledTimes(1);
});
