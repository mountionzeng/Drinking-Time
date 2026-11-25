import { expect, it } from "vitest";
import { expandShotDescriptions, structureShotDraft } from "../../shared/bookShotFormat";
import { readBookShotChapter, shotDirections } from "../../shared/bookShotDocument";
import { bookAudioText } from "../../shared/bookAudioBlock";
import { publishingArticleVideoRows } from "../../shared/publishingArticleVideo";
import { bookStoryboardModules } from "./bookStoryboardModules";
import { directBookStoryboardPreview } from "./directBookStoryboard";
import type { BookWritingStyle } from "../../shared/bookWritingStyle";

it("routes each root shot's instructions and references by identity across edits and reordering", () => {
  const row = (id: string, parentId: string | null = null, format: "shot" | "text" = "text"): BookWritingStyle[number] => ({ id, format, parentId, collapsed: false });
  const sound = bookAudioText(9, 7, "雨声", "sfx");
  const music = bookAudioText(9, 8, "全片音乐");
  const second = [[row("s2", null, "shot"), "雨停"], [row("rain", "s2"), sound]] as const;
  const first = [[row("s1", null, "shot"), "撑伞"], [row("photo", "s1"), "![图片](/api/images/umbrella.png)"],
    [{ ...row("voice", "s1"), videoRole: "dialogue" as const }, "音乐：我记得那天。"],
    [{ ...row("note", "s1"), lineCount: 2 }, "运镜提示词：固定镜头\n配乐：钢琴"]] as const;
  const global = [row("music"), music] as const;
  for (const entries of [[global, ...first, ...second], [global, ...second, ...first]] as const) {
    const chapter = { id: 9, blocks: { writingStyle: entries.map(([r]) => r), body: entries.map(([, text]) => text).join("\n") } };
    const doc = readBookShotChapter(chapter);
    const rows = publishingArticleVideoRows({ body: chapter.blocks.body, illustrations: [], bookScenes:
      bookStoryboardModules([chapter], [{ id: 12, imageUrl: "/api/images/umbrella.png" }]) });
    const video = directBookStoryboardPreview(rows, 1).shots;
    expect(video.map(s => s.draftShotId)).toEqual(doc.shots.map(s => s.id));
    const umbrella = video.find(s => s.draftShotId === "book-shot-9-s1");
    expect(umbrella).toMatchObject({ subject: "撑伞", voiceText: "音乐：我记得那天。", action: "运镜提示词：固定镜头",
      soundRequirement: "配乐：钢琴", referenceImageIds: [12], sourceModuleIds: ["9:s1", "9:photo", "9:voice", "9:note"] });
    expect(doc.shots.find(s => s.moduleId === "s2")?.audio.map(s => s.assetId)).toEqual([7]);
    expect(doc.wholeAudio.map(s => s.assetId)).toEqual([8]);
  }
});

it("keeps the setting of a legacy scene with its shots and shows its number on request", () => {
  const writingStyle: BookWritingStyle = [
    { id: "a", format: "scene", parentId: null, collapsed: true },
    { id: "b", format: "shot", parentId: "a", collapsed: false },
  ];
  const chapter = { id: 9, blocks: { writingStyle, body: "第一场｜清晨的车站\n雨伞" } };
  expect(readBookShotChapter(chapter).shots[0].notes).toBe("清晨的车站");
  expect(readBookShotChapter(chapter, true).shots[0].notes).toBe("第一场｜清晨的车站");
});

it("reads standalone production headings without interpreting free prose as a sound cue", () => {
  const sections = shotDirections("音乐盒在桌上。\n**画面提示词**\n桌上有一张纸。\n**音效提示词**\n风吹过书页。");
  expect(sections.other).toEqual(["音乐盒在桌上。"]);
  expect(sections.picture).toContain("桌上有一张纸。");
  expect(sections.sound).toContain("风吹过书页。");
});

it("promotes an old all-text trial without losing existing module IDs or reading its evidence aloud", () => {
  const lines = ["# 第 03 镜｜车站", "**旁白｜第 2 秒开口**", "我看见了。", "**出处与创作处理**", "笔记里写着：“下雨了。”"];
  const style: BookWritingStyle = lines.map((_, i) => ({ id: String(i), format: "text", parentId: null, collapsed: false }));
  const result = structureShotDraft(lines.join("\n"), style, () => "unused", "试稿")!;
  const doc = readBookShotChapter({ id: 4, blocks: result });
  expect(doc.shots[0]).toMatchObject({ title: "车站", dialogueText: "我看见了。", sourceModuleIds: lines.map((_, i) => "4:" + i) });
  expect(doc.shots[0].targets.source).toEqual({ moduleId: "4", offset: 0 });
  expect(structureShotDraft(result.body, result.writingStyle, () => "unused", "试稿")).toBeNull();
});

it("separates a compact heading's explicit voice and camera cue once and keeps its attached picture", () => {
  const original = "旁白（回忆）：「我记得那天。」画面切至窗外。";
  const style: BookWritingStyle = [{ id: "a", format: "shot", parentId: null, collapsed: true }, { id: "b", format: "text", parentId: "a", collapsed: false }];
  const draft = expandShotDescriptions(original + "\n![图片](/api/images/window.png)", style, () => crypto.randomUUID());
  const shot = readBookShotChapter({ id: 1, blocks: draft }).shots[0];
  expect(shot).toMatchObject({ id: "book-shot-1-a", dialogueText: "我记得那天。", images: [{ url: "/api/images/window.png" }] });
  expect(shotDirections(shot.notes).picture.join("\n")).toContain("画面切至窗外。");
  expect(expandShotDescriptions(draft.body, draft.writingStyle, () => crypto.randomUUID())).toEqual(draft);
});
