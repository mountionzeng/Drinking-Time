import { describe, expect, it } from "vitest";

import {
  VIDEO_VISUAL_FIDELITY_CLAUSE_EN,
  withVideoVisualFidelity,
} from "./videoMotionPolicy";

describe("withVideoVisualFidelity", () => {
  it("preserves the authored motion and appends the source-frame contract", () => {
    const prompt = withVideoVisualFidelity(
      "The woman opens her arms while the camera cranes down."
    );

    expect(prompt).toContain("opens her arms");
    expect(prompt).toContain("object count and placement");
    expect(prompt).toContain("unless the shot instruction explicitly requests");
  });

  it("does not duplicate the fidelity contract", () => {
    const once = withVideoVisualFidelity("A restrained handheld drift.");
    const twice = withVideoVisualFidelity(once);

    expect(twice).toBe(once);
    expect(twice.split(VIDEO_VISUAL_FIDELITY_CLAUSE_EN)).toHaveLength(2);
  });
});
