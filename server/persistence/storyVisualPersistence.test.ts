import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getImage: vi.fn(),
  getStory: vi.fn(),
  getTimeline: vi.fn(),
  getTakes: vi.fn(),
  getRange: vi.fn(),
  saveAggregate: vi.fn(),
  saveTimeline: vi.fn(),
}));

vi.mock("../repositories/images", () => ({
  getGeneratedImageById: mocks.getImage,
}));
vi.mock("../repositories/stories", () => ({
  getStoryById: mocks.getStory,
}));
vi.mock("../repositories/timelines", () => ({
  getStoryTimeline: mocks.getTimeline,
  updateStoryAndTimelineAtomic: mocks.saveAggregate,
  updateStoryTimeline: mocks.saveTimeline,
}));
vi.mock("../repositories/videos", () => ({
  getStoryVideoTakes: mocks.getTakes,
  getVideoTakeRangeById: mocks.getRange,
}));

import { loadOwnedStory } from "./storyVisualPersistence";

describe("story visual persistence boundaries", () => {
  beforeEach(() => vi.clearAllMocks());

  it("checks replay ownership without loading Timeline or media rows", async () => {
    const story = { id: 4, userId: 7, body: {} };
    mocks.getStory.mockResolvedValue(story);

    await expect(loadOwnedStory({ storyId: 4, userId: 7 })).resolves.toBe(
      story
    );

    expect(mocks.getStory).toHaveBeenCalledWith(4, 7);
    expect(mocks.getTimeline).not.toHaveBeenCalled();
    expect(mocks.getTakes).not.toHaveBeenCalled();
  });
});
