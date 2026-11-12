import { describe, expect, it } from "vitest";
import { isChatCutResidue, motionBriefText, syncMotionFields } from "./visualProductionChat";

describe("ChatCut residue and motion brief helpers", () => {
  it.each([
    ["使用素材 flight_v1.mp4", true], ["源入点 0.00s", true], ["源出点 14.47s", true], ["按 ChatCut XML 清单", true],
    ["放大构图", false], ["镜头缓慢推近", false], ["使用素材里的森林", false], ["", false],
  ])("isChatCutResidue(%s) = %s", (value, expected) => expect(isChatCutResidue(value)).toBe(expected));

  it.each([
    ["修改第03镜的视频要求：穿过森林飞向云层。先保存，不生成视频。", "穿过森林飞向云层"],
    ["第03镜生成视频：穿过森林，最后停在云层上空", "穿过森林，最后停在云层上空"],
    ["第03镜生成视频", null],
    ["生成当前镜头的视频", null],
    ["生成当前镜头的视频，慢慢推近茶杯和窗台", "生成当前镜头的视频，慢慢推近茶杯和窗台"],
  ])("motionBriefText(%s)", (text, expected) => expect(motionBriefText(text)).toBe(expected));

  it("only rewrites action and clears residue; user-written fields are kept", () => {
    expect(syncMotionFields({}, "x")).toBeNull();
    const sync = syncMotionFields({ action: "主角抬头", cameraMove: "放大构图", videoStart: "源入点 0.00s" }, "穿过森林");
    expect(sync).toEqual({
      updates: { action: "穿过森林", videoStart: "" },
      cleared: [{ field: "videoStart", value: "源入点 0.00s" }],
      kept: [{ field: "cameraMove", value: "放大构图" }],
    });
  });
});
