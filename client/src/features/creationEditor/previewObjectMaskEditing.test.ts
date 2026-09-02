import { describe, expect, it } from "vitest";

import {
  completePreviewMaskExtraction,
  confirmedPreviewMaskSelection,
  createPreviewMaskRequestFence,
  INITIAL_PREVIEW_OBJECT_MASK_STATE,
  previewMaskSelectionMatchesSession,
  previewMaskTargetChanged,
  previewObjectMaskReducer,
  resetPreviewMaskSessionForTargetChange,
} from "./previewObjectMaskEditing";

it("keeps Preview idle when the target disappears during deferred frame extraction", async () => {
  const fence = createPreviewMaskRequestFence();
  const token = fence.begin();
  let resolveExtraction!: (value: { imageId: number }) => void;
  const extraction = new Promise<{ imageId: number }>(resolve => {
    resolveExtraction = resolve;
  });
  let state = previewObjectMaskReducer(INITIAL_PREVIEW_OBJECT_MASK_STATE, {
    type: "extracting",
  });
  const completion = completePreviewMaskExtraction({
    fence,
    token,
    extract: () => extraction,
    onStart: () => {
      state = previewObjectMaskReducer(state, { type: "start", target });
    },
    onError: error => {
      state = previewObjectMaskReducer(state, {
        type: "error",
        message: error instanceof Error ? error.message : "extraction failed",
      });
    },
  });

  expect(
    resetPreviewMaskSessionForTargetChange({
      sessionTarget: target,
      visibleTarget: null,
      reset: () => {
        fence.invalidate();
        state = previewObjectMaskReducer(state, { type: "reset" });
      },
    })
  ).toBe(true);
  resolveExtraction({ imageId: 7 });
  await completion;

  expect(state.phase).toBe("idle");
  expect(state.target).toBeNull();
  expect(state.error).toBeNull();
});

const target = {
  stableShotId: "shot-1",
  shotNo: 1,
  imageId: 7,
  imageUrl: "/7.png",
  label: "图片",
  transform: {} as any,
  textOverlay: null,
  defaultText: "",
};

describe("previewObjectMaskReducer", () => {
  it("publishes an image-scoped confirmed semantic mask selection", () => {
    const mask = {
      maskKey: "users/1/stories/9/images/7/mask.png",
      maskUrl: "/mask.png",
      previewMaskUrl: "/mask-preview.png",
      width: 1280,
      height: 720,
    };
    const selection = confirmedPreviewMaskSelection({
      storyId: 9,
      target,
      mask,
    });

    expect(selection).toMatchObject({
      sourceType: "storyboard-image",
      storyId: 9,
      stableShotId: "shot-1",
      imageId: 7,
      objectVersion: "image:7",
      confirmedImageRegion: {
        maskKey: mask.maskKey,
        imageId: 7,
        width: 1280,
        height: 720,
        confirmed: true,
      },
    });
  });

  it("hands chat instructions only to the exact still-confirmed mask session", () => {
    const mask = {
      maskKey: "users/1/stories/9/images/7/mask.png",
      maskUrl: "/mask.png",
      previewMaskUrl: "/mask-preview.png",
      width: 1280,
      height: 720,
    };
    let state = previewObjectMaskReducer(INITIAL_PREVIEW_OBJECT_MASK_STATE, {
      type: "start",
      target,
    });
    state = previewObjectMaskReducer(state, {
      type: "mask",
      requestId: state.requestId,
      mask,
    });
    state = previewObjectMaskReducer(state, { type: "confirm-mask" });
    const selection = confirmedPreviewMaskSelection({
      storyId: 9,
      target,
      mask,
    });

    expect(
      previewMaskSelectionMatchesSession({ selection, storyId: 9, state })
    ).toBe(true);
    expect(
      previewMaskSelectionMatchesSession({
        selection: {
          ...selection,
          confirmedImageRegion: {
            ...selection.confirmedImageRegion!,
            maskKey: "another-mask.png",
          },
        },
        storyId: 9,
        state,
      })
    ).toBe(false);
    expect(
      previewMaskSelectionMatchesSession({
        selection,
        storyId: 10,
        state,
      })
    ).toBe(false);
    expect(
      previewMaskSelectionMatchesSession({
        selection,
        storyId: 9,
        state: previewObjectMaskReducer(state, { type: "reselect" }),
      })
    ).toBe(false);
  });

  it("invalidates a session when the visible target disappears", () => {
    expect(previewMaskTargetChanged(target, null)).toBe(true);
    expect(previewMaskTargetChanged(target, { ...target })).toBe(false);
  });
  it("ignores a stale segmentation response after a re-click", () => {
    let state = previewObjectMaskReducer(INITIAL_PREVIEW_OBJECT_MASK_STATE, {
      type: "start",
      target,
    });
    state = previewObjectMaskReducer(state, { type: "segment", requestId: 1 });
    state = previewObjectMaskReducer(state, { type: "reselect" });
    state = previewObjectMaskReducer(state, {
      type: "mask",
      requestId: 1,
      mask: {
        maskKey: "old",
        maskUrl: "old",
        previewMaskUrl: "old",
        width: 1,
        height: 1,
      },
    });
    expect(state.mask).toBeNull();
    expect(state.phase).toBe("selecting");
  });

  it("requires an explicit mask confirmation state before generation", () => {
    let state = previewObjectMaskReducer(INITIAL_PREVIEW_OBJECT_MASK_STATE, {
      type: "start",
      target,
    });
    state = previewObjectMaskReducer(state, { type: "segment", requestId: 1 });
    state = previewObjectMaskReducer(state, {
      type: "mask",
      requestId: 1,
      mask: {
        maskKey: "m",
        maskUrl: "m",
        previewMaskUrl: "p",
        width: 10,
        height: 10,
      },
    });
    expect(state.maskConfirmed).toBe(false);
    state = previewObjectMaskReducer(state, { type: "confirm-mask" });
    expect(state.maskConfirmed).toBe(true);
  });

  it("ignores a paid candidate that arrives after the session was reset", () => {
    let state = previewObjectMaskReducer(INITIAL_PREVIEW_OBJECT_MASK_STATE, {
      type: "start",
      target,
    });
    state = previewObjectMaskReducer(state, {
      type: "generate",
      requestId: state.requestId + 1,
    });
    const paidRequestId = state.requestId;
    state = previewObjectMaskReducer(state, { type: "reset" });
    state = previewObjectMaskReducer(state, {
      type: "candidate",
      requestId: paidRequestId,
      candidate: { imageId: 9, imageUrl: "/9.png" },
    });
    expect(state.phase).toBe("idle");
    expect(state.candidate).toBeNull();
  });

  it("restores a persisted candidate only for the active target session", () => {
    let state = previewObjectMaskReducer(INITIAL_PREVIEW_OBJECT_MASK_STATE, {
      type: "start",
      target,
    });
    state = previewObjectMaskReducer(state, {
      type: "restore-candidate",
      target,
      candidate: { imageId: 11, imageUrl: "/11.png" },
    });
    expect(state).toMatchObject({
      phase: "candidate-ready",
      target,
      candidate: { imageId: 11 },
    });

    state = previewObjectMaskReducer(state, { type: "reset" });
    state = previewObjectMaskReducer(state, {
      type: "restore-candidate",
      target,
      candidate: { imageId: 12, imageUrl: "/12.png" },
    });
    expect(state.phase).toBe("idle");
    expect(state.candidate).toBeNull();
  });
});
