import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SelectionContext } from "@shared/selectionContext";
import { PAUSED_FRAME_SHORTCUT_EVENT } from "@/features/creationEditor/frameNavigation";
const m = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  focus: vi.fn(),
  inspect: vi.fn(),
  paletteQuote: vi.fn(), paletteRender: vi.fn(), recover: vi.fn(),
  capture: vi.fn(),
  invalidate: vi.fn(),
  propose: vi.fn(),
  messages: [] as any[],
  state: {
    accountId: 1,
    activeStoryId: 7,
    storyScopeEpoch: 1,
    storyLoadEpoch: 1,
    activeSelection: null as SelectionContext | null,
    pausedPreviewFrame: {
      storyId: 7,
      timelineVersion: 16,
      timelineFrame: 90,
      hiddenVisualLayers: [],
      width: 1080,
      height: 1920,
    },
    setMessages: vi.fn(),
    setActiveSelection: vi.fn(),
  },
}));
// Run the real shortcut listener; static rendering alone never mounts effects.
vi.mock("react", async importOriginal => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: (effect: () => void | (() => void)) => m.effects.push(effect),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    creationAgent: {
      chatFrameReferences: { useMutation: () => ({ mutateAsync: m.capture }) },
    },
    storyAgent: {
      framePaletteRender: { useMutation: () => ({ mutateAsync: m.paletteRender }) },
      recoverStoryboardImage: { useMutation: () => ({ mutateAsync: m.recover }) },
    },
    useUtils: () => ({
      storyAgent: {
        storyImages: { invalidate: m.invalidate },
        storyMaterialState: { invalidate: m.invalidate },
        inspectFrameColorMatch: { fetch: m.inspect },
        framePaletteQuote: { fetch: m.paletteQuote },
        chatImageRevisions: { invalidate: m.invalidate },
      },
    }),
  },
}));
vi.mock("@/features/uiLanguage/UiLanguage", () => ({
  useUiLanguage: () => ({ language: "en" }),
}));
vi.mock("./spine/storySpine", () => ({
  storySpineStore: { getState: () => m.state },
  useStorySpine: (fn: any) => fn(m.state),
}));
import {
  freezePausedFrame,
  pausedDraftIsCurrent,
  usePausedFrameChat,
} from "./usePausedFrameChat";
import {
  chatFrameReferenceSchema,
  usesPausedFrame,
} from "@shared/chatFrameReference";
const frame = {
  storyId: 7,
  stableShotId: "s3",
  shotNo: 3,
  imageId: 100,
  imageUrl: "/api/images/ref.png",
  takeId: 10,
  origin: "paused-preview" as const,
  timelineVersion: 16,
  timelineFrame: 90,
  sourceTimeSec: 3,
  shotTimeSec: 3,
};
function setup(selectedImageId?: number, reviewFrame?: Parameters<typeof usePausedFrameChat>[0]["reviewFrame"]) {
  let api!: ReturnType<typeof usePausedFrameChat>;
  function Host() {
    api = usePausedFrameChat({
      storyId: 7,
      enabled: true,
      text: "这一帧颜色更细腻",
      selectedImageId,
      proposeFrame: m.propose,
      reviewFrame,
      focusComposer: m.focus,
    });
    return null;
  }
  renderToStaticMarkup(<Host />);
  m.effects.splice(0).forEach(effect => effect());
  return api;
}
it("names the live playhead time instead of an ambiguous this-frame placeholder", () => {
  const api = setup();
  expect(api.placeholder).toContain("3.00s");
  expect(api.contextLabel).toContain("3.00s");
  expect(setup(100).contextLabel).toBeUndefined();
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", new EventTarget());
  m.effects = [];
  m.state.activeStoryId = 7;
  m.state.storyScopeEpoch = 1;
  m.state.storyLoadEpoch = 1;
  m.state.pausedPreviewFrame.timelineFrame = 90;
  m.state.activeSelection = {
    sourceType: "shot", sourceId: "s3", stableShotId: "s3", storyId: 7,
    shotNo: 3, selectedText: "Forest", fullText: "Forest",
  };
  m.state.setActiveSelection.mockImplementation(selection => {
    m.state.activeSelection = selection;
  });
  m.messages = [];
  m.state.setMessages.mockImplementation(fn => {
    m.messages = fn(m.messages);
  });
  m.capture.mockResolvedValue({ frames: [frame], failures: [] });
  m.inspect.mockResolvedValue({ targetSize: { width: 1280, height: 720 }, referenceSize: { width: 1024, height: 1024 }, positionConsistent: false });
  m.paletteQuote.mockResolvedValue({dimensions:{width:960,height:960},fingerprint:"a".repeat(64),estimatedCny:0.25,model:"AI region analysis + local color correction",readingProvider:"openai-next",readingProviderLabel:"OpenAI Next",readingModel:"gemini-2.5-flash"});
  m.paletteRender.mockResolvedValue({status:"ok",imageId:101,candidates:[{imageId:101,imageUrl:"/new.png"}]});
});
afterEach(() => vi.unstubAllGlobals());
function shortcut(kind: "capture" | "clear") {
  window.dispatchEvent(new CustomEvent(PAUSED_FRAME_SHORTCUT_EVENT, {
    detail: kind === "clear" ? { kind, storyId: 7 } : {
      kind, snapshot: structuredClone(m.state.pausedPreviewFrame),
    },
  }));
}
it("focuses the composer on Up without leaving the shot conversation", async () => {
  setup();
  shortcut("capture");
  expect(m.focus).toHaveBeenCalledOnce();
  expect(m.state.activeSelection?.stableShotId).toBe("s3");
  expect(m.state.setActiveSelection).not.toHaveBeenCalledWith(null);
  await vi.waitFor(() => expect(m.invalidate).toHaveBeenCalled());
});
it("sends a manually attached frame despite an older selected image and captures only once", async () => {
  const api = setup(99);
  shortcut("capture");
  m.state.pausedPreviewFrame.timelineFrame = 120;
  await api.handle("只改森林，其他保持原样");
  expect(m.capture).toHaveBeenCalledOnce();
  expect(m.capture.mock.calls[0][0].pausedFrame.timelineFrame).toBe(90);
  expect(m.propose).toHaveBeenCalledWith(frame, "只改森林，其他保持原样");
});
it("reuses the in-flight capture when sending immediately after Up", async () => {
  let finish!: (result: any) => void;
  m.capture.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const api = setup();
  shortcut("capture");
  const sent = api.handle("只改森林");
  expect(m.capture).toHaveBeenCalledOnce();
  finish({ frames: [frame], failures: [] });
  await sent;
  expect(m.propose).toHaveBeenCalledWith(frame, "只改森林");
});
it("Down cancels a pending reference without restoring it or quoting", async () => {
  let finish!: (result: any) => void;
  m.capture.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const api = setup();
  shortcut("capture");
  shortcut("clear");
  finish({ frames: [frame], failures: [] });
  await Promise.resolve();
  expect(await api.handle("这一帧颜色更细腻")).toBe("blocked");
  expect(m.capture).toHaveBeenCalledOnce();
  expect(m.propose).not.toHaveBeenCalled();
});
it("cancels a submit that is still waiting for the extracted frame", async () => {
  let finish!: (result: any) => void;
  m.capture.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const api = setup();
  shortcut("capture");
  const sent = api.handle("只改森林");
  shortcut("clear");
  finish({ frames: [frame], failures: [] });
  expect(await sent).toBe("blocked");
  expect(m.propose).not.toHaveBeenCalled();
  expect(m.messages).toEqual([]);
});
it("keeps named image targets ahead of a manual frame reference", async () => {
  const api = setup();
  shortcut("capture");
  expect(await api.handle("修改图片 #99")).toBe(false);
  expect(m.propose).not.toHaveBeenCalled();
});
it("uses the pinned frame as target and the clicked image only as a color reference", async () => {
  const api = setup(55);
  shortcut("capture");
  await api.handle("保留这一帧的森林，只参考这张图的颜色，其他保持原样");
  expect(m.paletteQuote).toHaveBeenCalledWith(expect.objectContaining({ storyId: 7, targetImageId: 100, referenceImageId: 55 }));
  expect(m.propose).not.toHaveBeenCalled();
  expect(m.capture).toHaveBeenCalledOnce();
  expect(m.messages[0].content).toContain("#55");
  expect(m.messages[0].frameReferences[0].imageId).toBe(100);
  expect(m.messages.at(-1).content).toContain("960×960");
  expect(m.messages.at(-1).content).toContain("OpenAI Next / gemini-2.5-flash");
  expect(m.paletteRender).not.toHaveBeenCalled();
  await api.handle("确认");
  await vi.waitFor(()=>expect(m.paletteRender).toHaveBeenCalledOnce());
  expect(m.paletteRender).toHaveBeenCalledWith(expect.objectContaining({targetImageId:100,referenceImageId:55,readingProvider:"openai-next",costConfirmation:{accepted:true,estimatedCny:0.25,fingerprint:"a".repeat(64)}}));
  await vi.waitFor(()=>expect(m.messages.at(-1).content).toContain("saved in Warehouse"));
});
it("cancels a palette quote without submitting a generation", async()=>{
  const api=setup(55);shortcut("capture");
  await api.handle("保留这一帧的森林，只参考这张图的颜色，其他保持原样");
  await api.handle("取消");
  expect(m.paletteRender).not.toHaveBeenCalled();
  expect(m.messages.at(-1).content).toContain("Cancelled");
});
it("edits the clicked accepted candidate using an explicit object-color reference without recapturing the playhead",async()=>{
  const api=setup(62);
  await api.handle("按物体分析，参考图片 #55 的配色，只改树冠，其他不变");
  expect(m.paletteQuote).toHaveBeenCalledWith(expect.objectContaining({targetImageId:62,referenceImageId:55}));
  expect(m.capture).not.toHaveBeenCalled();expect(m.paletteRender).not.toHaveBeenCalled();
  expect(m.messages[0].frameReferences).toBeUndefined();
  expect(m.messages[0].selectionQuote).toMatchObject({storyId:7,stableShotId:"s3"});
  expect(m.messages.at(-1).selectionQuote).toMatchObject({storyId:7,stableShotId:"s3"});
  await api.handle("确认");
  await vi.waitFor(()=>expect(m.paletteRender).toHaveBeenCalledOnce());
  expect(m.paletteRender).toHaveBeenCalledWith(expect.objectContaining({targetImageId:62,referenceImageId:55}));
});
it("does not ignore unsupported extra edits when a clicked image is referenced", async () => {
  const api = setup(55);
  shortcut("capture");
  await api.handle("参考这张图的颜色，增加一棵树");
  expect(m.inspect).not.toHaveBeenCalled();
  expect(m.propose).not.toHaveBeenCalled();
  expect(m.messages.at(-1).content).toContain("Nothing was changed");
});
it("freezes typing and voice-start references before subsequent seeks", async () => {
  const api = setup();
  api.begin();
  m.state.pausedPreviewFrame.timelineFrame = 120;
  await api.handle("这一帧颜色更细腻");
  expect(m.capture.mock.calls[0][0].pausedFrame.timelineFrame).toBe(90);
  expect(m.propose).toHaveBeenCalledWith(frame, "这一帧颜色更细腻");
  expect(m.messages[0].frameReferences).toEqual([frame]);
  expect(
    chatFrameReferenceSchema.parse(JSON.parse(JSON.stringify(frame)))
  ).toEqual(frame);
});
it("ignores normal chat and named/selected images", async () => {
  const api = setup();
  expect(await api.handle("音乐声音小一点")).toBe(false);
  expect(await api.handle("图片 #99 比这一帧更亮")).toBe(false);
  expect(await setup(99).handle("这一帧颜色更细腻")).toBe(false);
  expect(m.capture).not.toHaveBeenCalled();
  expect(usesPausedFrame("this frame needs richer colors")).toBe(true);
});
it("drops late results across account/story/reload scope", async () => {
  const d = freezePausedFrame();
  m.state.storyLoadEpoch++;
  expect(pausedDraftIsCurrent(d, 7)).toBe(false);
  m.state.storyLoadEpoch--;
  m.capture.mockImplementation(async () => {
    m.state.activeStoryId = 9;
    return { frames: [frame], failures: [] };
  });
  await setup().handle("这一帧颜色更细腻");
  expect(m.propose).not.toHaveBeenCalled();
  expect(m.messages).toEqual([]);
});
it("does not quote requests to view a frame or failed captures", async () => {
  await setup().handle("看看这一帧");
  expect(m.propose).not.toHaveBeenCalled();
  expect(m.messages.at(-1).content).toContain("Warehouse");
  m.capture.mockRejectedValue(new Error("stale revision"));
  await setup().handle("修改这一帧");
  expect(m.propose).not.toHaveBeenCalled();
  expect(m.messages.at(-1).content).toContain("stale revision");
});

it("reuses the frame inserted on the timeline without recapturing it for chat", async () => {
  const api = setup();
  const inserted = { ...frame, imageId: 211, timelineVersion: 17 };
  let finish!: (value: typeof inserted) => void;
  const extraction = new Promise<typeof inserted>(resolve => { finish = resolve; });
  window.dispatchEvent(new CustomEvent(PAUSED_FRAME_SHORTCUT_EVENT, { detail: {
    kind: "capture", snapshot: structuredClone(m.state.pausedPreviewFrame), extraction,
  }}));
  const sent = api.handle("只改云层，其他不变");
  finish(inserted);
  await sent;
  expect(m.capture).not.toHaveBeenCalled();
  expect(m.propose).toHaveBeenCalledWith(inserted, "只改云层，其他不变");
  expect(m.messages[0].frameReferences[0].imageId).toBe(211);
});

it("sends a pinned frame to local region review before paid image quoting", async () => {
  const reviewFrame = vi.fn(async () => ({ reply: "范围已标出", frameReview: { id: "saved-review" } as any }));
  const api = setup(undefined, reviewFrame);
  window.dispatchEvent(new CustomEvent(PAUSED_FRAME_SHORTCUT_EVENT, { detail: { kind: "capture", snapshot: m.state.pausedPreviewFrame, extraction: Promise.resolve(frame) } }));
  await api.handle("这一帧只定位云层范围");
  expect(reviewFrame).toHaveBeenCalledWith(frame, "这一帧只定位云层范围");
  expect(m.propose).not.toHaveBeenCalled();
  expect(m.capture).not.toHaveBeenCalled();
  expect(m.messages.at(-1)?.frameReview).toEqual({ id: "saved-review" });
});

it("asks once after a shared capture, then reuses that exact review for the combined request", async () => {
  const review = { id: "new-frame-review" } as any;
  const reviewFrame = vi.fn(async () => ({ reply: "Edit this forest too?", frameReview: review }));
  const api = setup(undefined, reviewFrame);
  const extraction = Promise.resolve(frame);
  const detail = { kind: "capture", snapshot: m.state.pausedPreviewFrame, extraction };
  window.dispatchEvent(new CustomEvent(PAUSED_FRAME_SHORTCUT_EVENT, { detail }));
  window.dispatchEvent(new CustomEvent(PAUSED_FRAME_SHORTCUT_EVENT, { detail }));
  await vi.waitFor(() => expect(m.messages).toHaveLength(1));
  expect(reviewFrame).toHaveBeenCalledOnce();
  expect(reviewFrame).toHaveBeenCalledWith(frame, "Review this frame", { inspectOnly: true });
  expect(m.messages[0].frameReferences).toEqual([frame]);
  await api.handle("森林和云一起改，森林绿色，云更大更厚");
  expect(reviewFrame).toHaveBeenLastCalledWith(frame, "森林和云一起改，森林绿色，云更大更厚", { review });
  expect(m.capture).not.toHaveBeenCalled();
  expect(m.propose).not.toHaveBeenCalled();
});

it.each(["clear", "story", "frame"])("drops a late automatic question after changing %s", async change => {
  let finish!: (value: any) => void;
  const reviewFrame = vi.fn(() => new Promise<any>(resolve => { finish = resolve; }));
  setup(undefined, reviewFrame);
  shortcut("capture");
  await vi.waitFor(() => expect(reviewFrame).toHaveBeenCalledOnce());
  if (change === "clear") shortcut("clear");
  if (change === "story") m.state.activeStoryId = 8;
  if (change === "frame") {
    m.capture.mockReturnValue(new Promise(() => {}));
    shortcut("capture");
  }
  finish({ reply: "Old frame question", frameReview: { id: "old" } });
  await Promise.resolve();
  await Promise.resolve();
  expect(m.messages).toEqual([]);
});

it("accepts a request while inspection is pending without appending a stale question afterwards", async () => {
  let finish!: (value: any) => void;
  const review = { id: "new" } as any;
  const reviewFrame = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ reply: "Combined regions", frameReview: review });
  const api = setup(undefined, reviewFrame);
  shortcut("capture");
  await vi.waitFor(() => expect(reviewFrame).toHaveBeenCalledOnce());
  const pending = api.handle("森林和云一起改");
  finish({ reply: "Edit the forest?", frameReview: review });
  await pending;
  expect(reviewFrame).toHaveBeenLastCalledWith(frame, "森林和云一起改", { review });
  expect(m.messages.map(message => message.content)).toEqual(["森林和云一起改", "Combined regions"]);
});

it("replaces a concurrently recovered review instead of duplicating its question", async () => {
  const review = { id: "saved", revision: 0 } as any;
  const reviewFrame = vi.fn(async () => {
    m.messages.push({ id: "recovery", role: "assistant", content: "Restored", timestamp: 1, frameReview: review });
    return { reply: "Edit this forest too?", frameReview: review };
  });
  setup(undefined, reviewFrame);
  shortcut("capture");
  await vi.waitFor(() => expect(reviewFrame).toHaveBeenCalledOnce());
  expect(m.messages).toHaveLength(1);
  expect(m.messages[0]).toMatchObject({ id: "recovery", content: "Edit this forest too?" });
});


it("reuses a warehouse source frame instead of capturing the live timeline", async () => {
  const api = setup();
  const sourceFrame = { ...frame, takeId: 11, origin: "warehouse-video" as const, timelineFrame: undefined, timelineVersion: undefined, sourceTimeSec: 2.375, shotTimeSec: 2.375 };
  window.dispatchEvent(new CustomEvent(PAUSED_FRAME_SHORTCUT_EVENT, {detail:{kind:"warehouse",source:{storyId:7,takeId:11,sourceTimeSec:2.375},extraction:Promise.resolve(sourceFrame)}}));
  m.state.pausedPreviewFrame.timelineFrame = 900;
  await api.handle("只改森林");
  expect(m.capture).not.toHaveBeenCalled();
  expect(m.propose).toHaveBeenCalledWith(sourceFrame, "只改森林");
  expect(m.messages[0].frameReferences[0].takeId).toBe(11);
  expect(chatFrameReferenceSchema.parse(JSON.parse(JSON.stringify(sourceFrame))).timelineFrame).toBeUndefined();
});
it("does not deliver an old warehouse capture after another frame is attached", async () => {
  const review = vi.fn(async () => ({reply:"source inspected"}));
  setup(undefined, review);
  let finish!: (frame: any) => void;
  const source = {storyId:7,takeId:11,sourceTimeSec:2.375};
  window.dispatchEvent(new CustomEvent(PAUSED_FRAME_SHORTCUT_EVENT, {detail:{kind:"warehouse",source,extraction:new Promise(resolve => {finish=resolve;})}}));
  shortcut("capture");
  finish({...frame, origin:"warehouse-video", takeId:11});
  await vi.waitFor(() => expect(review).toHaveBeenCalledOnce());
  expect(review).toHaveBeenCalledWith(expect.objectContaining({takeId:10}), expect.any(String), {inspectOnly:true});
});
