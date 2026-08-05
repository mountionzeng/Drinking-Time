import { describe, expect, it } from "vitest";
import { buildStoryChatSummary } from "./chatStoryContext";
import type { StoryShot } from "./types";

function shot(shotNo: number, cueCode: string, actNo: string): StoryShot {
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

  it("只带入当前平台的一份发布稿上下文供剪辑台继续追问", () => {
    const summary = buildStoryChatSummary({
      shots: [],
      publishing: {
        version: 1,
        revision: 4,
        activePlatform: "x",
        selectedPlatforms: ["xiaohongshu", "x"],
        core: {
          revision: 2,
          facts: ["Codex 触发了不必要的子 Agent"],
          thesis: "人的注意力不该被无效调用浪费。",
          emotion: "克制的不满",
          voiceTraits: ["直接"],
          visualConcept: "被烧掉的 token",
          updatedAt: 10,
        },
        drafts: {
          x: {
            platform: "x",
            content: {
              title: "Token 都去了哪里",
              body: "我开始怀疑，真正稀缺的不是 token，而是人的注意力。",
              tags: [],
            },
            appliedBaseline: {
              title: "Token 都去了哪里",
              body: "我开始怀疑，真正稀缺的不是 token，而是人的注意力。",
              tags: [],
            },
            sourceCoreRevision: 2,
            revision: 1,
            needsReview: false,
            updatedAt: 10,
          },
          xiaohongshu: {
            platform: "xiaohongshu",
            content: { title: "不应出现", body: "另一平台正文", tags: [] },
            appliedBaseline: {
              title: "不应出现",
              body: "另一平台正文",
              tags: [],
            },
            sourceCoreRevision: 2,
            revision: 1,
            needsReview: false,
            updatedAt: 10,
          },
        },
        cover: null,
        updatedAt: 10,
      },
    });

    expect(summary.match(/\[发布稿交接/g)).toHaveLength(1);
    expect(summary).toContain("[发布稿交接｜X]");
    expect(summary).toContain("人的注意力不该被无效调用浪费");
    expect(summary).toContain("Token 都去了哪里");
    expect(summary).not.toContain("不应出现");
    expect(summary).not.toContain("另一平台正文");
  });
});
