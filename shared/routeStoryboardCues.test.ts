import { describe, expect, it } from "vitest";
import { routeStoryboardCues } from "./routeStoryboardCues";
import { shotOutputSource } from "./bookShotActions";
import {
  validWritingStyle,
  writingModuleTexts,
  type BookWritingStyle,
} from "./bookWritingStyle";
import { randomUUID } from "node:crypto";

function shot(lines: string[]) {
  const style: BookWritingStyle = lines.map((_, i) => ({
    id: "m" + i,
    format: i ? "text" : "shot",
    parentId: i ? "m0" : null,
    collapsed: false,
  }));
  const before = lines.join("\n");
  const result = routeStoryboardCues(before, style, randomUUID);
  expect(validWritingStyle(result.body, result.writingStyle)).toBe(true);
  const texts = writingModuleTexts(result.body, result.writingStyle);
  const rows = result.writingStyle.map((r, i) => ({ ...r, text: texts[i] }));
  expect(
    routeStoryboardCues(result.body, result.writingStyle, randomUUID).body
  ).toBe(result.body);
  return { rows, result };
}

describe("storyboard field policy", () => {
  it("routes a legacy picture instruction in a new edition and retains the corresponding media module and source", () => {
    const mixed =
      "画面提示词：第10秒，从合影直接切到城墙画面，缓缓推近。按全片时间试排，字幕在10.5—11秒淡入，11—15秒完整停留。配音后可调整。";
    const video = "视频：第10秒，从合影直接切到城墙画面，缓缓推近。";
    const { rows, result } = shot([
      "城门",
      mixed,
      "![图片](/api/images/city.png)",
      video,
      "屏幕文字：天亮了",
    ]);
    expect(rows[1].text).toBe("画面描述：城墙画面");
    expect(rows[2]).toMatchObject({
      id: "m2",
      text: "![图片](/api/images/city.png)",
    });
    expect(rows.filter(r => r.text === video)).toHaveLength(1);
    expect(rows.find(r => r.text.startsWith("屏幕文字｜"))?.text).toContain(
      "10.5—11秒淡入，11—15秒完整停留：天亮了"
    );
    expect(result.body).toContain("时长与节奏：按全片时间试排，配音后可调整。");
    expect(shotOutputSource(rows, 1, "image")?.prompt).toBe("城墙画面");
    expect(shotOutputSource(rows, 4, "subtitle")?.prompt).toBe("天亮了");
  });
  it("keeps literal lettering on a prop and isolates both media and routing by shot", () => {
    const { rows } = shot([
      "厨房",
      "画面提示词",
      "第3秒，从窗台切到茶杯，杯上写着“第8秒”。",
      "音乐：弦乐渐弱。",
    ]);
    expect(rows[2].text).toContain("杯上写着“第8秒”");
    expect(rows[2].text).not.toMatch(/第3秒|切到/);
    expect(rows.some(r => r.text === "音乐：弦乐渐弱。")).toBe(true);
    expect(rows.at(-1)?.text).toContain("第3秒，从窗台切到茶杯");
  });
});
