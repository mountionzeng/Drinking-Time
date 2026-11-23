import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { PAUSED_FRAME_SHORTCUT_EVENT, type FrameReferenceEvent } from "@/features/creationEditor/frameNavigation";
import { useReviewVideoFrame } from "./ReviewFrameVideo";

const effects = vi.hoisted(() => [] as Array<() => () => void>);
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useLayoutEffect: (effect: () => () => void) => effects.push(effect),
}));
vi.mock("@/features/uiLanguage/UiLanguage", () => ({ useUiLanguage: () => ({ language: "en" }) }));
vi.mock("sonner", () => ({ toast: { info: vi.fn() } }));

afterEach(() => { vi.unstubAllGlobals(); effects.length = 0; });

it("uses the presented frame during playback and clears a stale timestamp on seek", () => {
  const events = new EventTarget();
  vi.stubGlobal("window", events);
  const refs: FrameReferenceEvent[] = [];
  events.addEventListener(PAUSED_FRAME_SHORTCUT_EVENT, event => refs.push((event as CustomEvent<FrameReferenceEvent>).detail));
  let tick: VideoFrameRequestCallback;
  const video = Object.assign(new EventTarget(), {
    seeking:false, readyState:3, currentTime:2.9, pause:vi.fn(),
    requestVideoFrameCallback:(callback:VideoFrameRequestCallback) => { tick=callback; return 3; },
    cancelVideoFrameCallback:vi.fn(),
  });
  let attach!: ReturnType<typeof useReviewVideoFrame>;
  function Host() {
    attach = useReviewVideoFrame({current:video as unknown as HTMLVideoElement}, "preview.mp4");
    return null;
  }
  renderToStaticMarkup(<Host />);
  const cleanup = effects[0]();
  tick!(0, {mediaTime:2.875} as VideoFrameCallbackMetadata);
  attach(7,10);
  expect(refs[0]).toMatchObject({kind:"warehouse",source:{storyId:7,takeId:10,sourceTimeSec:2.875}});
  video.seeking=true;
  video.dispatchEvent(new Event("seeking"));
  attach(7,10);
  expect(refs).toHaveLength(1);
  video.seeking=false;
  video.currentTime=4;
  const snapshot = {storyId:7,timelineVersion:16,timelineFrame:150,hiddenVisualLayers:[2],width:1080,height:1080};
  attach(7,10,()=>snapshot);
  expect(refs[1]).toMatchObject({kind:"capture",editKeyframe:true,snapshot:{...snapshot,displayedVideo:{takeId:10,sourceTimeSec:4}}});
  cleanup();
  expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(3);
});
