import { describe, expect, it } from "vitest";

import { storyShotToDbRow } from "./routers/_storyShared";

describe("storyShotToDbRow", () => {
  it("preserves explicit scene metadata for downstream rendering context", () => {
    const row = storyShotToDbRow({
      projectId: 1,
      storyId: 2,
      userId: 3,
      index: 8,
      shot: {
        shotNo: 9,
        sceneNo: "SC03",
        sceneTitle: "第三幕：向下生长",
        sceneArtBrief: "泥土、根系、身体内部、低饱和绿色与褐色",
        subject: "主角向地下走",
        action: "她把视线交给泥土和根",
        dialogue: "我只能往下走。",
        shotType: "中景",
        beat: "转折",
        cameraAngle: "平视",
        cameraMove: "缓慢下移",
        location: "地下根系空间",
        timeLight: "低照度漫射光",
        mood: "压抑后开始扎根",
        sound: "低频泥土声",
        styleRef: "有机根系、身体和泥土的边界",
        note: "",
        emotion: "下潜",
        sourceCardContent: "向身体和泥土里寻找自己的观看。",
      },
    });

    expect(row.sceneNo).toBe("SC03");
    expect(row.sceneType).toBe("第三幕：向下生长");
    expect(row.sourceSummary).toContain("第三幕：向下生长");
    expect(row.colorPalette).toContain("泥土、根系、身体内部");
    expect(row.promptDraft).toContain("场景美术库：泥土、根系、身体内部");
  });
});
