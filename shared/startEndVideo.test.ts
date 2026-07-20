import { describe, expect, it } from "vitest";

import {
  isStartEndVideoTakeSnapshot,
  parseStartEndVideoConfig,
} from "./startEndVideo";

describe("startEndVideo", () => {
  it("normalizes a storyboard first/last-frame configuration for Vidu", () => {
    expect(
      parseStartEndVideoConfig(
        JSON.stringify({
          frameMode: "start_end",
          firstFrameImageId: 1365,
          lastFrameImageId: 1364,
          durationSec: 4.8,
          motion: "high",
        })
      )
    ).toEqual({
      frameMode: "start_end",
      firstFrameImageId: 1365,
      lastFrameImageId: 1364,
      requestedDurationSec: 4.8,
      durationSec: 5,
      resolution: "1080p",
      movementAmplitude: "large",
      model: "viduq2-turbo",
    });
  });

  it("rejects incomplete or same-frame configurations", () => {
    expect(parseStartEndVideoConfig("{}")).toBeNull();
    expect(
      parseStartEndVideoConfig({
        frameMode: "start_end",
        firstFrameImageId: 12,
        lastFrameImageId: 12,
      })
    ).toBeNull();
  });

  it("recognizes only the dedicated take snapshot", () => {
    expect(isStartEndVideoTakeSnapshot({ kind: "shot-start-end" })).toBe(true);
    expect(isStartEndVideoTakeSnapshot({ kind: "editing-transition" })).toBe(
      false
    );
  });
});
