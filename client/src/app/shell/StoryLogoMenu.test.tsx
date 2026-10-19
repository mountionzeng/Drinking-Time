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
