import { describe, expect, it } from "vitest";
import type { VisualObjectClipboardSnapshot } from "@shared/visualObjectClipboard";
import { createVisualObjectClipboardSession } from "./visualObjectClipboard";

const snapshot: VisualObjectClipboardSnapshot = Object.freeze({
  version: 1,
  kind: "image-clip",
  sourceStoryId: 7,
  sourceClipId: "image-a",
  sourceLayer: 2,
  imageId: 91,
  imageUrl: "/91.png",
  label: "抽帧",
  durationFrames: 1,
  transform: null,
});

describe("visual object clipboard session", () => {
  it("keeps a value snapshot while selection and playhead state change elsewhere", () => {
    const clipboard = createVisualObjectClipboardSession({
      storyId: 7,
    });
    expect(clipboard.write(snapshot)).toBe(true);
    expect(clipboard.read()).toEqual(snapshot);
    expect(clipboard.read()).not.toBe(snapshot);
  });

  it("does not share values with a replacement Story/session clipboard", () => {
    const original = createVisualObjectClipboardSession({
      storyId: 7,
    });
    original.write(snapshot);

    const switchedStory = createVisualObjectClipboardSession({
      storyId: 8,
    });
    const replacedSession = createVisualObjectClipboardSession({
      storyId: 7,
    });

    expect(switchedStory.read()).toBeNull();
    expect(replacedSession.read()).toBeNull();
  });

  it("refuses cross-Story snapshots and clears permanently on dispose", () => {
    const clipboard = createVisualObjectClipboardSession({
      storyId: 8,
    });
    expect(clipboard.write(snapshot)).toBe(false);
    clipboard.dispose();
    expect(clipboard.read()).toBeNull();
    expect(clipboard.write(snapshot)).toBe(false);
  });
});
