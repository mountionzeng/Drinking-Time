import { describe, expect, it } from "vitest";
import { createStoryboardSelectionFollow } from "./storyboardSelectionFollow";
import { createTimelinePlaybackRuntime } from "./useTimelinePlaybackClock";

const shots = [{ stableShotId: "a", shotNo: 1 }, { stableShotId: "b", shotNo: 2 }];
const first = { sourceType: "shot" as const, storyId: 1, stableShotId: "a" };

describe("chat selection while playing", () => {
  it("does not switch playback back to the old chat shot on every frame or after pausing", () => {
    const follow = createStoryboardSelectionFollow();
    let selected = follow(first, 1, shots);
    const clock = createTimelinePlaybackRuntime({ totalMs: 2000, onPlayheadCommit: ms => { selected = ms < 1000 ? 1 : 2; } });
    clock.setPlaying(true);
    for (let frame = 0; frame < 50; frame++) {
      const state = clock.advance(1000 / 30);
      // Material refreshes may replace shot arrays without a new user selection.
      const target = follow(first, 1, shots.map(shot => ({ ...shot })));
      if (target !== null) selected = target;
      expect(selected).toBe(state.playheadMs < 1000 ? 1 : 2);
    }
    clock.setPlaying(false);
    expect(follow(first, 1, shots)).toBeNull();
    expect(selected).toBe(2);
    expect(follow({ ...first }, 1, shots)).toBe(1); // An explicit new click still works.
  });

  it("waits for newly inserted shots, ignores foreign stories and preserves timeline ranges", () => {
    const follow = createStoryboardSelectionFollow();
    expect(follow(first, 1, [])).toBeNull();
    expect(follow(first, 1, shots)).toBe(1);
    expect(follow({ ...first, storyId: 2 }, 1, shots)).toBeNull();
    expect(follow({ ...first, sourceType: "timeline-range" }, 1, shots)).toBeNull();
    expect(follow(null, 1, shots)).toBeNull();
    expect(follow(first, 1, shots)).toBe(1);
  });
});
