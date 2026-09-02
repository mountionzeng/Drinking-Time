import { describe, expect, it } from "vitest";
import {
  selectionContentFingerprint,
  type SelectionContext,
} from "@shared/selectionContext";
import { routeSelectionSubmission } from "./selectionSubmissionRouter";

const text = "今天下雨。我们去了公园。晚上回家。";
const start = text.indexOf("我们去了公园");
const textSelection: SelectionContext = {
  sourceType: "card",
  sourceId: "card-1",
  selectedText: "我们去了公园",
  fullText: text,
  storyId: 9,
  contentFingerprint: selectionContentFingerprint(text),
  selection: { kind: "text", start, end: start + "我们去了公园".length },
};

describe("selection submission router", () => {
  it("uses ordinary chat when no explicit selection exists", () => {
    expect(
      routeSelectionSubmission({
        selection: null,
        activeStoryId: 9,
        pendingMediaCount: 0,
      })
    ).toEqual({ kind: "ordinary-chat" });
  });

  it("routes each executable selection to exactly one executor", () => {
    expect(
      routeSelectionSubmission({
        selection: textSelection,
        activeStoryId: 9,
        pendingMediaCount: 0,
      })
    ).toMatchObject({ kind: "text-edit" });

    const image: SelectionContext = {
      sourceType: "storyboard-image",
      sourceId: "44",
      selectedText: "第二张图",
      fullText: "镜头 0101",
      storyId: 9,
      stableShotId: "shot-1",
      imageId: 44,
      objectVersion: "image:44",
    };
    expect(
      routeSelectionSubmission({
        selection: image,
        activeStoryId: 9,
        pendingMediaCount: 0,
      })
    ).toMatchObject({ kind: "image-edit" });

    const region: SelectionContext = {
      ...image,
      selection: { kind: "rect", x: 0, y: 0, width: 0.2, height: 0.2 },
      confirmedImageRegion: {
        maskKey: "masks/1/9/44/hat-edit.png",
        imageId: 44,
        width: 100,
        height: 100,
        confirmed: true,
      },
    };
    expect(
      routeSelectionSubmission({
        selection: region,
        activeStoryId: 9,
        pendingMediaCount: 0,
      })
    ).toMatchObject({ kind: "image-region-edit" });
  });

  it("blocks stale and read-only selections without an executor payload", () => {
    expect(
      routeSelectionSubmission({
        selection: textSelection,
        activeStoryId: 10,
        pendingMediaCount: 0,
      })
    ).toEqual({
      kind: "blocked",
      reason: "选区不属于当前故事",
      clearSelection: true,
    });
    expect(
      routeSelectionSubmission({
        selection: { ...textSelection, sourceType: "chat" },
        activeStoryId: 9,
        pendingMediaCount: 0,
      })
    ).toMatchObject({ kind: "blocked", clearSelection: false });
  });

  it("rejects selection plus unrelated attachments instead of batching", () => {
    expect(
      routeSelectionSubmission({
        selection: textSelection,
        activeStoryId: 9,
        pendingMediaCount: 1,
      })
    ).toMatchObject({ kind: "blocked", clearSelection: false });
  });
});
