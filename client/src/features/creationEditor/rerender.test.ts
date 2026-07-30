import { describe, expect, it, vi } from "vitest";
import type { CreationEditorShot } from "./CreationEditorContext";
import {
  buildRerenderPrompt,
  createGenerateForMobileInput,
  readableRerenderError,
  rerenderShotImage,
  rerenderShotImageCandidates,
} from "./rerender";
import type { PromptRow } from "./promptTable/types";

const shot: CreationEditorShot = {
  shotNo: 2,
  shotKey: "SH02",
  subject: "女孩",
  action: "",
  dialogue: "等一等",
  shotType: "",
  beat: "",
  cameraAngle: "",
  cameraMove: "",
  location: "",
  timeLight: "",
  mood: "",
  sound: "",
  styleRef: "",
  note: "",
  emotion: "",
  sourceCardContent: "她在门边停住。",
};

function row(overrides: Partial<PromptRow>): PromptRow {
  return {
    id: overrides.id ?? "row",
    dimension: overrides.dimension ?? "genre",
    label: overrides.label ?? "流派",
    value: overrides.value ?? "油画",
    weight: overrides.weight ?? 0.5,
    source: overrides.source ?? { system: "art-repo", label: "art库" },
    category: overrides.category ?? "style",
    inheritance: overrides.inheritance ?? "own",
    contentLength: overrides.contentLength ?? 2,
  };
}

describe("creation editor rerender", () => {
  it("includes edited weights in the generated prompt", () => {
    const prompt = buildRerenderPrompt({
      shot,
      rows: [
        row({ label: "流派", value: "胶片油画", weight: 0.9 }),
        row({ label: "主体", value: "女孩", weight: 0.4 }),
      ],
    });

    expect(prompt).toContain("流派(90%): 胶片油画");
    expect(prompt).toContain("主体(40%): 女孩");
  });

  it("calls generateForMobile once for a single current-shot rerender", async () => {
    const generate = vi.fn(async () => ({
      status: "ok" as const,
      imageUrl: "/api/images/new.png",
      imageId: 12,
    }));

    await rerenderShotImage({
      storyId: 7,
      shot: {
        ...shot,
        styleRef: "premium commercial film",
      },
      rows: [row({ value: "水彩", weight: 0.8 })],
      reference: {
        imageUrl: "data:image/png;base64,full-frame",
        identityImageUrl: "data:image/png;base64,identity-crop",
        contextImageUrls: [
          "/api/images/previous-tail.webp",
          "/api/images/next-head.webp",
        ],
      },
      explicitInstruction: "背景变亮，人物和物体不变。",
      costConfirmation: { accepted: true, estimatedCny: 0.68 },
      generate,
    });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        storyId: 7,
        shotNo: 2,
        imageProvider: "midjourney",
        styleHint: "premium commercial film",
        autoSelect: true,
        referenceImageUrl: "data:image/png;base64,full-frame",
        referenceIdentityImageUrl: "data:image/png;base64,identity-crop",
        referenceContextImageUrls: [
          "/api/images/previous-tail.webp",
          "/api/images/next-head.webp",
        ],
        explicitInstruction: "背景变亮，人物和物体不变。",
        costConfirmation: { accepted: true, estimatedCny: 0.68 },
      })
    );
    expect(generate.mock.calls[0][0].prompt).toContain("水彩");
  });

  it("submits one Midjourney grid task for four storyboard candidates", async () => {
    const generate = vi.fn(async () => ({
      status: "ok" as const,
      imageUrl: "/api/images/candidate-grid.png",
      imageId: 21,
    }));

    const result = await rerenderShotImageCandidates({
      storyId: 7,
      shot,
      rows: [row({ value: "水彩", weight: 0.8 })],
      reference: {
        imageUrl: "/api/images/current-frame.webp",
      },
      explicitInstruction: "保持人物和材质，给我四张独立构图备选。",
      candidateCount: 4,
      costConfirmation: { accepted: true, estimatedCny: 0.68 },
      generate,
    });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      generatedCount: 4,
      failedCount: 0,
    });
    expect(result.results).toEqual([
      {
        status: "ok",
        imageUrl: "/api/images/candidate-grid.png",
        imageId: 21,
      },
    ]);
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        imageProvider: "midjourney",
        explicitInstruction: "保持人物和材质，给我四张独立构图备选。",
        costConfirmation: {
          accepted: true,
          estimatedCny: 0.68,
        },
      })
    );
  });

  it("surfaces generation errors without returning a new image", async () => {
    await expect(
      rerenderShotImage({
        storyId: 7,
        shot,
        rows: [row({})],
        generate: async () => ({ status: "error", error: "service down" }),
      })
    ).rejects.toThrow("service down");
  });

  it("turns low-level fetch failures into an actionable rerender message", async () => {
    await expect(
      rerenderShotImage({
        storyId: 7,
        shot,
        rows: [row({})],
        generate: async () => {
          throw new Error("Failed to fetch");
        },
      })
    ).rejects.toThrow("重渲请求没有连上生成服务");

    expect(readableRerenderError("fetch failed")).toContain("生成服务");
  });

  it("does not send oversized inline reference images with the rerender request", () => {
    const input = createGenerateForMobileInput({
      storyId: 7,
      shot,
      rows: [row({})],
      reference: {
        imageUrl: `data:image/jpeg;base64,${"x".repeat(2_600_000)}`,
        identityImageUrl: "data:image/jpeg;base64,small",
      },
    });

    expect(input.referenceImageUrl).toBeUndefined();
    expect(input.referenceIdentityImageUrl).toBe(
      "data:image/jpeg;base64,small"
    );
  });
});
