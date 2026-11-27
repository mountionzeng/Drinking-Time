import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { emptyBookWorkflow } from "@shared/bookWorkflow";
import { manuscriptChoices } from "./ManuscriptComparison";
import { VideoBookHistory } from "./VideoBookHistory";
vi.stubGlobal("React", React);
it("shows a failed video request honestly without presenting it as a text version", () => {
  const state = emptyBookWorkflow();
  state.conversions.push({
    id: "draft",
    source: { kind: "video", id: "film", number: 2, timelineVersion: 2 },
    target: "text",
    request: "写成介绍",
    author: { userId: 1, name: "作者" },
    intent: { purpose: "介绍", audience: "朋友", platform: "书" },
    createdAt: 1,
    status: "failed",
    error: "LLM submission outcome unknown; reconciliation required",
    revision: 2,
    sourceFingerprint: "x",
    targetFingerprint: "y",
  });
  const html = renderToStaticMarkup(
    <VideoBookHistory state={state} kind="text" storyId={1} working={[]} />
  );
  expect(html).toContain("上次结果和费用待核对");
  expect(html).toContain("视频 V2");
  expect(html).not.toContain("文字版 V2");
});
it("makes adopted text versions readable with the video source and actual content", () => {
  const state = emptyBookWorkflow();
  state.versions.push({
    id: "v1",
    kind: "text",
    number: 1,
    name: "稿",
    createdAt: 1,
    intent: { purpose: "原片", audience: "自己", platform: "书" },
    author: { userId: 1, name: "作者" },
    confirmedBy: { userId: 1, name: "作者" },
    aiAssisted: true,
    summary: "保留原文",
    source: { kind: "video", id: "film", number: 2, timelineVersion: 2 },
    fingerprint: "x",
    chapters: [
      {
        title: "拾光",
        layout: null,
        blocks: {
          body: "视频里的真实文字。",
          blockIds: [],
          containsAiText: true,
          settings: null,
          coverKey: null,
          bodyTextureKey: null,
          images: {},
          illustrations: [],
        },
      },
    ],
  });
  const saved = state.versions[0];
  state.versions.push({ ...saved, id: "other-edition", kind: "storyboard" }, { ...saved, id: "v2", number: 2 });
  const html = renderToStaticMarkup(
    <VideoBookHistory state={state} kind="text" storyId={1} working={saved.chapters} />
  );
  expect(html).toContain("打开对比 · 文字版 V1");
  expect(html).toContain("打开对比 · 文字版 V2");
  expect(html).not.toContain("打开对比 · 分镜版");
  expect(html).toContain("文字版 V1");
  expect(html).toContain("视频 V2");
  expect(html).toContain("视频里的真实文字。");
  const nextChapter = { ...saved.chapters[0], title: "第二章" };
  saved.chapters.push(nextChapter);
  const trial = {
    id: "scoped", target: "text" as const, status: "review" as const,
    source: { id: "prev", kind: "text" as const, number: 1 }, author: saved.author, intent: saved.intent,
    request: "修改第二章", createdAt: 2, revision: 1, sourceFingerprint: "old", targetFingerprint: saved.fingerprint,
    chapters: [{ ...nextChapter, title: "新的第二章" }], revisedChapters: [{ id: 55, index: 1 }],
  };
  state.conversions.push(trial, { ...trial, id: "missing-base", targetFingerprint: "unknown" }, { ...trial, id:"failed", status: "failed" });
  const choices = manuscriptChoices(state, "text", "文字版", "已保存试稿");
  expect(choices.find(v => v.id === trial.id)?.chapters.map(c => c.title)).toEqual(["拾光", "新的第二章"]);
  expect(choices.find(v => v.id === "missing-base")).toMatchObject({ partial: true, chapters: trial.chapters });
  expect(choices.some(v => v.id === "failed")).toBe(false);
  expect(saved.chapters[1].title).toBe("第二章");
});
