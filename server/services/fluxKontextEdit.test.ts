import { afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ materialize: vi.fn(), store: vi.fn(), access: vi.fn() }));
vi.mock("../_core/env", () => ({ ENV: { api302Key: "test", api302BaseUrl: "https://api.302.ai" } }));
vi.mock("./imageAssets", () => ({ materializeImageInput: m.materialize }));
vi.mock("./imageGen", () => ({ storeImageBytes: m.store, toPublicImageUrl: async (url: string) => url }));
vi.mock("./computeRequestAccess", () => ({ assertComputeRequestAccess: m.access }));
import { generate302FluxEdit, resume302FluxEdit, generate302FluxDevEdit, resume302FluxResult } from "./fluxKontextEdit";
const id = "251c4e06-7bd1-4f68-8fa7-f89fa61a96e7";
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
function setup(payload: unknown, status = 200) {
  m.materialize.mockResolvedValue("data:image/png;base64,AAAA");
  const fetcher = vi.fn().mockResolvedValue({ ok: status === 200, status, json: async () => payload });
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
it("submits the original exactly once with prompt expansion disabled, persisting before polling", async () => {
  const fetcher = setup({ id }); const accepted = vi.fn();
  expect(await generate302FluxEdit("/original.png", "Refine only existing colors.", accepted)).toMatchObject({ providerTaskId: id, errorCode: "timeout_pending" });
  expect(accepted).toHaveBeenCalledWith(id);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0][0])).toBe("https://api.302.ai/flux/v1/flux-kontext-pro");
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ input_image: "data:image/png;base64,AAAA", prompt: "Refine only existing colors.", prompt_upsampling: false, output_format: "png" });
  expect(m.access).toHaveBeenCalledTimes(1);
});
it.each([400, 401, 402, 403, 404, 422, 429])("reports refusal %s without fallback or repurchase", async status => {
  const fetcher = setup({}, status);
  expect(await generate302FluxEdit("/original", "Refine colors", vi.fn())).toMatchObject({ status: "error", message: expect.stringContaining(String(status)) });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("does not submit if the original cannot be read", async () => {
  const fetcher = setup({}); m.materialize.mockRejectedValue(new Error("missing"));
  expect((await generate302FluxEdit("/original", "Refine colors", vi.fn())).message).toContain("未提交");
  expect(fetcher).not.toHaveBeenCalled();
});
it("retains an accepted receipt even if persisting it fails", async () => {
  setup({ id });
  expect(await generate302FluxEdit("/original", "Refine colors", vi.fn().mockRejectedValue(new Error()))).toMatchObject({ providerTaskId: id });
});
it.each([{}, { id: 123 }, null])("keeps malformed replies unknown without retry", async payload => {
  const fetcher = setup(payload);
  expect(await generate302FluxEdit("/original", "Refine colors", vi.fn())).toMatchObject({ submissionUncertain: true });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("queries only the saved receipt on the fixed 302 endpoint and saves a deterministic local version", async () => {
  const fetcher = setup({ id, status: "Ready", result: { sample: "https://file.302.ai/new.png" } });
  fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ id, status: "Ready", result: { sample: "https://file.302.ai/new.png" } }) });
  fetcher.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }));
  m.store.mockResolvedValue({ status: "ok", imageUrl: "/api/images/new.png", imageKey: "saved" });
  expect(await resume302FluxEdit(id)).toMatchObject({ status: "ok", imageUrl: "/api/images/new.png" });
  expect(String(fetcher.mock.calls[0][0])).toBe(`https://api.302.ai/flux/v1/get_result?id=${id}`);
  expect(fetcher.mock.calls.every(([, options]) => options.method === "GET")).toBe(true);
  expect(fetcher.mock.calls[1][1].headers).toBeUndefined();
  expect(m.store).toHaveBeenCalledWith(expect.any(Uint8Array), "image/png", { storageKey: `generated/flux-kontext/${id}.png`, requireLocal: true });
  expect(m.access).not.toHaveBeenCalled();
});
it.each(["Error", "Request Moderated", "Content Moderated"])("marks only provider terminal %s as failed", async status => {
  setup({ id, status });
  expect(await resume302FluxEdit(id)).toMatchObject({ providerConfirmedFailure: true, providerTaskId: id });
});
it.each(["Pending", "Task not found", "Ready"])("keeps incomplete %s recoverable", async status => {
  setup({ id, status }); expect(await resume302FluxEdit(id)).toMatchObject({ errorCode: "timeout_pending" });
});
it("does not fetch a local output URL or a mismatched task result", async () => {
  const fetcher = setup({ id, status: "Ready", result: { sample: "http://127.0.0.1/secret" } });
  expect(await resume302FluxEdit(id)).toMatchObject({ errorCode: "timeout_pending" });
  expect(fetcher).toHaveBeenCalledTimes(1); expect(m.store).not.toHaveBeenCalled();
});

it("retains safe HTTP diagnostics for uncertain replies without leaking response content", async () => {
  const fetcher = setup({ error: { err_code: -10021, message: "secret-key/private-prompt" } }, 500);
  const result = await generate302FluxEdit("/original", "Refine colors", vi.fn());
  expect(result).toMatchObject({ submissionUncertain: true, message: expect.stringContaining("HTTP 500") });
  expect(result.message).toContain("-10021");
  expect(result.message).not.toContain("secret-key"); expect(fetcher).toHaveBeenCalledTimes(1);
});

it("persists a Dev output URL before downloading, then recovers it with GET only", async () => {
  const fetcher = setup({ images: [{ url: "https://file.302.ai/dev.png" }] });
  const ready = vi.fn();
  const result = await generate302FluxDevEdit("https://file.302.ai/original.png", "Refine colors only", ready);
  expect(result).toMatchObject({ providerResultUrl: "https://file.302.ai/dev.png", errorCode: "timeout_pending" });
  expect(ready).toHaveBeenCalledWith("https://file.302.ai/dev.png");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0][0])).toBe("https://api.302.ai/302/submit/flux-kontext-dev");
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ image_url: "https://file.302.ai/original.png", prompt: "Refine colors only", output_format: "png" });
  fetcher.mockResolvedValue(new Response(new Uint8Array([1,2,3]), { headers: { "content-type": "image/png" } }));
  m.store.mockResolvedValue({ status:"ok", imageUrl:"/dev.png" });
  expect(await resume302FluxResult("https://file.302.ai/dev.png", id)).toMatchObject({ status:"ok" });
  expect(fetcher.mock.calls[1][1]).toMatchObject({ method:"GET" });
  expect(fetcher.mock.calls[1][1].headers).toBeUndefined();
});

it("keeps a synchronous result recoverable when receipt persistence fails", async () => {
  setup({ images: [{ url: "https://file.302.ai/dev.png" }] });
  expect(await generate302FluxDevEdit("https://file.302.ai/original.png", "Refine colors", vi.fn().mockRejectedValue(new Error()))).toMatchObject({ providerResultUrl:"https://file.302.ai/dev.png", errorCode:"timeout_pending" });
});

it("never downloads untrusted result URLs or resubmits after a download failure", async () => {
  const fetcher = setup({});
  expect(await resume302FluxResult("https://127.0.0.1/secret", id)).toMatchObject({ errorCode:"timeout_pending" });
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockRejectedValue(new Error("network"));
  expect(await resume302FluxResult("https://file.302.ai/dev.png", id)).toMatchObject({ providerResultUrl:"https://file.302.ai/dev.png" });
  expect(fetcher.mock.calls.every(([, opts]) => opts.method === "GET")).toBe(true);
});
