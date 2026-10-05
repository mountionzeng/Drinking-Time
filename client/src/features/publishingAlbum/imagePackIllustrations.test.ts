import { describe, expect, it } from "vitest";
import { imagePackParagraphs, readIllustrationPlacements, resolveIllustrationOffset } from "./imagePackIllustrations";

describe("text-anchored illustration positions", () => {
  it("normalizes line endings and follows a paragraph when preceding text changes or moves", () => {
    const [first, target] = imagePackParagraphs("开头\r\n\r\n  目标👩‍👧  \r\n末尾");
    expect(first.end).toBe(4);
    const moved = imagePackParagraphs("新的开头\n增加内容\n目标👩‍👧\n末尾");
    expect(resolveIllustrationOffset(moved, target.anchor)).toBe(moved[2].end);
    expect(resolveIllustrationOffset(imagePackParagraphs("目标👩‍👧\n开头"), target.anchor)).toBe(imagePackParagraphs("目标👩‍👧\n开头")[0].end);
    expect(resolveIllustrationOffset(moved, null)).toBe(0);
    expect(resolveIllustrationOffset(imagePackParagraphs("目标改变了"), target.anchor)).toBeNull();
  });

  it("distinguishes repeated paragraphs and requires relocation when repetition becomes ambiguous", () => {
    const paragraphs = imagePackParagraphs("重复\n中间\n重复");
    expect(resolveIllustrationOffset(paragraphs, paragraphs[0].anchor)).toBe(3);
    expect(resolveIllustrationOffset(paragraphs, paragraphs[2].anchor)).toBe(8);
    expect(resolveIllustrationOffset(imagePackParagraphs("重复\n中间"), paragraphs[0].anchor)).toBeNull();
  });

  it("migrates old selections without guessing a text position for the middle-page setting", () => {
    expect(readIllustrationPlacements({ illustrationId: 7, illustrationPosition: "above" })).toEqual([{ assetId: 7, after: null }]);
    const [legacy] = readIllustrationPlacements({ illustrationId: 8, illustrationPosition: "middle" });
    expect(legacy.assetId).toBe(8);
    expect(resolveIllustrationOffset(imagePackParagraphs("正文"), legacy.after)).toBeNull();
    expect(readIllustrationPlacements({ illustrationId: 7, illustrations: [] })).toEqual([]);
  });

  it("round-trips multiple positions and keeps malformed anchors visible for repair", () => {
    const placements = [{ assetId: 1, after: null }, { assetId: 2, after: imagePackParagraphs("原文")[0].anchor }];
    expect(readIllustrationPlacements(JSON.parse(JSON.stringify({ illustrations: placements })))).toEqual(placements);
    const sanitized = readIllustrationPlacements({ illustrations: [...placements, placements[0], null, { assetId: "3" }, { assetId: 4, after: {} }] });
    expect(sanitized.map(item => item.assetId)).toEqual([1, 2, 4]);
    expect(resolveIllustrationOffset([], sanitized[2].after)).toBeNull();
  });
});
