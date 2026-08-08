import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PublishingVideoHandoffBannerView } from "./PublishingVideoHandoffBanner";

vi.stubGlobal("React", React);

describe("PublishingVideoHandoffBannerView", () => {
  it("shows upstream material and asks for a video goal without generating anything", () => {
    const html = renderToStaticMarkup(
      <PublishingVideoHandoffBannerView
        handoff={{
          storyId: 17,
          versionId: "v1",
          containerRevision: 0,
          versionRevision: 1,
          sourcePlatform: "x",
          core: null,
          draft: { title: "标题", body: "正文", tags: [] },
          cover: { id: 9, imageUrl: "/cover.png", imageKey: null },
          needsReview: true,
          narrationCandidates: [
            {
              id: "n1",
              kind: "narration",
              text: "正文",
              sourcePlatform: "x",
              sourceParagraphIndex: 0,
            },
          ],
          dialogueCandidates: [],
        }}
        onDismiss={vi.fn()}
      />
    );

    expect(html).toContain("从 X 文字稿继续");
    expect(html).toContain("当前稿建议先复核");
    expect(html).toContain("1 段旁白候选");
    expect(html).toContain("0 句台词候选");
    expect(html).toContain("想把它做成什么视频？");
    expect(html).toContain('aria-label="收起文字稿交接"');
  });
});
