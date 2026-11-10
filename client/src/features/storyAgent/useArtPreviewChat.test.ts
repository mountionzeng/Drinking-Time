import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ plan: vi.fn(), choose: vi.fn(), generate: vi.fn(), recover: vi.fn(), invalidate: vi.fn(), confirm: vi.fn(), state: { activeStoryId: 1, storyScopeEpoch: 1, storyLoadEpoch: 1 } }));
vi.mock("@/lib/trpc", () => ({ trpc: {
  artSystems: { previewPlan: { useMutation: () => ({ mutateAsync: m.plan }) }, previewChoose: { useMutation: () => ({ mutateAsync: m.choose }) } },
  storyAgent: { generateForMobile: { useMutation: () => ({ mutateAsync: m.generate }) }, recoverStoryboardImage: { useMutation: () => ({ mutateAsync: m.recover }) } },
  useUtils: () => ({ artSystems: { previewRead: { invalidate: m.invalidate } }, storyAgent: { storyMaterialState: { invalidate: m.invalidate }, storyImages: { invalidate: m.invalidate } } })
} }));
vi.mock("./mediaChatSession", () => ({ askMediaChatConfirmation: m.confirm, withMediaChatSession: (_id: number, work: () => unknown) => work() }));
vi.mock("./spine/storySpine", () => ({ storySpineStore: { getState: () => ({ ...m.state }), subscribe: () => () => {} } }));
import { useArtPreviewChat } from "./useArtPreviewChat";
beforeEach(() => {
  vi.clearAllMocks(); m.state.activeStoryId = 1;
  m.plan.mockResolvedValue({ id: "batch", version: 1, baselineImageId: 2038, estimatedCny: 2.04, musicContext: "music notes", shots: [1,2,3].map(n => ({ shotNo: n, label: `0${n}`, requestId: `request${n}` })) });
  m.confirm.mockResolvedValue(false); m.generate.mockResolvedValue({ status: "ok" });
});
it("quotes the entire batch once and cancellation submits nothing", async () => {
  const result = await useArtPreviewChat()(1, "用图片 #2038 生成一组示意图");
  expect(m.confirm).toHaveBeenCalledTimes(1); expect(m.confirm.mock.calls[0][0].text).toContain("共 12 张");
  expect(m.generate).not.toHaveBeenCalled(); expect(result?.reply).toContain("已取消");
});
it("runs at most two jobs concurrently and does not retry a failed purchase", async () => {
  m.confirm.mockResolvedValue(true);
  let active = 0, peak = 0;
  m.generate.mockImplementation(async ({ shotNo }) => {
    active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 1)); active--;
    return shotNo === 2 ? { status: "error", error: "failed" } : { status: "ok" };
  });
  const result = await useArtPreviewChat()(1, "生成一组示意图");
  expect(m.generate).toHaveBeenCalledTimes(3); expect(peak).toBe(2); expect(result?.reply).toContain("2/3");
  expect(m.generate.mock.calls[0][0]).toMatchObject({ previewBatchId: "batch", costConfirmation: { accepted: true, estimatedCny: 0.68 } });
});
it("a story change during confirmation stops submissions", async () => {
  m.confirm.mockImplementation(async () => { m.state.activeStoryId = 2; return true; });
  await useArtPreviewChat()(1, "生成一组示意图"); expect(m.generate).not.toHaveBeenCalled();
});
it("choosing and viewing never purchases media", async () => {
  m.choose.mockResolvedValue({ imageId: 22, version: 1, label: "02" });
  await useArtPreviewChat()(1, "第2镜用第3张"); await useArtPreviewChat()(1, "查看示意图");
  expect(m.choose).toHaveBeenCalledWith({ storyId: 1, shotNo: 2, ordinal: 3, version: undefined });
  expect(m.plan).not.toHaveBeenCalled(); expect(m.generate).not.toHaveBeenCalled(); expect(m.confirm).not.toHaveBeenCalled();
});
it("returns accepted receipts promptly so the conversation can accept choices before every image finishes", async () => {
  m.confirm.mockResolvedValue(true);
  m.generate.mockResolvedValue({ status: "error", providerTaskId: "legnext:accepted", error: "pending" });
  const result = await useArtPreviewChat()(1, "生成一组示意图");
  expect(result?.reply).toContain("3 个镜头正在生成");
  expect(m.generate).toHaveBeenCalledTimes(3); expect(m.recover).not.toHaveBeenCalled();
});
