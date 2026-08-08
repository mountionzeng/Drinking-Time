import { describe, expect, it } from "vitest";
import {
  shouldAnnounceVideoGenerationCancellation,
  STORYBOARD_CONTINUITY_REQUEST_INTERRUPTED,
} from "./storyboardReviewModel";

describe("storyboard continuity resolution", () => {
  it("only announces a cancellation when the user explicitly cancels", () => {
    expect(shouldAnnounceVideoGenerationCancellation(null)).toBe(true);
    expect(
      shouldAnnounceVideoGenerationCancellation(
        STORYBOARD_CONTINUITY_REQUEST_INTERRUPTED
      )
    ).toBe(false);
  });
});
