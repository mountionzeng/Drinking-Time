import { describe, expect, it } from "vitest";
import { isPersistedStoryId } from "./persistedStoryId";

describe("isPersistedStoryId", () => {
  it("rejects draft, empty and invalid ids", () => {
    for (const id of [-1, 0, null, undefined, 1.5, Number.NaN]) expect(isPersistedStoryId(id)).toBe(false);
  });
  it("accepts persisted ids", () => {
    expect(isPersistedStoryId(123)).toBe(true);
  });
});
