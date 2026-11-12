import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { emptyBookWorkflow } from "@shared/bookWorkflow";
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
    <VideoBookHistory state={state} kind="text" storyId={1} />
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
  const html = renderToStaticMarkup(
    <VideoBookHistory state={state} kind="text" storyId={1} />
  );
  expect(html).toContain("文字版 V1");
  expect(html).toContain("视频 V2");
  expect(html).toContain("视频里的真实文字。");
});
