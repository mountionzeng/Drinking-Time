import { describe, expect, it, vi } from "vitest";
import { renderSelectionRevision } from "./useSelectionImageRerender";
import type { SelectionState } from "./types";
const selection: SelectionState = {
  sourceType: "storyboard-image",
  sourceId: "44",
  storyId: 7,
  stableShotId: "shot-a",
  shotNo: 2,
  imageId: 44,
  selectedText: "猫",
  fullText: "猫",
  objectVersion: "image:44",
};
const changed = { isApprovalOnly: false, modifiedFullText: "猫看向镜头" };
describe("selected image chat revision", () => {
  it("hands the exact original instruction and image to generation once, and returns the candidate", async () => {
    const render = vi
      .fn()
      .mockResolvedValue({
        status: "success",
        message: "4张",
        imageId: 45,
        imageUrl: "/45.png",
      });
    expect(
      await renderSelectionRevision({
        selection,
        storyId: 7,
        instruction: "让小猫看向镜头",
        result: changed,
        originalText: "猫",
        render,
      })
    ).toMatchObject({ imageId: 45 });
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith({
      storyId: 7,
      stableShotId: "shot-a",
      shotNo: 2,
      cueCode: null,
      imageId: 44,
      instruction: "让小猫看向镜头",
    });
  });
  it.each([
    { result: { ...changed, isApprovalOnly: true } },
    { result: { ...changed, modifiedFullText: "猫" } },
    { result: { ...changed, modifiedFullText: "" } },
    { selection: { ...selection, imageId: null } },
    {
      selection: {
        ...selection,
        selection: { kind: "rect", x: 0, y: 0, width: 1, height: 1 },
      },
    },
  ])(
    "does not generate for acknowledgement, unchanged text or non-whole-image scope: %j",
    async override => {
      const render = vi.fn();
      expect(
        await renderSelectionRevision({
          selection,
          storyId: 7,
          instruction: "不错",
          result: changed,
          originalText: "猫",
          render,
          ...override,
        } as Parameters<typeof renderSelectionRevision>[0])
      ).toBeNull();
      expect(render).not.toHaveBeenCalled();
    }
  );
  it("returns cancellation without retrying", async () => {
    const render = vi
      .fn()
      .mockResolvedValue({ status: "cancelled", message: "已取消" });
    expect(
      await renderSelectionRevision({
        selection,
        storyId: 7,
        instruction: "改背景",
        result: changed,
        originalText: "猫",
        render,
      })
    ).toMatchObject({ status: "cancelled" });
    expect(render).toHaveBeenCalledTimes(1);
  });
});
