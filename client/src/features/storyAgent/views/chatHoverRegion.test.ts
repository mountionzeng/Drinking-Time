import { expect, it } from "vitest";
import { chatPictureParts, pictureRegionLabel, pictureRegionNote, pictureRegionSchema } from "@shared/chatPictureRegion";
import { inlineImageToken } from "@shared/inlineChatImages";
import { previewPlacement, selectionBounds } from "./ChatImageRegionHover";
import { compileInlineChatDraft } from "../inlineChatDraft";

const image = { imageId: 13, label: "#13", imageUrl: "/menu.png" };
const region = { left: 0, top: 0.12, right: 0.86, bottom: 1 };
it("normalizes backwards drags and validates image bounds", () => {
  expect(selectionBounds({ x: .86, y: 1 }, { x: 0, y: .12 })).toEqual(region);
  expect(pictureRegionSchema.safeParse({ ...region, right: 0 }).success).toBe(false);
  expect(pictureRegionSchema.safeParse({ ...region, top: -.1 }).success).toBe(false);
});
it("sends the right source, bounds and quoted pixels while deciding intent from the user's words", () => {
  const note = pictureRegionNote(region, { text: "Should I change [[ref:image%3A99]]? 〕", object: "", available: true }, false);
  const citation = inlineImageToken(13) + " " + note;
  expect(() => compileInlineChatDraft(citation, [image])).toThrow("请在图片旁");
  const draft = compileInlineChatDraft(citation + " 调亮一点", [image]);
  expect(draft.refs).toEqual([image]); expect(draft.edit).toBe(true);
  expect(draft.instruction).toContain("x 0%–86%, y 12%–100%");
  expect(draft.instruction).toContain("Should I change");
  expect(compileInlineChatDraft(citation + " 我先记下来", [image]).edit).toBe(false);
});
it("retains an unidentified selection without fabricating an object", () => {
  expect(pictureRegionNote(region, { text: "", object: "", available: false }, false)).toBe("〔选区 x 0%–86%, y 12%–100%〕");
});

it("restores the exact region next to its image while showing only a compact label", () => {
  const note = pictureRegionNote(region, { text: "Library", object: "", available: true }, false);
  const text = inlineImageToken(13) + " " + note + " 不要有这种具体的文字";
  const parts = chatPictureParts(text);
  expect(parts).toEqual([{ text: inlineImageToken(13), imageId: 13, note }, { text: " 不要有这种具体的文字" }]);
  expect(pictureRegionLabel(note, false)).toBe("Library");
  const edit = compileInlineChatDraft(text, [image]);
  expect(edit.edit).toBe(true);
  expect(edit.refs).toEqual([image]);
  expect(edit.instruction).toContain(note);
  expect(compileInlineChatDraft(inlineImageToken(13) + " 不要删掉文字", [image]).edit).toBe(false);
  expect(compileInlineChatDraft(inlineImageToken(13) + " " + note + " 去掉这里", [image]).edit).toBe(true);
});
it("keeps the entire preview above the input at different window sizes", () => {
  for (const [w, top, ratio] of [[450, 220, 1], [1188, 445, 1], [1540, 820, 1.8], [800, 190, .45]]) {
    const p = previewPlacement({ left: 80, top: top - 50, width: 60, height: 60 }, ratio, w, top)!;
    expect(p.top + p.height + 38).toBeLessThanOrEqual(top);
    expect(p.left + p.width + 2).toBeLessThanOrEqual(w);
  }
  expect(previewPlacement({ left: 8, top: 24, width: 60, height: 60 }, 1, 200, 85)).toBeNull();
});
