import { beforeEach, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
const mocks = vi.hoisted(() => ({ run: vi.fn(), candidates: vi.fn() }));
vi.mock("../_core/inferenceOrchestrator", async load => ({
  ...(await load<typeof import("../_core/inferenceOrchestrator")>()),
  runInference: mocks.run,
}));
vi.mock("../_core/textComputeProvider", async load => ({
  ...(await load<typeof import("../_core/textComputeProvider")>()),
  resolveComputeCandidates: mocks.candidates,
}));
import { InferenceError } from "../_core/inferenceOrchestrator";
import { runPublishingVideoStoryboardTextCompute as compute } from "./publishingVideoStoryboard";
const input = { systemPrompt: "输出 JSON", context: { target: "text" }, failureMode: "throw" as const };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.candidates.mockReturnValue([{ label: "302" }]);
});
it("reports missing configuration instead of producing an empty manuscript", async () => {
  mocks.candidates.mockReturnValue([]);
  await expect(compute(input)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  expect(mocks.run).not.toHaveBeenCalled();
});
it("reports rejected provider configuration, not manuscript schema failure", async () => {
  mocks.run.mockRejectedValue(new InferenceError("private provider detail", [
    { provider: "openai-next", model: "test", status: 401, category: "auth", aborted: false, acceptanceUnknown: false },
    { provider: "302", model: "test", status: 400, category: "invalid_request", aborted: false, acceptanceUnknown: false },
  ]));
  await expect(compute(input)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE", message: expect.stringContaining("配置") });
  expect(mocks.run).toHaveBeenCalledTimes(1);
});
it("keeps unknown submission distinct and never invites a blind retry", async () => {
  mocks.run.mockRejectedValue(new InferenceError("private provider detail", [
    { provider: "302", model: "test", category: "timeout", aborted: false, acceptanceUnknown: true },
  ]));
  await expect(compute(input)).rejects.toMatchObject({ code: "TIMEOUT", message: expect.stringContaining("勿重复提交") });
  expect(mocks.run).toHaveBeenCalledTimes(1);
});
it("preserves balance and permission errors without hiding them", async () => {
  const cause = new TRPCError({ code: "FORBIDDEN", message: "算力余额不足" });
  mocks.run.mockRejectedValue(cause);
  await expect(compute(input)).rejects.toBe(cause);
});
it.each(["not json", "null"])("rejects invalid JSON result %s instead of returning null", async content => {
  mocks.run.mockResolvedValue({ result: { choices: [{ message: { content } }] }, model: "test", providerLabel: "302" });
  await expect(compute(input)).rejects.toMatchObject({ code: "BAD_GATEWAY", message: expect.stringContaining("格式") });
});
it("retains permissive fallback for existing storyboard callers", async () => {
  mocks.run.mockRejectedValue(new Error("provider unavailable"));
  const result = await compute({ systemPrompt: "输出 JSON", context: {} });
  expect(result.parsed).toBeNull();
  expect(result.modelLabel).toContain("保底");
});
it("returns valid output and uses strict single-outcome retry semantics", async () => {
  mocks.run.mockResolvedValue({ result: { choices: [{ message: { content: '{"chapters":[]}' } }] }, model: "test", providerLabel: "302" });
  expect((await compute(input)).parsed).toEqual({ chapters: [] });
  expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ replaySafe: false, retryRejected: true }));
});
