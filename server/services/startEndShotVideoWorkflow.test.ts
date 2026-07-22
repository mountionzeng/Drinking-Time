import { describe, expect, it } from "vitest";

import {
  composeStartEndShotEditorDraft,
  findMatchingStartEndFrameTake,
} from "./startEndShotVideoWorkflow";

describe("composeStartEndShotEditorDraft", () => {
  it("makes the current storyboard text authoritative over a hidden legacy prompt", () => {
    const prompt = composeStartEndShotEditorDraft({
      action: "女主在黑暗中撑出自己的区域，相机运动加快",
      performance: "双臂真实发力，身体保持稳定",
      environmentMotion: "红黑空间持续重组",
      cameraMove: "沿中轴后撤并加快速度",
      videoStart: "女主双臂贴近边界",
      videoEnd: "空间被撑开并停住",
      transitionOut: "以红色硬边切入下一镜",
      videoPrompt: "旧方案：相机缓慢后撤",
      negativePrompt: "不要新增人物",
    });

    expect(prompt).toContain(
      "用户当前画面动作（最高优先级）：女主在黑暗中撑出自己的区域，相机运动加快"
    );
    expect(prompt).toContain("当前相机运动：沿中轴后撤并加快速度");
    expect(prompt).not.toContain("旧方案：相机缓慢后撤");
    expect(prompt).toContain("避免：不要新增人物");
    expect(prompt).toContain("若其他字段与画面动作冲突，必须以画面动作为准");
  });

  it("still produces a usable draft when the hidden legacy video prompt is empty", () => {
    expect(
      composeStartEndShotEditorDraft({
        action: "人物从黑暗中撑开一条通道",
        cameraMove: "肩扛快速后撤，结尾收稳",
      })
    ).toContain("人物从黑暗中撑开一条通道");
  });

  it("keeps the hidden legacy prompt as a fallback for old shots without director fields", () => {
    expect(
      composeStartEndShotEditorDraft({
        dialogue: "我向黑暗深处走去。",
        videoPrompt: "人物缓慢向前，摄影机跟随。",
      })
    ).toContain("既有视频方案：人物缓慢向前，摄影机跟随。");
  });
});

describe("findMatchingStartEndFrameTake", () => {
  it("finds a previous usable take that locks the same frame pair", () => {
    expect(
      findMatchingStartEndFrameTake(
        [
          {
            id: 1319,
            stableShotId: "shot-0201",
            status: "available",
            parameterSnapshot: {
              kind: "shot-start-end",
              firstFrameImageId: 1365,
              lastFrameImageId: 1364,
            },
          },
        ],
        {
          stableShotId: "shot-0201",
          firstFrameImageId: 1365,
          lastFrameImageId: 1364,
        }
      )?.id
    ).toBe(1319);
  });

  it("ignores failed takes and different frame pairs", () => {
    expect(
      findMatchingStartEndFrameTake(
        [
          {
            id: 1306,
            stableShotId: "shot-0201",
            status: "failed",
            parameterSnapshot: {
              kind: "shot-start-end",
              firstFrameImageId: 1365,
              lastFrameImageId: 1364,
            },
          },
        ],
        {
          stableShotId: "shot-0201",
          firstFrameImageId: 1365,
          lastFrameImageId: 1364,
        }
      )
    ).toBeNull();
  });
});
