import { describe, expect, it } from "vitest";

import {
  recommendPublishingAlbumFonts,
  resolvePublishingAlbumFontChoice,
} from "./publishingAlbumFontRecommendation";

const repository = {
  async missingCharacters(fontId: string, text: string) {
    return text.includes("𠀀") && fontId !== "noto-sans-sc" ? ["𠀀"] : [];
  },
};

describe("publishing album font recommendation", () => {
  it("prefers readable serif faces for long quiet literary copy", async () => {
    const recommendations = await recommendPublishingAlbumFonts({
      text: "雨落在旧纸上。".repeat(20), role: "body",
      artDirectionTags: ["quiet", "paper", "painting", "literary"], repository,
    });
    expect(recommendations[0]?.fontId).toBe("noto-serif-sc");
    expect(recommendations[0]?.reason).toContain("长段正文可读性");
    expect(recommendations).toHaveLength(3);
  });

  it("prefers sans for modern mixed text and brush/script faces for short paths", async () => {
    const modern = await recommendPublishingAlbumFonts({
      text: "2026 Future / 新生活", role: "body",
      artDirectionTags: ["modern", "geometric", "minimal"], repository,
    });
    const inkPath = await recommendPublishingAlbumFonts({
      text: "向风而行", role: "path",
      artDirectionTags: ["ink", "handwritten", "free"], repository,
    });
    expect(modern[0]?.fontId).toBe("noto-sans-sc");
    expect(inkPath[0]?.fontId).toBe("zhi-mang-xing");
  });

  it("filters incomplete glyph coverage and never overwrites an installed saved choice", async () => {
    const recommendations = await recommendPublishingAlbumFonts({
      text: "生僻字𠀀", role: "title", artDirectionTags: ["ink"], repository,
    });
    expect(recommendations.map(item => item.fontId)).toEqual(["noto-sans-sc"]);
    expect(resolvePublishingAlbumFontChoice({
      savedFontId: "zcool-xiaowei", recommendations,
    })).toBe("zcool-xiaowei");
    expect(resolvePublishingAlbumFontChoice({
      savedFontId: "lxgw-wenkai", recommendations,
    })).toBe("noto-sans-sc");
  });
});
