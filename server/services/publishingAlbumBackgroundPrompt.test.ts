import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  getActiveStyles: vi.fn(),
  getRecentRejectionSignals: vi.fn(async () => []),
  getRecentEditPreferences: vi.fn(async () => []),
  getRecentChatCorrections: vi.fn(async () => []),
}));

import {
  compilePublishingAlbumBackgroundPrompt,
  composePublishingAlbumBackgroundBrief,
  publishingAlbumFontTagsFromCoverPrompt,
} from "./publishingAlbumBackgroundPrompt";

describe("publishing album background prompt", () => {
  it("turns page copy into a no-text visual brief with natural quiet space", () => {
    const prompt = composePublishingAlbumBackgroundBrief({
      pageText: "她终于把旧钥匙放回桌上，决定离开。",
      pageOrdinal: 2,
      pageCount: 5,
    });
    expect(prompt).toContain("第 2/5 页");
    expect(prompt).toContain("低细节");
    expect(prompt).toContain("不得出现任何中文");
    expect(prompt).not.toContain("当前镜头");
    expect(prompt).not.toContain("相邻镜头");
  });

  it("inherits cover art DNA while redesigning composition through the render gate", async () => {
    const compiled = await compilePublishingAlbumBackgroundPrompt({
      pageText: "雨停后，她独自穿过院子。",
      pageOrdinal: 1,
      pageCount: 3,
      coverPrompt: [
        "【艺术谱系】木刻与水墨的克制线条。",
        "【手作完成度】保留纸纤维与干刷。",
        "【静态图片无字硬约束】禁止任何文字。",
        "【封面产品约束】这里不应被继承。",
      ].join("\n"),
      feedback: "安静一点",
      storyId: 7,
    });
    expect(compiled.prompt).toContain("木刻与水墨");
    expect(compiled.prompt).toContain("重新设计");
    expect(compiled.prompt).toContain("画册底图产品约束");
    expect(compiled.prompt).toContain("安静一点");
    expect(compiled.prompt).not.toContain("【封面产品约束】");
    expect(compiled.artDirectionHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("blocks generation when the adopted cover has no reusable art direction", async () => {
    await expect(compilePublishingAlbumBackgroundPrompt({
      pageText: "正文",
      pageOrdinal: 1,
      pageCount: 1,
      coverPrompt: "ordinary legacy prompt",
    })).rejects.toThrow("没有可继承的美术方向");
  });

  it("maps the adopted cover art DNA to font recommendation signals", () => {
    expect(publishingAlbumFontTagsFromCoverPrompt([
      "【艺术谱系】克制的水墨与手写笔触。",
      "【手作完成度】保留宣纸纤维和大面积安静留白。",
    ].join("\n"))).toEqual(expect.arrayContaining([
      "ink", "painting", "paper", "handwritten", "quiet", "minimal",
    ]));
  });
});
