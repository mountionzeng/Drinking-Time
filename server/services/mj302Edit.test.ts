import { afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ publicUrl: vi.fn(), resume: vi.fn(), access: vi.fn() }));
vi.mock("../_core/env", () => ({ ENV: { api302Key: "test", api302BaseUrl: "https://api.302.ai" } }));
vi.mock("./imageGen", () => ({ toPublicImageUrl: m.publicUrl, resume302MidjourneyTask: m.resume }));
vi.mock("./computeRequestAccess", () => ({ assertComputeRequestAccess: m.access }));
import { generate302MjEdit, resume302MjEdit } from "./mj302Edit";
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
function setup(payload: unknown, status = 200) {
  m.publicUrl.mockResolvedValue("https://file.302.ai/original.png");
  const fetcher = vi.fn().mockResolvedValue({ ok: status === 200, status, json: async () => payload });
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
it("uses external-image Edits and persists its receipt before returning; no Imagine or extra POST", async () => {
  const fetcher = setup({ code: 1, result: "12345678901234567" }); const accepted = vi.fn();
  expect(await generate302MjEdit("/original.png", "richer color --v 7 --turbo", accepted)).toMatchObject({ providerTaskId: "12345678901234567", errorCode: "timeout_pending" });
  expect(accepted).toHaveBeenCalledWith("12345678901234567");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0][0])).toBe("https://api.302.ai/mj/submit/edits");
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ image: "https://file.302.ai/original.png", prompt: "richer color" });
  expect(m.resume).not.toHaveBeenCalled();
});
it.each([401, 404, 429])("reports HTTP %s without retry, fallback or a false receipt", async status => {
  const fetcher = setup({}, status);
  expect(await generate302MjEdit("/original", "color", vi.fn())).toMatchObject({ status: "error", message: expect.stringContaining(String(status)) });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("identifies a missing edit endpoint instead of blaming the user's image or prompt", async () => {
  const fetcher = setup({ error: "Not Found", path: "/mj/submit/edits", private: "secret" }, 404);
  const result = await generate302MjEdit("/original", "color", vi.fn());
  expect(result.message).toContain("原图编辑地址不可用（HTTP 404）");
  expect(result.message).not.toContain("secret");
  expect(result.providerTaskId).toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("does not purchase if the original cannot be uploaded", async () => {
  const fetcher = setup({}); m.publicUrl.mockResolvedValue(undefined);
  expect((await generate302MjEdit("/original", "color", vi.fn())).message).toContain("本次未提交");
  expect(fetcher).not.toHaveBeenCalled();
});
it("keeps an ambiguous submission unknown and never retries", async () => {
  const fetcher = setup({}); fetcher.mockRejectedValue(new Error("private detail"));
  const result = await generate302MjEdit("/original", "color", vi.fn());
  expect(result).toMatchObject({ submissionUncertain: true });
  expect(result.message).not.toContain("private detail"); expect(fetcher).toHaveBeenCalledTimes(1);
});
it("does not persist a numeric receipt whose precision was lost", async () => {
  const fetcher = setup({ code: 1, result: 123456789012345678 }); const accepted = vi.fn();
  expect(await generate302MjEdit("/original", "color", accepted)).toMatchObject({submissionUncertain:true});
  expect(accepted).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1);
});
it("retains an accepted receipt even when local persistence fails", async () => {
  const fetcher = setup({code:1,result:"1234"});
  expect(await generate302MjEdit("/original", "color", vi.fn().mockRejectedValue(new Error()))).toMatchObject({ providerTaskId: "1234" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("separates a confirmed failure from retryable GET/download problems", async () => {
  m.resume.mockResolvedValueOnce({status:"error",message:"private",providerConfirmedFailure:true})
    .mockResolvedValueOnce({status:"error",message:"HTTP 403"})
    .mockResolvedValueOnce({status:"ok",imageUrl:"/new.png"});
  expect(await resume302MjEdit("1234")).toMatchObject({providerConfirmedFailure:true,providerTaskId:"1234"});
  expect(await resume302MjEdit("1234")).toMatchObject({errorCode:"timeout_pending"});
  expect(await resume302MjEdit("1234")).toMatchObject({status:"ok",imageUrl:"/new.png"});
});
