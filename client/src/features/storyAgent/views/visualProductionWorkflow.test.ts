import { describe, expect, it, vi } from "vitest";
import { executeVisualProduction, type ProductionShot } from "./visualProductionWorkflow";
import { parseVisualProductionChat } from "@shared/visualProductionChat";
const shots: ProductionShot[] = [
  { stableShotId: "s1", shotNo: 1, promptDraft: "原故事A", imageIds: [11], takeIds: [] },
  { stableShotId: "s2", shotNo: 2, promptDraft: "原故事B", videoPrompt: "缓慢移动", imageIds: [21, 22], takeIds: [31] },
];
function setup() {
  return { shots, selectedShotNo: 2, isCurrent: vi.fn(() => true), save: vi.fn(async (_shot: ProductionShot, _field: "promptDraft" | "videoPrompt", _value: string) => {}),
    render: vi.fn(async (_shot: ProductionShot, _kind: "image" | "video", _instruction: string, _references?: number[]) => "已放入第02镜画面行"), adopt: vi.fn(async () => {}) };
}
const request = (instruction: string) => ({ instruction, intent: parseVisualProductionChat(instruction)! });
describe("conversation to existing production workflow", () => {
  it("saves any visual brief into the selected shot, never starts a provider", async () => {
    const deps = setup();
    await executeVisualProduction(request("我希望画面采用水墨风格"), deps);
    expect(deps.save).toHaveBeenCalledWith(shots[1], "promptDraft", expect.stringContaining("水墨"));
    expect(deps.render).not.toHaveBeenCalled();
    expect(shots[1].promptDraft).toBe("原故事B");
  });
  it("saves before calling the existing quoted image renderer and returns its real outcome", async () => {
    const deps = setup();
    deps.render.mockImplementationOnce(async shot => {
      expect(deps.save).toHaveBeenCalledTimes(1);
      expect(shot.promptDraft).toContain("原故事B");
      return "已取消，没有生成";
    });
    expect(await executeVisualProduction(request("第02镜生成图片"), deps)).toBe("已取消，没有生成");
    expect(deps.render).toHaveBeenCalledTimes(1);
    expect(deps.render.mock.calls[0][1]).toBe("image");
  });
  it("sends a video request to the video renderer without rewriting narration", async () => {
    const deps = setup();
    await executeVisualProduction(request("生成当前镜头的视频，慢慢推近"), deps);
    expect(deps.save).toHaveBeenCalledWith(shots[1], "videoPrompt", expect.stringContaining("缓慢移动"));
    expect(deps.render.mock.calls[0][1]).toBe("video");
  });
  it("stores conversational motion changes without rendering or adopting an image", async () => {
    const deps = setup();
    const reply = await executeVisualProduction(request("修改第02镜的视频要求：黑暗中放下茶杯，像素点亮世界。先保存，不生成视频。"), deps);
    expect(reply).toContain("视频要求已保存");
    expect(deps.save).toHaveBeenCalledWith(shots[1], "videoPrompt", expect.stringContaining("像素点亮世界"));
    expect(deps.save.mock.calls[0][2]).not.toContain("缓慢移动");
    expect(deps.render).not.toHaveBeenCalled(); expect(deps.adopt).not.toHaveBeenCalled();
  });
  it("does not render after save failure or scope change", async () => {
    const deps = setup();
    deps.save.mockRejectedValueOnce(new Error("保存失败"));
    await expect(executeVisualProduction(request("生成图片"), deps)).rejects.toThrow("保存失败");
    expect(deps.render).not.toHaveBeenCalled();
    deps.isCurrent.mockReturnValueOnce(true).mockReturnValue(false);
    expect(await executeVisualProduction(request("生成图片"), deps)).toContain("切换");
    expect(deps.render).not.toHaveBeenCalled();
  });
  it("respects explicit stable selections and never guesses the first shot", async () => {
    const deps = setup(); deps.selectedShotNo = null as unknown as number;
    expect(await executeVisualProduction(request("生成图片"), deps)).toContain("请先");
    expect(deps.save).not.toHaveBeenCalled();
    expect(deps.render).not.toHaveBeenCalled();
    await executeVisualProduction({ ...request("第01镜生成图片"), selection: { sourceType: "shot", sourceId: "s2", stableShotId: "s2", imageId: 21 } }, deps);
    expect(deps.save.mock.calls[0][0].stableShotId).toBe("s1");
    expect(deps.render.mock.calls[0][0].stableShotId).toBe("s1");
  });
  it("only adopts assets in the target shot and routes the timeline intent", async () => {
    const deps = setup();
    await executeVisualProduction(request("采用图片 #21，放入时间线"), deps);
    expect(deps.adopt).toHaveBeenCalledWith(shots[1], { imageId: 21, takeId: undefined, timeline: true });
    deps.adopt.mockClear();
    expect(await executeVisualProduction(request("采用图片 #11"), deps)).toContain("不属于");
    expect(deps.adopt).not.toHaveBeenCalled();
    expect(deps.render).not.toHaveBeenCalled();
  });
  it("does not even save a brief with a foreign reference", async () => {
    const deps = { ...setup(), referenceImageIds: [21] };
    expect(await executeVisualProduction({ ...request("生成图片"), referenceImageIds: [999] }, deps)).toContain("尚未修改");
    expect(deps.save).not.toHaveBeenCalled(); expect(deps.render).not.toHaveBeenCalled();
  });
  it("rejects an image selection that has since been detached", async () => {
    const deps = setup();
    expect(await executeVisualProduction({ ...request("生成图片"), selection: { sourceType: "storyboard-image", sourceId: "99", stableShotId: "s2", imageId: 99 } }, deps)).toContain("已移出");
    expect(deps.save).not.toHaveBeenCalled();
  });
});
