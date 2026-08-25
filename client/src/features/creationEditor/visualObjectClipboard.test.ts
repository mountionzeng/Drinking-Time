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
      editorSessionEpoch: "session-a",
    });
    expect(clipboard.write(snapshot)).toBe(true);
    expect(clipboard.read()).toEqual(snapshot);
    expect(clipboard.read()).not.toBe(snapshot);
  });

  it("clears on Story switch or editor session replacement", () => {
    const clipboard = createVisualObjectClipboardSession({
      storyId: 7,
      editorSessionEpoch: "session-a",
    });
    clipboard.write(snapshot);
    clipboard.updateContext({ storyId: 8, editorSessionEpoch: "session-a" });
    expect(clipboard.read()).toBeNull();

    clipboard.updateContext({ storyId: 7, editorSessionEpoch: "session-a" });
    clipboard.write(snapshot);
    clipboard.updateContext({ storyId: 7, editorSessionEpoch: "session-b" });
    expect(clipboard.read()).toBeNull();
  });

  it("refuses cross-Story snapshots and clears permanently on dispose", () => {
    const clipboard = createVisualObjectClipboardSession({
      storyId: 8,
      editorSessionEpoch: "session-a",
    });
    expect(clipboard.write(snapshot)).toBe(false);
    clipboard.updateContext({ storyId: 7, editorSessionEpoch: "session-a" });
    expect(clipboard.write(snapshot)).toBe(true);
    clipboard.dispose();
    expect(clipboard.read()).toBeNull();
    expect(clipboard.write(snapshot)).toBe(false);
  });
});
