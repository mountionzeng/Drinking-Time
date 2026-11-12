import { describe, expect, it } from "vitest";
import { composeStartEndShotEditorDraft } from "./startEndShotVideoWorkflow";
import { syncMotionFields } from "../../shared/visualProductionChat";

describe("start-end video prompt after a chat brief (startEndShotVideoWorkflow.ts is only called, not changed)", () => {
  const shot3 = {
    stableShotId: "chatcut-launch-20261110-shot-3", videoPrompt: "从彩色噪点渐变为城市上空、森林，最后停在云层上空",
    action: "使用素材 flight_v1.mp4", cameraMove: "放大构图", videoStart: "源入点 0.00s", videoEnd: "源出点 14.47s",
    transitionIn: "按 ChatCut XML 清单", transitionOut: "按 ChatCut XML 清单",
    generationParams: { frameMode: "start_end", firstFrameImageId: 2045, lastFrameImageId: 2047 },
  };

  it("before: the composed prompt is ChatCut residue and ignores the chat brief", () => {
    const before = composeStartEndShotEditorDraft(shot3);
    expect(before).toContain("使用素材 flight_v1.mp4");
    expect(before).not.toContain("云层上空");
  });

  it("after: the brief is the top-priority action and the residue is gone", () => {
    const sync = syncMotionFields(shot3, "从彩色噪点渐变为城市上空、森林，最后停在云层上空，全程明亮通透")!;
    const after = composeStartEndShotEditorDraft({ ...shot3, ...sync.updates });
    expect(after).toContain("用户当前画面动作（最高优先级）：从彩色噪点渐变为城市上空、森林，最后停在云层上空");
    for (const residue of ["使用素材", "源入点", "源出点", "ChatCut"]) expect(after).not.toContain(residue);
    expect(after).toContain("当前相机运动：放大构图");
  });
});
