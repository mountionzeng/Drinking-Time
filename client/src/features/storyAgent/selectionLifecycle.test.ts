import { describe, expect, it } from "vitest";
import {
  selectionContentFingerprint,
  type SelectionContext,
} from "@shared/selectionContext";
import {
  activeSelectionReadiness,
  consumeSubmittedSelection,
  executableSelection,
  sameSelection,
} from "./selectionLifecycle";

function textSelection(sourceId: string): SelectionContext {
  const fullText = "甲乙丙";
  return {
    sourceType: "card",
    sourceId,
    selectedText: "乙",
    fullText,
    storyId: 3,
    objectVersion: "story:1",
    contentFingerprint: selectionContentFingerprint(fullText),
    selection: { kind: "text", start: 1, end: 2 },
  };
}

describe("selection lifecycle", () => {
  it("exposes only fresh executable selections", () => {
    const selection = textSelection("card-a");
    expect(executableSelection(selection, 3)).toBe(selection);
    expect(executableSelection(selection, 4)).toBeNull();
    expect(activeSelectionReadiness(selection, 4)).toMatchObject({
      status: "stale",
    });
  });

  it("does not let an old completion consume a newer selection", () => {
    const oldSelection = textSelection("card-a");
    const newSelection = textSelection("card-b");
    expect(consumeSubmittedSelection(newSelection, oldSelection)).toBe(
      newSelection
    );
    expect(consumeSubmittedSelection(oldSelection, oldSelection)).toBeNull();
    expect(sameSelection(oldSelection, { ...oldSelection })).toBe(true);
  });
});
