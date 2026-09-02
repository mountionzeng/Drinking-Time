import { describe, expect, it } from "vitest";

import type { CreationEditorShot } from "@/features/creationEditor/types";
import { mergeStoryboardDisplayShots } from "./StoryboardPanel";

function shot(
  stableShotId: string,
  shotNo: number,
  subject: string
): CreationEditorShot {
  return {
    stableShotId,
    shotIdentity: stableShotId,
    shotKey: `sh${String(shotNo).padStart(2, "0")}`,
    shotNo,
    subject,
  } as CreationEditorShot;
}

describe("mergeStoryboardDisplayShots", () => {
  it("keeps the persisted A, B, inserted, C order when stale drafts still have old shot numbers", () => {
    const persisted = [
      shot("a", 1, "A"),
      shot("b", 2, "B"),
      shot("inserted", 3, "新增镜头"),
      shot("c", 4, "C"),
    ];
    const staleDrafts = [
      shot("a", 1, "A 草稿"),
      shot("b", 2, "B 草稿"),
      shot("c", 3, "C 草稿"),
    ];

    const merged = mergeStoryboardDisplayShots(persisted, staleDrafts);

    expect(merged.map(item => item.stableShotId)).toEqual([
      "a",
      "b",
      "inserted",
      "c",
    ]);
    expect(merged.map(item => item.shotNo)).toEqual([1, 2, 3, 4]);
    expect(merged.map(item => item.subject)).toEqual([
      "A 草稿",
      "B 草稿",
      "新增镜头",
      "C 草稿",
    ]);
  });
});
