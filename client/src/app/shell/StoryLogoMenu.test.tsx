import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import StoryLogoMenu, { StoryMenuCover } from "./StoryLogoMenu";

vi.stubGlobal("React", React);

vi.mock("@/features/nayin/views/EmotiveWuxingIcon", () => ({
  default: () => <span data-testid="drink" />,
}));

describe("StoryLogoMenu covers", () => {
  const story = {
    id: 42,
    title: "有封面的故事",
    coverImageUrl: "/api/images/cover-42.jpg",
  };

  it("shows story covers in the Shiguang menu", () => {
    const html = renderToStaticMarkup(
      <StoryMenuCover visualTheme="shiguang" story={story} />
    );

    expect(html).toContain("/api/images/cover-42.jpg");
    expect(html).toContain("story-cover-thumbnail");
  });

  it("keeps the Nayin story menu text-only", () => {
    const html = renderToStaticMarkup(
      <StoryMenuCover visualTheme="nayin" story={story} />
    );

    expect(html).not.toContain("/api/images/cover-42.jpg");
  });
});

it("uses the composer character as the menu trigger without a second logo", () => {
  const html = renderToStaticMarkup(<StoryLogoMenu element="water" visualTheme="shiguang"
    onNewStory={() => {}} placement="top" trigger={<span>existing companion</span>} />);
  expect(html).toContain("existing companion");
  expect(html).toContain('aria-haspopup="menu"');
  expect(html).toContain('data-tour="story-menu"');
  expect(html).not.toContain("nav-materials-v2.png");
});

describe("StoryLogoMenu share-back reminder", () => {
  const notice = {
    id: "text:42:v-2",
    storyId: 42,
    storyTitle: "海边",
    kind: "text" as const,
    authorName: "小周",
    createdAt: 1_760_918_400_000,
  };

  it("shows a red dot and tells screen readers when friends shared back", () => {
    const html = renderToStaticMarkup(<StoryLogoMenu element="water" visualTheme="shiguang"
      onNewStory={() => {}} shareBacks={[notice]} unreadShareBacks={1} />);
    expect(html).toContain("data-share-back-dot");
    expect(html).toContain("1 个朋友分享回来的新版本");
  });

  it("stays quiet once the reminder has been seen", () => {
    const html = renderToStaticMarkup(<StoryLogoMenu element="water" visualTheme="shiguang"
      onNewStory={() => {}} shareBacks={[notice]} unreadShareBacks={0} />);
    expect(html).not.toContain("data-share-back-dot");
    expect(html).not.toContain("朋友分享回来的新版本");
  });
});
