import { describe, expect, it, vi } from "vitest";
import {
  quoteShotImages,
  renderShotImageBatch,
  shotImageRenderSettingsSchema,
} from "./shotImageRender";
describe("unified shot image rendering", () => {
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
