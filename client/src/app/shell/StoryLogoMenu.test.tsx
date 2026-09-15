import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StoryMenuCover } from "./StoryLogoMenu";

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
