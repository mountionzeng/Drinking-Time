import { describe, expect, it } from "vitest";
import { appendVisualProductionBrief, parseVisualProductionChat, usesSelectedImageRevision } from "./visualProductionChat";

describe("visual production chat", () => {
  it("treats quoted English as image content, never as adopting the current image", () => {
    expect(parseVisualProductionChat('修改这张图片：脸明亮一些，恢复英文 it cannot replace that moment you feel for yourself.')?.kind).toBe("brief");
    expect(parseVisualProductionChat('修改这张图片：对话框写 Place a cup in the world.')?.kind).toBe("brief");
    expect(parseVisualProductionChat('place this image on the timeline')?.kind).toBe("adopt");
  });
  it("saves motion beats independently of paid generation", () => {
    expect(parseVisualProductionChat("修改第01镜的视频要求：黑暗中放下茶杯，世界亮起，微像素迸发再组合。先保存，不生成视频。"))
      .toMatchObject({kind:"brief", briefField:"videoPrompt", shotCode:"01"});
    expect(parseVisualProductionChat("不要修改视频要求")).toBeNull();
  });
  it("keeps a visual brief with subtitle and negative constraints in the image workflow", () => {
    expect(parseVisualProductionChat("修改第02镜的图片要求：沿用图片 #2038 的色调，文字沿用现有字幕轨，不生成额外英文。"))
      .toMatchObject({ kind: "brief", briefField: "promptDraft", shotCode: "02", imageId: 2038 });
    expect(parseVisualProductionChat("不要修改图片要求")).toBeNull();
    expect(parseVisualProductionChat("把背景音乐改小")).toBeNull();
    expect(parseVisualProductionChat("背景音乐小一点")).toBeNull();
  });
  it("routes a background change to the exact image revision, without intercepting adoption, masks or questions", () => {
    const selected = { sourceType: "storyboard-image", imageId: 2019 };
    expect(usesSelectedImageRevision(parseVisualProductionChat("修改这张图片：周围黑灰背景改成彩色细腻像素，主体保持原样"), selected)).toBe(true);
    expect(usesSelectedImageRevision(parseVisualProductionChat("生成图片"), selected)).toBe(true);
    for (const text of ["采用这张图片", "生成视频", "怎么生成图片", "不要生成图片", "第02镜生成图片"]) {
      expect(usesSelectedImageRevision(parseVisualProductionChat(text), selected)).toBe(false);
    }
    expect(usesSelectedImageRevision(parseVisualProductionChat("画面改成水墨"), { ...selected, selection: { kind: "rectangle" } })).toBe(false);
  });
  it.each(["我希望画面是细腻彩色像素的世界，整体极简", "把画面改成水墨留白", "I want an oil painting style", "调整成纸雕的视觉风格"])("stores arbitrary art direction without buying media: %s", text => {
    expect(parseVisualProductionChat(text)?.kind).toBe("brief");
    expect(appendVisualProductionBrief("原要求", text)).toContain(text);
  });
  it.each(["不要生成图片", "先不生成视频", "怎么生成图片", "do not generate an image", "how do I render a video?"])("does not execute discussion or negation: %s", text => {
    expect(parseVisualProductionChat(text)).toBeNull();
  });
  it("distinguishes generation, adoption and destination without interpreting style", () => {
    expect(parseVisualProductionChat("第 02 镜生成图片" )).toMatchObject({ kind: "image", shotCode: "02" });
    expect(parseVisualProductionChat("渲染当前镜头的视频" )).toMatchObject({ kind: "video" });
    expect(parseVisualProductionChat("采用图片 #42，放入时间线" )).toMatchObject({ kind: "adopt", imageId: 42, timeline: true });
    expect(parseVisualProductionChat("把视频 Take 19 放入剪辑线" )).toMatchObject({ kind: "adopt", takeId: 19, timeline: true });
    expect(parseVisualProductionChat("就用这张" )).toMatchObject({ kind: "adopt" });
    expect(parseVisualProductionChat("生成第2张图片")?.shotCode).toBeUndefined();
  });
  it("keeps previous directions and avoids duplicate appends", () => {
    const saved = appendVisualProductionBrief("小茶壶", "画面改成极简");
    expect(saved).toContain("小茶壶");
    expect(appendVisualProductionBrief(saved, "画面改成极简")).toBe(saved);
  });
});
