import { expect, it } from "vitest";
import { shotActionHeading, shotOutputSource } from "@shared/bookShotActions";
import { readBookShotChapter, shotDirections } from "@shared/bookShotDocument";
import { blockBody, newWritingBlock, restoreStyledBlocks, writingStyleOf } from "./chapterBlockTree";
import { setShotParagraphFormat, shotParagraphs } from "./bookShotParagraph";

const shot = { ...newWritingBlock("雨停"), format: "shot" as const };
const child = (text: string) => newWritingBlock(text, shot.id);

it("edits the format of a legacy heading through its body and reopens the same shot modules", () => {
  const words = "纸页上写着“声音设计：”几个字。";
  const rows = [shot, child("**画面提示词**"), child(words), child("**音效提示词**"), child("滴水声。")];
  expect(shotParagraphs(rows).get(rows[2].id)).toEqual({ start: 1, output: "image" });
  const saved = setShotParagraphFormat(rows, 2, "subtitle");
  expect(saved.map(r => r.text)).toEqual(["雨停", "字幕", words, "**音效提示词**", "滴水声。"]);
  const restored = restoreStyledBlocks(blockBody(saved), writingStyleOf(saved));
  expect(restored.map(r => r.id)).toEqual(rows.map(r => r.id));
  expect(shotOutputSource(restored, 1, "subtitle")?.prompt).toBe(words);
  expect(shotOutputSource(restored, 3, "sfx")?.prompt).toBe("滴水声。");
  const sheet = shotDirections(readBookShotChapter({ id: 1, blocks: { body: blockBody(saved), writingStyle: writingStyleOf(saved) } }).shots[0].notes);
  expect(sheet.subtitle).toEqual([words]);
});

it("keeps quoted text, emphasis and timing and safely reclassifies a spoken continuation", () => {
  const rows = [shot, child("**旁白｜第 2 秒开口，第 7 秒前收住**"), { ...child("音乐：这是我的原话。"), videoRole: "dialogue" as const }, child("出处：手记")];
  const saved = setShotParagraphFormat(rows, 2, "subtitle");
  expect(saved[1].text).toBe("字幕｜第 2 秒开口，第 7 秒前收住");
  expect(shotActionHeading(saved[2].text)?.inline).toBe(rows[2].text);
  expect(shotOutputSource(saved, 1, "subtitle")?.prompt).toBe(rows[2].text);
  expect(saved[2].videoRole).toBeUndefined();
  expect(saved[3]).toBe(rows[3]);
  for (const [raw, body] of [
    ["画面与素材：**画面提示词：**纸上写着“画面提示词：**天空**”。", "纸上写着“画面提示词：**天空**”。"],
    ["**声音设计**\n**音效提示词**\n风吹纸页。", "风吹纸页。"],
    ["**音效提示词**\n雨声。\n\n又一声。", "雨声。\n\n又一声。"],
  ]) {
    const field = shotActionHeading(raw)!;
    expect(raw.slice(field.prefix.length)).toBe(body);
    expect(field.inline).toBe(body);
  }
});

it("changes one selected paragraph without carrying its new format into adjacent prose", () => {
  const rows = [shot, child("画面描述：窗边的灯"), child("清晨的街道。"), child("丝绸的光泽。")];
  const changed = setShotParagraphFormat(rows, 2, "subtitle");
  expect(changed.map(r => r.text)).toEqual(["雨停", "画面描述：窗边的灯", "字幕：清晨的街道。", "画面描述：丝绸的光泽。"]);
  expect(shotOutputSource(changed, 2, "subtitle")?.prompt).toBe("清晨的街道。");
});

it("changes only the leading field of an inline mixed module and never the next shot", () => {
  const rows = [shot, child("画面提示词：窗边的灯\n声音设计：风声"), {...newWritingBlock("窗外"),format:"shot" as const}, newWritingBlock("云")];
  const changed = setShotParagraphFormat(rows, 1, "video");
  expect(changed[1].text).toBe("视频：窗边的灯\n声音设计：风声");
  expect(shotOutputSource(changed,0,"sfx")?.prompt).toBe("风声");
  expect(shotParagraphs(changed).get(rows[3].id)).toBeUndefined();
});
