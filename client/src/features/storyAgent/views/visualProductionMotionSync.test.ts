import { describe, expect, it, vi } from "vitest";
import { executeVisualProduction, type ProductionShot } from "./visualProductionWorkflow";
import { parseVisualProductionChat } from "@shared/visualProductionChat";

// 第 03 镜现在的样子：ChatCut 导入留下的字段 + 首尾帧
const chatCutShot: ProductionShot = {
  stableShotId: "s3", shotNo: 3, videoPrompt: "旧的视频方案", imageIds: [2045, 2046, 2047], takeIds: [1611],
  motionFields: { action: "使用素材 flight_v1.mp4", cameraMove: "放大构图", videoStart: "源入点 0.00s", videoEnd: "源出点 14.47s", transitionIn: "按 ChatCut XML 清单", transitionOut: "按 ChatCut XML 清单" },
};
const plainShot: ProductionShot = { stableShotId: "s4", shotNo: 4, videoPrompt: "缓慢移动", imageIds: [41], takeIds: [] };

function setup(shots: ProductionShot[]) {
  return {
    shots, selectedShotNo: shots[0].shotNo, isCurrent: vi.fn(() => true),
    save: vi.fn(async () => {}), saveFields: vi.fn(async () => {}),
    render: vi.fn(async (_shot: ProductionShot) => "视频报价已取消，没有生成"), adopt: vi.fn(async () => {}),
  };
}
const request = (instruction: string) => ({ instruction, intent: parseVisualProductionChat(instruction)! });

describe("chat video brief also drives the structured motion fields", () => {
  it("writes 画面动作, clears ChatCut residue, keeps the user's own camera move, and does not render", async () => {
    const deps = setup([chatCutShot]);
    const reply = await executeVisualProduction(request("修改第03镜的视频要求：从彩色噪点渐变为城市上空、森林，最后停在云层上空，全程明亮通透。先保存，不生成视频。"), deps);
    expect(deps.save).toHaveBeenCalledWith(chatCutShot, "videoPrompt", expect.stringContaining("云层上空"));
    expect(deps.saveFields).toHaveBeenCalledWith(chatCutShot, {
      action: "从彩色噪点渐变为城市上空、森林，最后停在云层上空，全程明亮通透",
      videoStart: "", videoEnd: "", transitionIn: "", transitionOut: "",
    });
    expect(deps.render).not.toHaveBeenCalled();
    expect(reply).toContain("已同步写入「画面动作」");
    expect(reply).toContain("源入点 0.00s");
    expect(reply).toContain("运镜「放大构图」");
    expect(chatCutShot.motionFields!.action).toBe("使用素材 flight_v1.mp4"); // 输入对象不被改写
  });

  it("passes the synced fields to the (quoted) video renderer", async () => {
    const deps = setup([chatCutShot]);
    const reply = await executeVisualProduction(request("第03镜生成视频：穿过森林，最后停在厚厚的云层上空"), deps);
    expect(deps.render).toHaveBeenCalledTimes(1);
    expect(deps.render.mock.calls[0][0].motionFields).toMatchObject({ action: "穿过森林，最后停在厚厚的云层上空", videoStart: "", cameraMove: "放大构图" });
    expect(reply).toContain("视频报价已取消，没有生成");
  });

  it("a bare 「生成视频」 command does not overwrite the action", async () => {
    const deps = setup([chatCutShot]);
    await executeVisualProduction(request("第03镜生成视频"), deps);
    expect(deps.saveFields).not.toHaveBeenCalled();
  });

  it("shots without structured fields keep the old behaviour (videoPrompt only)", async () => {
    const deps = setup([plainShot]);
    await executeVisualProduction(request("修改第04镜的视频要求：镜头慢慢推近窗台上的茶杯"), deps);
    expect(deps.save).toHaveBeenCalledTimes(1);
    expect(deps.saveFields).not.toHaveBeenCalled();
  });

  it("without a saveFields dependency nothing extra is written", async () => {
    const { saveFields: _unused, ...deps } = setup([chatCutShot]);
    const reply = await executeVisualProduction(request("修改第03镜的视频要求：穿过森林飞向云层"), deps);
    expect(reply).not.toContain("画面动作");
  });
});
