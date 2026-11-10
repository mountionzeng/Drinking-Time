import { describe, expect, it } from "vitest";
import { storyboardAutomaticVideoShot, storyboardVideoPreparationBlockReason, storyboardVideoRenderBlockReason } from "./storyboardReviewModel";
import type { CreationEditorShot } from "@/features/creationEditor/types";
const shot = (patch: Partial<CreationEditorShot> = {}) => ({ shotNo: 1, videoPrompt: "人物缓慢走向窗边", imageVersions: [
  { id: 10, imageUrl: "/first.png", isCurrent: false }, { id: 20, imageUrl: "/last.png", isCurrent: false },
], ...patch } as CreationEditorShot);
describe("automatic video preparation", () => {
  it("keeps the chosen primary, otherwise prefers this shot's book reference", () => {
    expect(storyboardAutomaticVideoShot(shot({ imageId: 10, imageUrl: "/first.png" })).imageId).toBe(10);
    expect(storyboardAutomaticVideoShot(shot({ publishingVideo: { referenceImageIds: [10] } as CreationEditorShot["publishingVideo"] })).imageId).toBe(10);
    expect(storyboardAutomaticVideoShot(shot()).imageId).toBe(20);
  });
  it("never uses a candidate grid as the video frame", () => {
    const source = shot({ imageVersions: [{ id: 30, imageUrl: "/grid.png", candidateLayout: "four-up-sheet" }] as unknown as CreationEditorShot["imageVersions"] });
    expect(storyboardAutomaticVideoShot(source).imageId).toBeUndefined();
  });
  it("lets the button prepare a missing frame but keeps the strict submission gate", () => {
    const source = shot({ imageVersions: [] });
    expect(storyboardVideoPreparationBlockReason(source, { ready: true }, true)).toBeNull();
    expect(storyboardVideoRenderBlockReason(source, { ready: true })).toContain("主图");
    expect(storyboardVideoPreparationBlockReason(source, { ready: true }, false)).toContain("图片模型");
  });
  it("uses existing prose without inventing a scene or ignoring provider failure", () => {
    const source = shot({ videoPrompt: "", action: "抬头看向镜头" });
    expect(storyboardAutomaticVideoShot(source).videoPrompt).toContain("抬头看向镜头");
    expect(storyboardVideoPreparationBlockReason(source, { ready: false, reason: "通道故障" }, true)).toBe("通道故障");
    expect(storyboardVideoPreparationBlockReason(shot({ videoPrompt: "" }), { ready: true }, true)).toContain("画面或动作");
  });
});
