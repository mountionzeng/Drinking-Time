import { describe, expect, it, vi } from "vitest";
import {
  quoteShotImages,
  renderShotImageBatch,
  shotImageRenderSettingsSchema,
} from "./shotImageRender";
describe("unified shot image rendering", () => {
  it("quotes four independent renders and submits exactly four", async () => {
    const generate = vi.fn(async (index: number) => index + 10);
    expect(quoteShotImages(4).estimatedCny).toBe(5.96);
    expect((await renderShotImageBatch(4, generate)).results).toEqual([
      10, 11, 12, 13,
    ]);
    expect(generate).toHaveBeenCalledTimes(4);
  });
  it("stops on an uncertain failure and retains earlier results", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce(100)
      .mockRejectedValueOnce(new Error("task accepted, result unknown"));
    const result = await renderShotImageBatch(4, generate);
    expect(result.results).toEqual([100]);
    expect(result.remainingCount).toBe(3);
    expect(result.error).toContain("unknown");
    expect(generate).toHaveBeenCalledTimes(2);
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
