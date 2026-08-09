import { describe, expect, it } from "vitest";
import {
  isStoryboardMediaSelected,
  storyboardMediaSelection,
  storyboardMediaSelectionKey,
  storyboardMediaShotExpanded,
} from "./storyboardMediaSelection";

describe("storyboard media selection", () => {
  it("selects only the exact image, video, or candidate in a shot", () => {
    const selected = storyboardMediaSelection({
      shotIdentity: "shot-02",
      kind: "candidate",
      id: "42:bottom-right",
    });

    expect(
      isStoryboardMediaSelected(selected, {
        shotIdentity: "shot-02",
        kind: "candidate",
        id: "42:bottom-right",
      })
    ).toBe(true);
    expect(
      isStoryboardMediaSelected(selected, {
        shotIdentity: "shot-02",
        kind: "candidate",
        id: "42:top-left",
      })
    ).toBe(false);
    expect(
      isStoryboardMediaSelected(selected, {
        shotIdentity: "shot-02",
        kind: "image",
        id: 42,
      })
    ).toBe(false);
  });

  it("gives every media kind a stable, non-colliding key", () => {
    expect(
      storyboardMediaSelectionKey({
        shotIdentity: "shot-07",
        kind: "image",
        id: 8,
      })
    ).toBe("shot-07:image:8");
    expect(
      storyboardMediaSelectionKey({
        shotIdentity: "shot-07",
        kind: "video",
        id: 8,
      })
    ).toBe("shot-07:video:8");
  });

  it("expands only the shot that owns the selected media", () => {
    const selected = storyboardMediaSelection({
      shotIdentity: "shot-03",
      kind: "video",
      id: "take-19",
    });

    expect(storyboardMediaShotExpanded(selected, "shot-03")).toBe(true);
    expect(storyboardMediaShotExpanded(selected, "shot-04")).toBe(false);
    expect(storyboardMediaShotExpanded(null, "shot-03")).toBe(false);
  });
});
