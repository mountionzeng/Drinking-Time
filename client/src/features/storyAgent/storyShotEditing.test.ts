import { afterEach, describe, expect, it, vi } from "vitest";

import { insertStoryShotAfter } from "./storyShotEditing";
import type { StoryShot } from "./types";

function shot(
  partial: Partial<StoryShot> & Pick<StoryShot, "shotNo">
): StoryShot {
  return {
    stableShotId: partial.stableShotId,
    shotIdentity: partial.shotIdentity,
    shotNo: partial.shotNo,
    subject: partial.subject ?? `SH${partial.shotNo}`,
    action: partial.action ?? "",
    dialogue: partial.dialogue ?? "",
    shotType: partial.shotType ?? "",
    beat: partial.beat ?? "",
    cameraAngle: partial.cameraAngle ?? "",
    cameraMove: partial.cameraMove ?? "",
    location: partial.location ?? "",
    timeLight: partial.timeLight ?? "",
    mood: partial.mood ?? "",
    sound: partial.sound ?? "",
    styleRef: partial.styleRef ?? "",
    note: partial.note ?? "",
    emotion: partial.emotion ?? "",
    sourceCardContent: partial.sourceCardContent ?? "",
    intent: partial.intent,
    rationale: partial.rationale,
    transitionOut: partial.transitionOut,
  };
}

describe("story shot editing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("inserts a manual shot after the matched stable shot and renumbers only shotNo", () => {
    vi.spyOn(Date, "now").mockReturnValue(1780000000000);
    vi.spyOn(Math, "random").mockReturnValue(0.123456);

    const result = insertStoryShotAfter(
      [
        shot({ shotNo: 1, stableShotId: "legacy-sh01-shot", subject: "A" }),
        shot({
          shotNo: 2,
          stableShotId: "legacy-sh02-shot",
          subject: "B",
          location: "gallery",
          transitionOut: "cut on white cloth",
        }),
        shot({ shotNo: 3, stableShotId: "legacy-sh03-shot", subject: "C" }),
      ],
      2,
      "legacy-sh02-shot"
    );

    expect(result?.insertedShotNo).toBe(3);
    expect(result?.shots.map(item => [item.shotNo, item.stableShotId])).toEqual(
      [
        [1, "legacy-sh01-shot"],
        [2, "legacy-sh02-shot"],
        [3, "manual-sh03-mppy1i4g-4fzyo8"],
        [4, "legacy-sh03-shot"],
      ]
    );
    expect(result?.shots[2]).toMatchObject({
      subject: "新增镜头",
      location: "gallery",
      transitionIn: "cut on white cloth",
    });
  });

  it("returns null instead of mutating when the target shot is missing", () => {
    const source = [shot({ shotNo: 1, stableShotId: "legacy-sh01-shot" })];
    expect(insertStoryShotAfter(source, 8, "missing-shot")).toBeNull();
    expect(source).toHaveLength(1);
  });
});
