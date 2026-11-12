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
function setup(selectedImageId?: number) {
  let api!: ReturnType<typeof usePausedFrameChat>;
  function Host() {
    api = usePausedFrameChat({
      storyId: 7,
      enabled: true,
      text: "这一帧颜色更细腻",
      selectedImageId,
      proposeFrame: m.propose,
      focusComposer: m.focus,
    });
    return null;
  }
  renderToStaticMarkup(<Host />);
  m.effects.splice(0).forEach(effect => effect());
  return api;
}
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
