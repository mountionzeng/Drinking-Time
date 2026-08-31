import { describe, expect, it } from "vitest";
import {
  selectionContentFingerprint,
  type SelectionContext,
} from "@shared/selectionContext";
import {
  confirmedPreviewMaskSelection,
  previewMaskSelectionMatchesSession,
  previewObjectMaskReducer,
  INITIAL_PREVIEW_OBJECT_MASK_STATE,
} from "@/features/creationEditor/previewObjectMaskEditing";
import { consumeSubmittedSelection } from "./selectionLifecycle";
import { routeSelectionSubmission } from "./selectionSubmissionRouter";

const imageTarget = {
  stableShotId: "shot-a",
  shotNo: 1,
  imageId: 44,
  imageUrl: "/44.png",
  label: "0101 · 图片 #44",
  transform: {} as any,
  textOverlay: null,
  defaultText: "",
};

describe("selection-scoped chat editing acceptance matrix", () => {
  it("routes no selection to ordinary chat without inventing an edit target", () => {
    expect(
      routeSelectionSubmission({
        selection: null,
        activeStoryId: 7,
        pendingMediaCount: 0,
      })
    ).toEqual({ kind: "ordinary-chat" });
  });

  it("routes an exact text range and protects a newer selection from late completion", () => {
    const fullText = "今天下雨。我们去了公园。晚上回家。";
    const selectedText = "我们去了公园";
    const start = fullText.indexOf(selectedText);
    const textSelection: SelectionContext = {
      sourceType: "card",
      sourceId: "card-a",
      selectedText,
      fullText,
      storyId: 7,
      contentFingerprint: selectionContentFingerprint(fullText),
      selection: { kind: "text", start, end: start + selectedText.length },
    };
    const newerImageSelection: SelectionContext = {
      sourceType: "storyboard-image",
      sourceId: "44",
      selectedText: "图片 #44",
      fullText: "图片 #44",
      storyId: 7,
      stableShotId: "shot-a",
      shotNo: 1,
      imageId: 44,
      objectVersion: "image:44",
    };

    expect(
      routeSelectionSubmission({
        selection: textSelection,
        activeStoryId: 7,
        pendingMediaCount: 0,
      }).kind
    ).toBe("text-edit");
    expect(consumeSubmittedSelection(newerImageSelection, textSelection)).toBe(
      newerImageSelection
    );
  });

  it("keeps whole-image and confirmed-mask routes distinct", () => {
    const wholeImage: SelectionContext = {
      sourceType: "storyboard-image",
      sourceId: "44",
      selectedText: "图片 #44",
      fullText: "图片 #44",
      storyId: 7,
      stableShotId: "shot-a",
      shotNo: 1,
      imageId: 44,
      objectVersion: "image:44",
    };
    const mask = {
      maskKey: "users/1/stories/7/images/44/hat.png",
      maskUrl: "/hat.png",
      previewMaskUrl: "/hat-preview.png",
      width: 1280,
      height: 720,
    };
    const region = confirmedPreviewMaskSelection({
      storyId: 7,
      target: imageTarget,
      mask,
    });
    let maskState = previewObjectMaskReducer(
      INITIAL_PREVIEW_OBJECT_MASK_STATE,
      { type: "start", target: imageTarget }
    );
    maskState = previewObjectMaskReducer(maskState, {
      type: "mask",
      requestId: maskState.requestId,
      mask,
    });
    maskState = previewObjectMaskReducer(maskState, { type: "confirm-mask" });

    expect(
      routeSelectionSubmission({
        selection: wholeImage,
        activeStoryId: 7,
        pendingMediaCount: 0,
      }).kind
    ).toBe("image-edit");
    expect(
      routeSelectionSubmission({
        selection: region,
        activeStoryId: 7,
        pendingMediaCount: 0,
      }).kind
    ).toBe("image-region-edit");
    expect(
      previewMaskSelectionMatchesSession({
        selection: region,
        storyId: 7,
        state: maskState,
      })
    ).toBe(true);
    expect(
      previewMaskSelectionMatchesSession({
        selection: { ...region, imageId: 45 },
        storyId: 7,
        state: maskState,
      })
    ).toBe(false);
  });

  it("blocks stale, unconfirmed-region, and selection-plus-attachment submissions", () => {
    const rawRegion: SelectionContext = {
      sourceType: "storyboard-image",
      sourceId: "44",
      selectedText: "图片局部",
      fullText: "图片局部",
      storyId: 7,
      stableShotId: "shot-a",
      imageId: 44,
      objectVersion: "image:44",
      selection: { kind: "rect", x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
    };
    expect(
      routeSelectionSubmission({
        selection: rawRegion,
        activeStoryId: 7,
        pendingMediaCount: 0,
      }).kind
    ).toBe("blocked");
    expect(
      routeSelectionSubmission({
        selection: { ...rawRegion, storyId: 8 },
        activeStoryId: 7,
        pendingMediaCount: 0,
      })
    ).toMatchObject({ kind: "blocked", clearSelection: true });
    expect(
      routeSelectionSubmission({
        selection: { ...rawRegion, selection: null },
        activeStoryId: 7,
        pendingMediaCount: 1,
      })
    ).toMatchObject({ kind: "blocked", clearSelection: false });
  });
});
