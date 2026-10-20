import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MobileStoriesPage } from "./MobileStoriesPage";

vi.stubGlobal("React", React);
vi.mock("@/lib/trpc", () => ({ trpc: {} }));

const notice = {
  id: "layout:42:c-1",
  storyId: 42,
  storyTitle: "秋天的茶",
  kind: "layout" as const,
  authorName: "小周",
  createdAt: 1_760_918_400_000,
};

const render = (unread: ReadonlySet<string>) =>
  renderToStaticMarkup(
    <MobileStoriesPage
      stories={[]}
      activeStoryId={null}
      onOpenMe={() => {}}
      onSelectStory={() => {}}
      onOpenStage={() => {}}
      shareBacks={[notice]}
      unreadShareBackIds={unread}
    />
  );

describe("MobileStoriesPage share-back card", () => {
  it("shows who shared back which story, with a dot while unread", () => {
    const html = render(new Set([notice.id]));
    expect(html).toContain("朋友分享回来的");
    expect(html).toContain("小周 分享回了排版");
    expect(html).toContain("秋天的茶");
    expect(html).toContain("data-share-back-unread");
  });

  it("keeps the card but drops the dot after it was seen", () => {
    const html = render(new Set());
    expect(html).toContain("小周 分享回了排版");
    expect(html).not.toContain("data-share-back-unread");
  });

  it("renders nothing extra when no friend shared back", () => {
    const html = renderToStaticMarkup(
      <MobileStoriesPage stories={[]} activeStoryId={null} onOpenMe={() => {}}
        onSelectStory={() => {}} onOpenStage={() => {}} />
    );
    expect(html).not.toContain("朋友分享回来的");
  });
});
