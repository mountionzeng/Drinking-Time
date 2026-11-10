import { describe, expect, it, vi } from "vitest";
import {
  quoteShotImages,
  requestsStrictReferenceFidelity,
  renderShotImageBatch,
  shotImageRenderSettingsSchema,
} from "./shotImageRender";
describe("unified shot image rendering", () => {
  it("requires exactly one image for inherited visual continuity", () => {
    const parse = (imageIds: number[], assets = {}) => shotImageRenderSettingsSchema.safeParse({
      count: 4, references: { imageIds, assets, imagePurpose: "scene-style" },
    }).success;
    expect(parse([19])).toBe(true);
    expect(parse([])).toBe(false);
    expect(parse([19, 20])).toBe(false);
    expect(parse([19], { pet: { assetId: "a", versionId: "v1" } })).toBe(false);
  });
  it.each(["我希望和参考图一模一样", "保留茶壶形状和位置不变", "严格保留原图", "keep the reference exactly the same",
    "严格保留小茶壶、对话框、附件/麦克风/发送图标以及现有英文文字的形状、位置和内容。只替换背景",
    "小茶壶、对话框、图标和英文文字保持原样，只改周围背景", "Keep the existing lettering unchanged; change the background"])("recognizes an explicit preservation instruction: %s", text => {
    expect(requestsStrictReferenceFidelity(text)).toBe(true);
  });
  it.each(["不要和原图一模一样，重新设计", "无需完全一致", "参考它画一只猫", "换一种风格"])("does not invent a strict lock: %s", text => {
    expect(requestsStrictReferenceFidelity(text)).toBe(false);
  });
  it.each([1, 2, 3, 4, 5, 8])(
    "quotes and submits %i requested images in MJ tasks",
    async count => {
      const generate = vi.fn(async (index: number) => ({
        generatedCount: 4,
        task: index,
      }));
      const tasks = Math.ceil(count / 4);
      const quote = quoteShotImages(count);
      expect(quote.estimatedCny).toBe(tasks * 0.68);
      expect(quote.candidateCount).toBe(tasks * 4);
      const result = await renderShotImageBatch(count, generate);
      expect(result.generatedCount).toBe(tasks * 4);
      expect(generate).toHaveBeenCalledTimes(tasks);
    }
  );
  it("stops on uncertain failure and retains the first four candidates", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ generatedCount: 4 })
      .mockRejectedValueOnce(new Error("task accepted, result unknown"));
    const result = await renderShotImageBatch(8, generate);
    expect(result.generatedCount).toBe(4);
    expect(result.remainingCount).toBe(4);
    expect(result.error).toContain("unknown");
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it("preserves a short provider response without buying more images", async () => {
    const generate = vi.fn(async () => ({ generatedCount: 1 }));
    const result = await renderShotImageBatch(8, generate);
    expect(result.generatedCount).toBe(1);
    expect(result.error).toContain("实际返回1张");
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid counts before any request", async () => {
    for (const count of [0, -1, 1.5, 9, NaN]) {
      const generate = vi.fn();
      await expect(renderShotImageBatch(count, generate)).rejects.toThrow();
      expect(generate).not.toHaveBeenCalled();
    }
  });
  it("retains an explicit empty selection", () => {
    expect(
      shotImageRenderSettingsSchema.parse({
        count: 1,
        references: { imageIds: [], assets: {} },
      }).references
    ).toEqual({ imageIds: [], assets: {} });
    expect(
      shotImageRenderSettingsSchema.safeParse({
        count: 1,
        references: {
          imageIds: [1, 2, 3, 4],
          assets: { pet: { assetId: "cat", versionId: "v1" } },
        },
      }).success
    ).toBe(false);
  });
});

it("preserves an accepted receipt rather than converting it into a failed batch", async () => {
  const { PendingShotImageError, renderShotImageBatch } = await import("./shotImageRender");
  const pending = new PendingShotImageError("已受理", "receipt");
  const generate = vi.fn().mockRejectedValue(pending);
  await expect(renderShotImageBatch(4, generate)).rejects.toBe(pending);
  expect(generate).toHaveBeenCalledTimes(1);
});
