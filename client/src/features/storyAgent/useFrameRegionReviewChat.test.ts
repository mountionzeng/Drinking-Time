import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  turn: vi.fn(), generate: vi.fn(), invalidate: vi.fn(), openVideo: vi.fn(),
  effects: [] as Array<() => void | (() => void)>,
  state: { accountId: 1, activeStoryId: 7, storyScopeEpoch: 1, storyLoadEpoch: 1, messages: [] as any[] },
}));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: (effect: () => void | (() => void)) => m.effects.push(effect),
}));
vi.mock("@/lib/trpc", () => ({ trpc: {
  creationAgent: { frameReview: { turn: { useMutation: () => ({ mutateAsync: m.turn }) }, generateCloud: { useMutation: () => ({ mutateAsync: m.generate }) } } },
  useUtils: () => ({ storyAgent: { chatImageRevisions: { invalidate: m.invalidate }, storyImages: { invalidate: m.invalidate }, storyMaterialState: { invalidate: m.invalidate } } }),
} }));
vi.mock("./spine/storySpine", () => ({ storySpineStore: { getState: () => ({ ...m.state }) } }));
vi.mock("@/features/uiLanguage/UiLanguage", () => ({ useUiLanguage: () => ({ language: "zh" }) }));
import { useFrameRegionReviewChat } from "./useFrameRegionReviewChat";
vi.mock("./frameReviewVideoBridge", () => ({ openReviewedVideo: m.openVideo }));

function renderHook(hook: typeof useFrameRegionReviewChat) {
  let current!: ReturnType<typeof hook>;
  function Harness() { current = hook(); return null; }
  renderToStaticMarkup(React.createElement(Harness));
  const cleanups = m.effects.splice(0).map(effect => effect());
  return { result: { current }, unmount: () => cleanups.splice(0).forEach(cleanup => cleanup?.()) };
}
const act = (fn: () => Promise<void>) => fn();

beforeEach(() => {
  vi.clearAllMocks();
  m.effects = [];
  m.state.activeStoryId = 7;
  m.state.messages = [{ frameReview: { id: "review", storyId: 7, stableShotId: "third", shotNo: 3, revision: 2, phase: "scope_review", activeTarget: "cloud",
    tasks: [{ target: "cloud", imageId: 10, shapeQuote: { requestId: "receipt", sourceImageId: 11, fingerprint: "hash", estimatedCny: .5 } }] } }];
  m.turn.mockResolvedValue({ handled: true, reply: "quote" });
  m.generate.mockResolvedValue({ status: "ok", imageId: 12, imageUrl: "/12.png", frameReview: m.state.messages[0].frameReview });
});

it("routes the exact short cloud request to a quote, without buying", async () => {
  const hook = renderHook(useFrameRegionReviewChat);
  const text = "更大一点，更厚一点，白一点，但是饱和度要高";
  await act(async () => { await hook.result.current(7, text, { stableShotId: "third", imageId: 11 }); });
  expect(m.turn).toHaveBeenCalledWith(expect.objectContaining({ instruction: text, imageId: 11, reviewId: "review", expectedRevision: 2 }));
  expect(m.generate).not.toHaveBeenCalled(); hook.unmount();
});

it("routes rejected forest colors to saved feedback, never cloud generation", async () => {
  const hook=renderHook(useFrameRegionReviewChat);
  await hook.result.current(7,'#11 的森林配色不满意',{stableShotId:'third',imageId:11});
  expect(m.turn).toHaveBeenCalledWith(expect.objectContaining({instruction:'#11 的森林配色不满意',reviewId:'review',imageId:11}));
  expect(m.generate).not.toHaveBeenCalled(); hook.unmount();
});

it("checks a newly attached frame without triggering an old cloud quote and continues its saved review", async () => {
  const hook = renderHook(useFrameRegionReviewChat);
  const frame = { storyId: 7, stableShotId: "third", shotNo: 3, imageId: 99, imageUrl: "/api/images/99.png",
    takeId: 10, timelineVersion: 17, timelineFrame: 90, sourceTimeSec: 3, shotTimeSec: 3 };
  await hook.result.current(7, "查看这一帧", { stableShotId: "third", imageId: 99 }, frame, { inspectOnly: true });
  expect(m.turn).toHaveBeenCalledWith(expect.objectContaining({ sourceFrame: frame, inspectOnly: true }));
  expect(m.turn.mock.calls[0][0].reviewId).toBeUndefined();
  const review = { ...m.state.messages[0].frameReview, id: "captured", timelineVersion: 17, frames: [frame], tasks: [], revision: 0 };
  await hook.result.current(7, "森林和云一起改", { stableShotId: "third", imageId: 99 }, frame, { review });
  expect(m.turn).toHaveBeenLastCalledWith(expect.objectContaining({ reviewId: "captured", expectedRevision: 0, imageId: 99, sourceFrame: undefined }));
  expect(m.generate).not.toHaveBeenCalled();
  hook.unmount();
});

it("blocks confirmation when the user has selected another image", async () => {
  const hook = renderHook(useFrameRegionReviewChat);
  expect(await hook.result.current(7, "确认生成云层", { imageId: 99 })).toMatchObject({ reply: expect.stringContaining("所选图片变了") });
  expect(m.generate).not.toHaveBeenCalled(); hook.unmount();
});

it("follows pending work using only the original receipt with recoverOnly", async () => {
  const hook = renderHook(useFrameRegionReviewChat);
  m.generate.mockResolvedValueOnce({ status: "error", recoveryPending: true });
  await act(async () => { await hook.result.current(7, "确认生成云层", { imageId: 11 }); });
  expect(m.generate).toHaveBeenCalledTimes(2);
  expect(m.generate.mock.calls[0][0]).toMatchObject({ requestId: "receipt", recoverOnly: false });
  expect(m.generate.mock.calls[1][0]).toMatchObject({ requestId: "receipt", recoverOnly: true });
  hook.unmount();
});

it("retrieves rather than submitting on show-result requests", async () => {
  const hook = renderHook(useFrameRegionReviewChat);
  await act(async () => { await hook.result.current(7, "查看云层"); });
  expect(m.generate).toHaveBeenCalledWith(expect.objectContaining({ recoverOnly: true })); hook.unmount();
});

it.each(["story", "unmount"])("stops polling after %s changes while the first response is pending", async change => {
  const hook = renderHook(useFrameRegionReviewChat);
  let resolve!: (v: any) => void;
  m.generate.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const pending = hook.result.current(7, "确认生成云层");
  if (change === "story") m.state.activeStoryId = 8;
  else hook.unmount();
  resolve({ status: "error", recoveryPending: true });
  const result = await pending;
  expect(m.generate).toHaveBeenCalledTimes(1);
  expect(result).not.toHaveProperty("frameReview"); hook.unmount();
});

it("continues the same warehouse-frame review even though the source has no timeline version", async () => {
  const hook = renderHook(useFrameRegionReviewChat);
  const frame = { storyId: 7, stableShotId: "third", shotNo: 3, imageId: 99, imageUrl: "/api/images/99.png", takeId: 10,
    origin: "warehouse-video" as const, sourceTimeSec: 3, shotTimeSec: 3 };
  const review = { ...m.state.messages[0].frameReview, id: "warehouse", timelineVersion: 17, frames: [frame], tasks: [], revision: 0 };
  await hook.result.current(7, "森林和云一起改", {stableShotId:"third",imageId:99}, frame, {review});
  expect(m.turn).toHaveBeenCalledWith(expect.objectContaining({reviewId:"warehouse",expectedRevision:0,sourceFrame:undefined}));
  expect(m.generate).not.toHaveBeenCalled(); hook.unmount();
});

it("opens only the server-validated video plan, without purchasing", async () => {
  const hook = renderHook(useFrameRegionReviewChat);
  const plan = { storyId: 7, images: [{ id: 12 }] };
  m.turn.mockResolvedValue({ handled: true, reply: "Review quote", videoPlan: plan });
  await hook.result.current(7, "生成视频");
  expect(m.openVideo).toHaveBeenCalledWith(plan);
  expect(m.generate).not.toHaveBeenCalled();
  hook.unmount();
});
it("does not open a late video plan after a story change", async () => {
  const hook = renderHook(useFrameRegionReviewChat);
  m.turn.mockImplementation(async () => {
    m.state.activeStoryId = 8;
    return { handled: true, videoPlan: { storyId: 7 }, reply: "plan" };
  });
  await hook.result.current(7, "生成视频");
  expect(m.openVideo).not.toHaveBeenCalled();
  hook.unmount();
});
