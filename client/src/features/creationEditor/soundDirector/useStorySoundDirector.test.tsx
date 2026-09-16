import { describe, expect, it } from "vitest";
import {
  isCurrentSoundDirectorStart,
  shouldRouteChatToSoundDirector,
} from "./useStorySoundDirector";

describe("sound director chat routing", () => {
  it("routes free text only while an active director question exists", () => {
    expect(
      shouldRouteChatToSoundDirector({
        active: true,
        hasQuestion: true,
        text: "温暖克制",
      })
    ).toBe(true);
    expect(
      shouldRouteChatToSoundDirector({
        active: false,
        hasQuestion: true,
        text: "温暖克制",
      })
    ).toBe(false);
    expect(
      shouldRouteChatToSoundDirector({
        active: true,
        hasQuestion: false,
        text: "普通聊天",
      })
    ).toBe(false);
  });

  it("rejects a late start response after the story or request changes", () => {
    expect(
      isCurrentSoundDirectorStart({
        requestId: 2,
        currentRequestId: 2,
        requestedStoryId: 11,
        currentStoryId: 11,
      })
    ).toBe(true);
    expect(
      isCurrentSoundDirectorStart({
        requestId: 1,
        currentRequestId: 2,
        requestedStoryId: 11,
        currentStoryId: 11,
      })
    ).toBe(false);
    expect(
      isCurrentSoundDirectorStart({
        requestId: 2,
        currentRequestId: 2,
        requestedStoryId: 11,
        currentStoryId: 12,
      })
    ).toBe(false);
  });
});
