import { afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ save: vi.fn(), access: vi.fn(), download: vi.fn(), publicUrl: vi.fn() }));
vi.mock("./legnextImageDownload", () => ({ downloadLegnextImage: m.download }));
vi.mock("./imageGen", () => ({ storeImageBytes: m.save, toPublicImageUrl: m.publicUrl }));
vi.mock("./computeRequestAccess", () => ({ assertComputeRequestAccess: m.access }));
import { generateLegnextImage, legnextPrompt, legnextRetexturePrompt, isPlainAsciiPrompt, LEGNEXT_RETEXTURE_MAX_PROMPT_CHARS, resumeLegnextImage } from "./legnextImage";
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

it("uploads a shared composition/style/identity reference only once", async () => {
  vi.stubEnv("LEGNEXT_API_KEY", "test");
  m.publicUrl.mockResolvedValue("https://files.example.com/reference.png");
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ job_id: id }) });
  vi.stubGlobal("fetch", fetcher);
  await generateLegnextImage("teapot", vi.fn(), { inlinePoll: false, referenceImageUrl: "/ref.png", styleRef: "/ref.png", characterRef: "/ref.png", imageWeight: 2 });
  expect(m.publicUrl).toHaveBeenCalledTimes(1);
  const prompt = JSON.parse(fetcher.mock.calls[0][1].body).text;
  expect(prompt).toContain("--iw 2");
  expect(prompt).toContain("--sref https://files.example.com/reference.png");
  expect(prompt).toContain("--oref https://files.example.com/reference.png");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("downloads all four candidates concurrently, retaining provider order despite completion order", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "completed", output: { image_urls: [0,1,2,3].map(n => `https://images.sexapi.ai/${n}.png`) } }) }));
  const release: (() => void)[] = [];
  m.download.mockImplementation(() => new Promise(resolve => release.push(() => resolve(Uint8Array.from([137,80,78,71])))));
  m.save.mockImplementation(async (_bytes, _mime, options) => ({ imageUrl: options.storageKey, imageKey: options.storageKey }));
  const resultPromise = resumeLegnextImage(receipt);
  await vi.waitFor(() => expect(release).toHaveLength(4));
  for (const done of release.reverse()) done();
  const result = await resultPromise;
  expect(result.status).toBe("ok");
  expect(result.candidates?.map(candidate => candidate.imageKey?.slice(-5))).toEqual(["0.png", "1.png", "2.png", "3.png"]);
});

it("waits for other transfers after one fails and never reports partial success", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "completed", output: { image_urls: [0,1,2,3].map(n => `https://images.sexapi.ai/${n}.png`) } }) }));
  let release!: () => void;
  m.download.mockRejectedValueOnce(new Error("CDN timeout"))
    .mockImplementation(() => new Promise(resolve => { release = () => resolve(Uint8Array.from([137,80,78,71])); }))
    .mockResolvedValueOnce(Uint8Array.from([137,80,78,71]))
    .mockResolvedValueOnce(Uint8Array.from([137,80,78,71]));
  m.save.mockResolvedValue({ imageUrl: "/saved.png", imageKey: "saved.png" });
  let settled = false;
  const result = resumeLegnextImage(receipt).then(value => { settled = true; return value; });
  await vi.waitFor(() => expect(m.download).toHaveBeenCalledTimes(4));
  expect(settled).toBe(false); release();
  expect(await result).toMatchObject({ status: "error", errorCode: "timeout_pending", providerTaskId: receipt });
});


it("edits the exact uploaded canvas through Retexture without diffusion references or a new aspect ratio", async () => {
  vi.stubEnv("LEGNEXT_API_KEY", "test");
  m.publicUrl.mockResolvedValue("https://files.example.com/original.png");
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ job_id: id }) });
  vi.stubGlobal("fetch", fetcher);
  const accepted = vi.fn();
  await generateLegnextImage("subtler colors --ar 16:9 --turbo --v 8.2", accepted, { editMode: "retexture", inlinePoll: false, referenceImageUrl: "/original.png" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe("https://api.legnext.ai/api/v1/retexture");
  const payload = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(payload.imgUrl).toBe("https://files.example.com/original.png");
  expect(payload.remixPrompt).toContain("subtler colors");
  expect(payload.remixPrompt).toBe("subtler colors");
  expect(payload.remixPrompt).not.toContain("--");
  expect(payload.remixPrompt).not.toMatch(/--ar|--turbo|--fast|--iw|--sref/);
  expect(payload).not.toHaveProperty("text");
  expect(accepted).toHaveBeenCalledWith(receipt);
});
it("sends Retexture as one line without diffusion flags and refuses over-long text before submitting", async () => {
  vi.stubEnv("LEGNEXT_API_KEY", "test");
  m.publicUrl.mockResolvedValue("https://files.example.com/original.png");
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ job_id: id }) });
  vi.stubGlobal("fetch", fetcher);
  await generateLegnextImage("line one\nline two   line three", vi.fn(), { editMode: "retexture", inlinePoll: false, referenceImageUrl: "/original.png" });
  expect(JSON.parse(fetcher.mock.calls[0][1].body).remixPrompt).toBe("line one line two line three");
  expect(legnextRetexturePrompt("a\nb --v 8.2 --fast")).toBe("a b");
  fetcher.mockClear();
  const tooLong = await generateLegnextImage("a".repeat(LEGNEXT_RETEXTURE_MAX_PROMPT_CHARS + 1), vi.fn(), { editMode: "retexture", inlinePoll: false, referenceImageUrl: "/original.png" });
  expect(tooLong).toMatchObject({ status: "error" });
  expect(tooLong.message).toContain("本次未提交");
  expect(fetcher).not.toHaveBeenCalled();
  await generateLegnextImage("a".repeat(LEGNEXT_RETEXTURE_MAX_PROMPT_CHARS), vi.fn(), { editMode: "retexture", inlinePoll: false, referenceImageUrl: "/original.png" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("refuses a Retexture prompt containing Chinese or full-width punctuation before submitting, without stripping it", async () => {
  vi.stubEnv("LEGNEXT_API_KEY", "test");
  m.publicUrl.mockResolvedValue("https://files.example.com/original.png");
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ job_id: id }) });
  vi.stubGlobal("fetch", fetcher);
  for (const text of ["只改颜色", "smoother colors，keep the rest", "smoother colors\u3002"]) {
    const refused = await generateLegnextImage(text, vi.fn(), { editMode: "retexture", inlinePoll: false, referenceImageUrl: "/original.png" });
    expect(refused).toMatchObject({ status: "error" });
    expect(refused.message).toContain("纯英文");
    expect(refused.message).toContain("本次未提交");
  }
  expect(fetcher).not.toHaveBeenCalled();
  expect(isPlainAsciiPrompt("Refine only: smoother dots, keep text. --v 7")).toBe(true);
  expect(isPlainAsciiPrompt("keep\u00a0text")).toBe(false);
});
it("refuses Retexture without a unique base image before submitting", async () => {
  vi.stubEnv("LEGNEXT_API_KEY", "test");
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  expect((await generateLegnextImage("edit", vi.fn(), { editMode: "retexture" })).status).toBe("error");
  expect((await generateLegnextImage("edit", vi.fn(), { editMode: "retexture", referenceImageUrl: "/base", styleRef: "/other" })).status).toBe("error");
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([1, 2, 4])("recovers actual Retexture outputs (%i) without purchasing extra candidates", async count => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "completed", output: { image_urls: Array.from({length:count}, (_,i)=>`https://images.sexapi.ai/${i}.png`) } }) }));
  m.download.mockResolvedValue(Uint8Array.from([137,80,78,71]));
  m.save.mockImplementation(async (_bytes, _mime, options) => ({imageUrl: options.storageKey, imageKey: options.storageKey}));
  const result = await resumeLegnextImage(receipt, "retexture");
  expect(result.status).toBe("ok"); expect(result.candidates).toHaveLength(count);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("keeps incomplete diffusion pending and supports a singular edit output", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok:true, json:async()=>({status:"completed",output:{image_url:"https://images.sexapi.ai/one.png"}}) }));
  m.download.mockResolvedValue(Uint8Array.from([137,80,78,71]));m.save.mockResolvedValue({imageUrl:"/one.png",imageKey:"one"});
  expect((await resumeLegnextImage(receipt)).errorCode).toBe("timeout_pending");
  expect((await resumeLegnextImage(receipt,"retexture")).candidates).toHaveLength(1);
});

it("reports invalid prompt rejection safely and never repeats the purchase", async () => {
  const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({status:"failed",error:{raw_message:"Invalid_Prompt_Parameter secret-url"}})});
  vi.stubGlobal("fetch",fetcher);
  const result=await resumeLegnextImage(receipt,"retexture");
  expect(result.message).toContain("MJ 拒绝了精修参数");expect(result.message).not.toContain("secret-url");expect(fetcher).toHaveBeenCalledTimes(1);
});
