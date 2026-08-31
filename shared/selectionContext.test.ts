import { describe, expect, it } from "vitest";
import {
  inferSelectionMaterialStatus,
  selectionContentFingerprint,
  selectionIdentity,
  selectionReadiness,
  type SelectionContext,
} from "./selectionContext";

describe("selection material status", () => {
  it("keeps explicit material status when provided", () => {
    expect(
      inferSelectionMaterialStatus({
        sourceType: "animatic-video",
        videoTakeId: 2,
        materialStatus: "failed-video",
      })
    ).toBe("failed-video");
  });

  it("infers timeline ranges before generic video/image context", () => {
    expect(
      inferSelectionMaterialStatus({
        sourceType: "timeline-range",
        videoTakeId: 2,
        rangeId: 7,
      })
    ).toBe("timeline-range");
  });

  it("infers current image for storyboard image selections", () => {
    expect(
      inferSelectionMaterialStatus({
        sourceType: "storyboard-image",
        imageId: 9,
      })
    ).toBe("current-image");
  });
});

describe("selection edit contract", () => {
  const text = "今天下雨。我们去了公园。晚上回家。";
  const start = text.indexOf("我们去了公园");
  const exactTextSelection: SelectionContext = {
    sourceType: "shot",
    sourceId: "shot-a:dialogue",
    selectedText: "我们去了公园",
    fullText: text,
    storyId: 7,
    stableShotId: "shot-a",
    objectVersion: "story:4",
    contentFingerprint: selectionContentFingerprint(text),
    selection: { kind: "text", start, end: start + "我们去了公园".length },
  };

  it("accepts an exact owned text range", () => {
    expect(selectionReadiness(exactTextSelection, 7)).toEqual({
      status: "executable",
      kind: "text",
    });
  });

  it("fails closed when text boundaries or content drift", () => {
    expect(
      selectionReadiness({ ...exactTextSelection, selectedText: "去了公园" }, 7)
    ).toMatchObject({ status: "stale" });
    expect(
      selectionReadiness(
        { ...exactTextSelection, contentFingerprint: "fnv1a:stale:0" },
        7
      )
    ).toMatchObject({ status: "stale" });
  });

  it("keeps historical chat text read-only", () => {
    expect(
      selectionReadiness(
        { ...exactTextSelection, sourceType: "chat", sourceId: "message-1" },
        7
      )
    ).toMatchObject({ status: "read-only", kind: "text" });
  });

  it("requires a confirmed semantic mask for image regions", () => {
    const imageRegion: SelectionContext = {
      sourceType: "storyboard-image",
      sourceId: "41",
      selectedText: "帽子区域",
      fullText: "镜头 0101",
      storyId: 7,
      stableShotId: "shot-a",
      imageId: 41,
      objectVersion: "image:41",
      selection: { kind: "rect", x: 0.1, y: 0.1, width: 0.3, height: 0.2 },
    };
    expect(selectionReadiness(imageRegion, 7)).toMatchObject({
      status: "invalid",
      kind: "image-region",
    });
    expect(
      selectionReadiness(
        {
          ...imageRegion,
          confirmedImageRegion: {
            maskKey: "masks/1/7/41/hat-edit.png",
            imageId: 41,
            width: 1024,
            height: 1024,
            confirmed: true,
          },
        },
        7
      )
    ).toEqual({ status: "executable", kind: "image-region" });
    expect(
      selectionReadiness(
        {
          ...imageRegion,
          confirmedImageRegion: {
            maskKey: "masks/1/7/41/empty.png",
            imageId: 41,
            width: 0,
            height: 1024,
            confirmed: true,
          },
        },
        7
      )
    ).toMatchObject({ status: "invalid", kind: "image-region" });
  });

  it("uses exact range and mask identity in the selection identity", () => {
    const moved = {
      ...exactTextSelection,
      selection: { kind: "text" as const, start: start + 1, end: start + 2 },
    };
    expect(selectionIdentity(moved)).not.toBe(
      selectionIdentity(exactTextSelection)
    );
  });
});
