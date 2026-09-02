import { describe, expect, it, vi } from "vitest";
import type { CreationEditorShot } from "./types";
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
        storyStyleImageUrl: "/api/images/publishing-cover.webp",
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
        storyStyleReferenceImageUrl: "/api/images/publishing-cover.webp",
        explicitInstruction: "背景变亮，人物和物体不变。",
        costConfirmation: { accepted: true, estimatedCny: 0.68 },
      })
    );
    expect(generate.mock.calls[0][0].prompt).toContain("水彩");
  });

  it("客户端等待超时会解除等待并提醒不要重复提交", async () => {
    vi.useFakeTimers();
    try {
      const pending = rerenderShotImage({
        storyId: 1,
        shot,
        rows: [row({ value: "水彩" })],
        generate: () => new Promise<GenerateForMobileResult>(() => {}),
      });
      const assertion = expect(pending).rejects.toThrow("避免重复付费");
      await vi.advanceTimersByTimeAsync(20_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the 302 reference-image editor for an exact selected-frame edit", async () => {
    const generate = vi.fn(async () => ({
      status: "ok" as const,
      imageUrl: "/api/images/0201-tail-long-dress.png",
      imageId: 1419,
    }));

    const result = await rerenderShotImage({
      storyId: 1165,
      shot,
      rows: [row({ value: "红黑版画与油画", weight: 0.9 })],
      reference: {
        imageUrl: "/api/images/0201-tail.png",
        identityImageUrl: "/api/images/0201-tail.png",
      },
      imageProvider: "gpt-image",
      editMaskImageUrl: "data:image/png;base64,c2tpcnQtbWFzaw==",
      explicitInstruction:
        "只把女主的裙子改为白色及地长裙，人物、发型、动作、构图、场景、颜色和材质完全不变。",
      costConfirmation: { accepted: true, estimatedCny: 1.49 },
      generate,
    });

    expect(result.imageId).toBe(1419);
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        imageProvider: "gpt-image",
        editMaskImageUrl: "data:image/png;base64,c2tpcnQtbWFzaw==",
        referenceImageUrl: "/api/images/0201-tail.png",
        referenceIdentityImageUrl: "/api/images/0201-tail.png",
        referenceContextImageUrls: undefined,
        explicitInstruction:
          "只把女主的裙子改为白色及地长裙，人物、发型、动作、构图、场景、颜色和材质完全不变。",
      })
    );
  });

  /**
   * 2026-08-19：一个 MJ turbo 任务原生返回 2×2 四宫格，供应商层已经把四张都落盘。
   * 但这里以前写死 `results: [result]` / `generatedCount: 1`，另外三张付过钱的候选
   * 直接蒸发——界面写着「渲染 4 张」，最后只看得到一张。
   */
  it("供应商真返回四张候选时全部呈现，不丢掉付过钱的另外三张", async () => {
    const generate = vi.fn(async () => ({
      status: "ok" as const,
      imageUrl: "/api/images/candidate-1.png",
      imageId: 31,
      candidates: [
        { imageId: 31, imageUrl: "/api/images/candidate-1.png" },
        { imageId: 32, imageUrl: "/api/images/candidate-2.png" },
        { imageId: 33, imageUrl: "/api/images/candidate-3.png" },
        { imageId: 34, imageUrl: "/api/images/candidate-4.png" },
      ],
    }));

    const result = await rerenderShotImageCandidates({
      storyId: 7,
      shot,
      rows: [row({ value: "水彩", weight: 0.8 })],
      reference: { imageUrl: "/api/images/current-frame.webp" },
      explicitInstruction: "保持人物和材质，给我四张独立构图备选。",
      candidateCount: 4,
      costConfirmation: { accepted: true, estimatedCny: 0.68 },
      generate,
    });

    // 仍然只提交一次任务：四宫格是一个任务的产物，不是四次付费。
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.generatedCount).toBe(4);
    expect(result.results.map(item => item.imageId)).toEqual([31, 32, 33, 34]);
    expect(result.results.map(item => item.imageUrl)).toEqual([
      "/api/images/candidate-1.png",
      "/api/images/candidate-2.png",
      "/api/images/candidate-3.png",
      "/api/images/candidate-4.png",
    ]);
  });

  it("reports the one returned provider asset without inventing four results", async () => {
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
      generatedCount: 1,
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
        autoSelect: false,
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
    ).rejects.toThrow("图片请求在返回前中断");

    expect(readableRerenderError("fetch failed")).toContain("避免重复付费");
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
