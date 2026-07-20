import { describe, expect, it } from "vitest";
import { buildStoryChatSummary } from "./chatStoryContext";
import type { StoryShot } from "./types";

function shot(
  shotNo: number,
  cueCode: string,
  actNo: string
): StoryShot {
  return {
    stableShotId: `shot-${shotNo}`,
    shotNo,
    cueCode,
    actNo,
    subject: "",
    action: "",
    dialogue: "",
    shotType: "",
    beat: "起势",
    cameraAngle: "",
    cameraMove: "",
    location: "",
    timeLight: "",
    mood: "",
    sound: "",
    styleRef: "",
    note: "",
    emotion: "",
    sourceCardContent: "",
  };
}

describe("buildStoryChatSummary", () => {
  it("把故事语义、四幕结构与稳定镜头号压成聊天上下文", () => {
    const summary = buildStoryChatSummary({
      title: "SheSelf",
      logline: "一个女性向身体与根系深处走去。",
      theme: "不经允许也可以生长",
      arc: "被观看到自我托举",
      shots: [
        shot(1, "0101", "第一幕"),
        shot(2, "0102", "第一幕"),
        shot(3, "0201", "第二幕"),
        shot(4, "0301", "第三幕"),
        shot(5, "0401", "第四幕"),
      ],
    });

    expect(summary).toContain("当前故事：SheSelf");
    expect(summary).toContain("4 幕，共 5 镜");
    expect(summary).toContain("第一幕 2 镜");
    expect(summary).toContain("0101、0102、0201、0301、0401");
    expect(summary).toContain("按 cueCode 定位");
  });
});
