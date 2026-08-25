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

vi.mock("../db", () => ({
  getGeneratedImageById: mocks.getImage,
  getStoryById: mocks.getStory,
  getStoryTimeline: mocks.getTimeline,
  getStoryVideoTakes: mocks.getTakes,
  getVideoTakeRangeById: mocks.getRange,
  updateStoryAndTimelineAtomic: mocks.saveAggregate,
  updateStoryTimeline: mocks.saveTimeline,
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
