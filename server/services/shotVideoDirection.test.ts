import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ENV } from "../_core/env";
import { createStory, resetMemoryStateForTesting } from "../db";
import { analyzeShotVideoDirection } from "./shotVideoDirection";

const saved = {
  databaseUrl: ENV.databaseUrl,
  api302Key: ENV.api302Key,
  videoPrompt302Model: ENV.videoPrompt302Model,
};

beforeEach(() => {
  resetMemoryStateForTesting();
  ENV.databaseUrl = "";
  ENV.api302Key = "";
  ENV.videoPrompt302Model = "";
});

afterEach(() => {
  ENV.databaseUrl = saved.databaseUrl;
  ENV.api302Key = saved.api302Key;
  ENV.videoPrompt302Model = saved.videoPrompt302Model;
});

describe("analyzeShotVideoDirection", () => {
  it("returns an honest shot-table analysis when no visual frame exists", async () => {
    const story = await createStory({
      userId: 1,
      projectId: null,
      title: "SheSelf",
      body: {
        shots: [
          {
            stableShotId: "shot-01",
            shotIdentity: "shot-01",
            shotNo: 1,
            shotType: "近景",
            cameraAngle: "平视",
            action: "低头",
            videoEnd: "视线停在画面左下方",
            transitionOut: "把低头动作留给下一镜",
          },
          {
            stableShotId: "shot-02",
            shotIdentity: "shot-02",
            shotNo: 2,
            subject: "SheSelf",
            action: "缓慢抬眼",
            intent: "让观众感到她开始看见自己",
            shotType: "近景",
            cameraAngle: "平视",
            cameraMove: "缓慢推进",
            videoStart: "承接低头状态",
            videoEnd: "视线抬到镜头边缘",
            transitionIn: "动作匹配",
          },
          {
            stableShotId: "shot-03",
            shotIdentity: "shot-03",
            shotNo: 3,
            shotType: "远景",
            action: "走入森林",
          },
        ],
      },
    });

    const result = await analyzeShotVideoDirection(
      {
        storyId: story.id,
        shotNo: 2,
        stableShotId: "shot-02",
        draftPrompt: "缓慢抬眼，镜头轻推",
      },
      1
    );

    expect(result.source).toBe("deterministic-fallback");
    expect(result.referenceFrames).toEqual([]);
    expect(result.analysis.visualSummary).toContain("缺少可供视觉模型读取");
    expect(result.analysis.narrativeIntent).toContain("开始看见自己");
    expect(result.analysis.actionContinuity).toContain("视线停在画面左下方");
    expect(result.analysis.shotScaleChange).toBe("近景 → 近景 → 远景");
    expect(result.analysis.cameraRig).toContain("短滑轨");
    expect(result.analysis.motionTimeline).toContain("起势 0-25%");
    expect(result.analysis.cameraSubjectCoordination).toContain("人物动作");
    expect(result.analysis.preservationConstraints).toContain("物体数量与位置");
    expect(result.suggestedFields.cameraMove).toContain("缓慢推进");
    expect(result.suggestedFields.cameraPath).toContain("收束 75-100%");
    expect(result.suggestedFields.negativePrompt).toContain(
      "object count and placement"
    );
    expect(result.suggestedFields.videoPrompt).toBeTruthy();
  });
});
