import { describe, expect, it } from "vitest";
import {
  frameCandidateSheetIds,
  latestFrameCandidateSheet,
} from "./frameCandidate";

describe("latestFrameCandidateSheet", () => {
  it("finds the four-up parent referenced by the current prompt run", () => {
    const candidate = latestFrameCandidateSheet(
      [
        {
          id: 41,
          imageUrl: "/api/images/older-grid.png",
          generationType: "initial",
          parentImageId: null,
        },
        {
          id: 42,
          imageUrl: "/api/images/latest-grid.png",
          prompt: "Single-frame rule: one cinematic frame only.",
          generationType: "initial",
          parentImageId: null,
          candidateLayout: "four-up-sheet",
        },
        {
          id: 43,
          imageUrl: "/api/images/selected-crop.png",
          generationType: "initial",
          parentImageId: 42,
        },
      ],
      42
    );

    expect(candidate).toEqual({
      imageId: 42,
      imageUrl: "/api/images/latest-grid.png",
      label: "候选版本 V1",
    });
  });

  it("does not split draft or cropped single-frame images into quadrants", () => {
    expect(
      latestFrameCandidateSheet(
        [
          {
            id: 44,
            imageUrl: "/api/images/draft.png",
            generationType: "generate",
            parentImageId: null,
          },
          {
            id: 45,
            imageUrl: "/api/images/crop.png",
            generationType: "initial",
            parentImageId: 40,
          },
        ],
        40
      )
    ).toBeNull();
  });

  it("does not split an imported full-frame image without a matching prompt run", () => {
    expect(
      latestFrameCandidateSheet([
        {
          id: 46,
          imageUrl: "/api/images/imported-full-frame.webp",
          generationType: "initial",
          parentImageId: null,
        },
      ])
    ).toBeNull();
  });

  it("splits the current storyboard-reference MJ render into four quadrants", () => {
    expect(
      latestFrameCandidateSheet(
        [
          {
            id: 48,
            imageUrl: "/api/images/story-reference-render.png",
            prompt:
              "SUPPLIED STORYBOARD FRAMES ARE THE VISUAL SOURCE OF TRUTH — HIGHEST PRIORITY:",
            generationType: "inpaint",
            parentImageId: null,
            candidateLayout: "four-up-sheet",
          },
        ],
        48
      )
    ).toEqual({
      imageId: 48,
      imageUrl: "/api/images/story-reference-render.png",
      label: "候选版本 V1",
    });
  });

  it("does not infer an older storyboard-reference image is a candidate sheet", () => {
    expect(
      latestFrameCandidateSheet([
        {
          id: 49,
          imageUrl: "/api/images/story-reference-render.png",
          prompt:
            "SUPPLIED STORYBOARD FRAMES ARE THE VISUAL SOURCE OF TRUTH — HIGHEST PRIORITY:",
          generationType: "inpaint",
          parentImageId: null,
        },
      ])
    ).toBeNull();
  });

  it("recognizes a newly assigned storyboard-reference MJ sheet when lineage mode omitted promptRun", () => {
    expect(
      latestFrameCandidateSheet([
        {
          id: 50,
          imageUrl: "/api/images/story-reference-grid.png",
          prompt:
            "SUPPLIED STORYBOARD FRAMES ARE THE VISUAL SOURCE OF TRUTH — HIGHEST PRIORITY:\nUSER DIRECT EDIT INSTRUCTION — HIGHEST PRIORITY:\n图片要求（最高优先级）：夜市中景",
          generationType: "inpaint",
          parentImageId: null,
          candidateLayout: "four-up-sheet",
        },
      ])
    ).toEqual({
      imageId: 50,
      imageUrl: "/api/images/story-reference-grid.png",
      label: "候选版本 V1",
    });
  });

  it("does not split an exact single-frame edit into quadrants", () => {
    expect(
      latestFrameCandidateSheet([
        {
          id: 51,
          imageUrl: "/api/images/exact-edit.png",
          prompt:
            "SUPPLIED STORYBOARD FRAMES ARE THE VISUAL SOURCE OF TRUTH — HIGHEST PRIORITY:\n本次对话修改（最高优先级，必须实际应用）：延长裙摆",
          generationType: "inpaint",
          parentImageId: null,
        },
      ])
    ).toBeNull();
  });

  it("does not split the single-image fallback result into quadrants", () => {
    expect(
      latestFrameCandidateSheet([
        {
          id: 53,
          imageUrl: "/api/images/reference-edit.png",
          prompt:
            "SUPPLIED STORYBOARD FRAMES ARE THE VISUAL SOURCE OF TRUTH — HIGHEST PRIORITY:\n图片要求（最高优先级）：夜市中景\n单帧参考编辑保护：只生成一张完整的电影静帧",
          generationType: "inpaint",
          parentImageId: null,
        },
      ])
    ).toBeNull();
  });

  it("recognizes a generated candidate sheet when the prompt run was not persisted", () => {
    expect(
      latestFrameCandidateSheet([
        {
          id: 47,
          imageUrl: "/api/images/generated-grid.png",
          prompt:
            "USER DIRECT EDIT INSTRUCTION — HIGHEST PRIORITY:\nSingle-frame rule: one frame.",
          generationType: "initial",
          parentImageId: null,
          candidateLayout: "four-up-sheet",
        },
      ])
    ).toEqual({
      imageId: 47,
      imageUrl: "/api/images/generated-grid.png",
      label: "候选版本 V1",
    });
  });

  it("recognizes legacy final MJ sheets stored as generationType generate", () => {
    expect(
      latestFrameCandidateSheet([
        {
          id: 52,
          imageUrl: "/api/images/legacy-final-grid.png",
          prompt:
            "Rerender only SH05. Create exactly one single cinematic still frame.",
          generationType: "generate",
          parentImageId: null,
          candidateLayout: "four-up-sheet",
        },
      ])
    ).toEqual({
      imageId: 52,
      imageUrl: "/api/images/legacy-final-grid.png",
      label: "候选版本 V1",
    });
  });

  it("does not split four individually stored provider candidates into quadrants", () => {
    const images = [54, 55, 56, 57].map(id => ({
      id,
      imageUrl: `/api/images/provider-candidate-${id}.png`,
      prompt:
        "USER DIRECT EDIT INSTRUCTION — HIGHEST PRIORITY:\nSingle-frame rule: one frame.",
      promptCompilationId: 901,
      generationType: "initial" as const,
      parentImageId: null,
    }));

    expect(frameCandidateSheetIds(images, 54)).toEqual(new Set());
  });

  it("does not split one complete prompt-run image without an explicit sheet layout", () => {
    expect(
      frameCandidateSheetIds(
        [
          {
            id: 58,
            imageUrl: "/api/images/complete-frame.png",
            prompt:
              "USER DIRECT EDIT INSTRUCTION — HIGHEST PRIORITY:\nSingle-frame rule: one frame.",
            promptCompilationId: 902,
            generationType: "initial",
            parentImageId: null,
          },
        ],
        58
      )
    ).toEqual(new Set());
  });
});
