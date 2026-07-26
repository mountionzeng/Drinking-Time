import { describe, expect, it } from "vitest";
import { EDITING_ACTION_CAPABILITIES } from "./editingActionCapabilities";

describe("editing action capabilities", () => {
  it("keeps action ids unique and all mutating actions reversible", () => {
    const ids = EDITING_ACTION_CAPABILITIES.map(capability => capability.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      EDITING_ACTION_CAPABILITIES.filter(capability =>
        capability.id.startsWith("transition.")
      )
    ).toHaveLength(1);
    expect(
      EDITING_ACTION_CAPABILITIES.filter(
        capability =>
          !capability.id.startsWith("transition.") &&
          capability.id !== "timeline.undo"
      ).every(capability => capability.reversible)
    ).toBe(true);
  });
});
