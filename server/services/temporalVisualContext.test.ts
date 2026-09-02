import { describe, expect, it } from "vitest";
import { temporalVisualPromptBlock } from "./temporalVisualContext";

describe("temporalVisualPromptBlock", () => {
  it("uses the current Shanghai season only when the user explicitly means now", () => {
    expect(
      temporalVisualPromptBlock({
        text: "现在，一个女孩走在街边",
        currentDate: "2026-07-15",
      })
    ).toContain("轻薄透气的夏季日常服装");

    expect(
      temporalVisualPromptBlock({
        text: "一个女孩走在街边",
        currentDate: "2026-07-15",
      })
    ).toBeNull();
  });

  it("does not mistake an operational 'now' for story time", () => {
    expect(
      temporalVisualPromptBlock({
        text: "现在帮我画一个女孩走在街边",
        currentDate: "2026-07-15",
      })
    ).toBeNull();

    expect(
      temporalVisualPromptBlock({
        text: "现在帮我画1990年代的一个女孩",
        currentDate: "2026-07-15",
      })
    ).not.toContain("夏季日常服装");

    expect(
      temporalVisualPromptBlock({
        text: "现在，请帮我画一个女孩走在街边",
        currentDate: "2026-07-15",
      })
    ).toBeNull();
  });

  it("lets an explicit season override the current calendar", () => {
    const block = temporalVisualPromptBlock({
      text: "冬天，一个女孩在车站等人",
      currentDate: "2026-07-15",
    });

    expect(block).toContain("冬季");
    expect(block).toContain("保暖分层");
    expect(block).not.toContain("夏季日常服装");
  });

  it("preserves explicitly stated clothing instead of replacing it", () => {
    const block = temporalVisualPromptBlock({
      text: "现在是夏天，她穿着一件旧羊毛大衣",
      currentDate: "2026-07-15",
    });

    expect(block).toContain("原文已经明确服装");
    expect(block).not.toContain("轻薄透气");
  });

  it("lets reference-image wardrobe outrank seasonal inference", () => {
    const block = temporalVisualPromptBlock({
      text: "现在，一个女孩站在街边",
      currentDate: "2026-07-15",
      preserveVisibleWardrobe: true,
    });

    expect(block).toContain("以参考画面中的可见事实为准");
    expect(block).not.toContain("轻薄透气");
  });

  it("adds observable decade color and material guidance without artist names", () => {
    const block = temporalVisualPromptBlock({
      text: "1990年代南方县城的一间旧厨房",
      currentDate: "2026-07-15",
    });

    expect(block).toContain("1990年代");
    expect(block).toContain("轻微褪色的暖色");
    expect(block).toContain("室内荧光的微冷色偏");
    expect(block).not.toMatch(/博纳尔|维亚尔|常玉|Seurat|吴冠中/);
  });

  it("derives decade guidance from a specific year", () => {
    const block = temporalVisualPromptBlock({
      text: "故事发生在1997年，两个朋友在县城车站告别",
      currentDate: "2026-07-15",
    });

    expect(block).toContain("明确年代：1997年");
    expect(block).toContain("轻微褪色的暖色");
    expect(block).toContain("模拟胶片材料关系");
  });

  it("does not turn a rejected era or season into positive guidance", () => {
    const block = temporalVisualPromptBlock({
      text: "不要1990年代感，也不要夏天，改成秋天的两个朋友",
      currentDate: "2026-07-15",
    });

    expect(block).not.toContain("明确年代：1990年代");
    expect(block).not.toContain("明确季节：夏季");
    expect(block).toContain("明确季节：秋季");
    expect(block).toContain("秋季日常服装");
  });

  it("does not invent clothing when no person is present", () => {
    const block = temporalVisualPromptBlock({
      text: "现在的夏天，空旷海面上只有云和风",
      currentDate: "2026-07-15",
    });

    expect(block).toContain("用环境、光线与材质表现夏季");
    expect(block).not.toContain("夏季日常服装");
  });

  it("does not treat the character in 'other' as a person", () => {
    const block = temporalVisualPromptBlock({
      text: "现在，海面上只有其他漂浮物",
      currentDate: "2026-07-15",
    });

    expect(block).toContain("不要凭空添加人物");
    expect(block).not.toContain("夏季日常服装");
  });
});
