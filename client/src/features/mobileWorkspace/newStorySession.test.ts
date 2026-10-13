import { describe, expect, it } from "vitest";
import {
  canStartAnotherStory,
  emptyNewStorySession,
  newStorySessionKey,
  readNewStorySession,
} from "./newStorySession";
import { BIRD_GESTURES, nextBirdGesture } from "./xiaoyiGestures";
describe("independent new story session", () => {
  it("does not select a viewed story when no new conversation exists", () => {
    expect(readNewStorySession(null, 5)).toEqual({ storyId: null, draft: "" });
  });
  it("restores only the current account conversation and unsent words", () => {
    const store = new Map([
      [
        newStorySessionKey(5),
        JSON.stringify({ storyId: 83, draft: "没有发出的字" }),
      ],
    ]);
    const storage = { getItem: (key: string) => store.get(key) ?? null };
    expect(readNewStorySession(storage, 5)).toEqual({
      storyId: 83,
      draft: "没有发出的字",
    });
    expect(readNewStorySession(storage, 6)).toEqual(emptyNewStorySession());
  });
  it.each([
    "{bad",
    "null",
    '{"storyId":-1,"draft":"x"}',
    '{"storyId":"9","draft":"x"}',
  ])("rejects invalid saved state %s", value => {
    expect(readNewStorySession({ getItem: () => value }, 5)).toEqual(
      emptyNewStorySession()
    );
  });
  it("keeps working when storage is denied", () => {
    expect(
      readNewStorySession(
        {
          getItem: () => {
            throw Error("denied");
          },
        },
        5
      )
    ).toEqual(emptyNewStorySession());
  });
  it("cannot reset a sending, unsynced, or unsent story", () => {
    expect(
      canStartAnotherStory({ busy: true, unsynced: false, draft: "" })
    ).toBe(false);
    expect(
      canStartAnotherStory({ busy: false, unsynced: true, draft: "" })
    ).toBe(false);
    expect(
      canStartAnotherStory({ busy: false, unsynced: false, draft: "还在写" })
    ).toBe(false);
    expect(
      canStartAnotherStory({ busy: false, unsynced: false, draft: "" })
    ).toBe(true);
  });
});
describe("bird gestures", () => {
  it("avoids immediate repetition and ends each gesture in the same resting pose", () => {
    for (let previous = 0; previous < BIRD_GESTURES.length; previous++) {
      for (const random of [0, 0.2, 0.6, 0.99])
        expect(nextBirdGesture(previous, () => random)).not.toBe(previous);
      expect(BIRD_GESTURES[previous].at(-1)?.[1]).toBe("turn");
    }
  });
});
