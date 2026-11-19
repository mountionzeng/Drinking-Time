import { describe, expect, it, vi } from "vitest";
import {
  musicAccents,
  readVideoTimelineCues,
  directionFromTimeline,
} from "./videoTimelineCues";
import type { AudioMixPlanInput } from "../../shared/timelineAudioModel";

const timeline = vi.hoisted(() => vi.fn());
vi.mock("../repositories/timelines", () => ({ getStoryTimeline: timeline }));
vi.mock("../repositories/audioAssets", () => ({
  listStoryAudioAssetRows: async () => [
    { id: 4, status: "ready", displayName: "旁白", storageKey: "unused" },
  ],
}));
describe("timeline render direction", () => {
  it("uses the actual visible slot, subtitle edits and audible source window on every read", async () => {
    const cue = (
      id: string,
      startFrame: number,
      durationFrames: number,
      text: string
    ) => ({ id, startFrame, durationFrames, text });
    const clip = {
      id: "a",
      assetId: 4,
      timelineStartFrame: 50,
      sourceInFrame: 30,
      sourceOutFrame: 90,
      durationFrames: 60,
      gain: 1,
    };
    const stored = {
      items: [
        {
          stableShotId: "s4",
          included: true,
          position: 3,
          timelineStartFrame: 60,
          durationFrames: 90,
          plannedDurationMs: 3000,
        },
      ],
      extensions: {
        subtitleTracks: {
          tracks: [
            {
              id: "s",
              cues: [
                cue("outside", 0, 60, "之前"),
                cue("yes", 50, 28, "树梢"),
                cue("next", 90, 20, "进屋"),
              ],
            },
          ],
        },
        audioTracks: {
          tracks: [
            { kind: "narration", defaultGain: 1, clips: [clip] },
            { kind: "music", muted: true, clips: [{ ...clip, id: "ignored" }] },
          ],
        },
      },
    };
    timeline.mockResolvedValue(stored);
    const [one, two, three, after] = await readVideoTimelineCues(
      1,
      2,
      "s4",
      [1, 1, 1, 1]
    );
    expect(one?.text).toEqual([{ from: 0, to: 0.6, text: "树梢" }]);
    expect(one?.audio).toMatchObject([
      { kind: "narration", sourceIn: 40, sourceOut: 70 },
    ]);
    expect(two?.text[0].text).toBe("进屋");
    expect(three).toBeNull();
    expect(after).toBeNull();
    stored.extensions.subtitleTracks.tracks[0].cues[1].text = "修改后的台词";
    expect(
      directionFromTimeline((await readVideoTimelineCues(1, 2, "s4", [1]))[0])
    ).toContain("修改后的台词");
  });
  it("locates a measured music accent and filters flat or muted audio", () => {
    const clip = {
      timelineStartFrame: 0,
      durationFrames: 30,
      baseGain: 1,
      fadeInFrames: 0,
      fadeOutFrames: 0,
      muted: false,
    } as AudioMixPlanInput;
    const pcm = Buffer.alloc(8000);
    for (let i = 2000; i < 2400; i++)
      pcm.writeInt16LE(i % 2 ? -12000 : 12000, 2 * i);
    expect(musicAccents(pcm, clip, 0).peaks).toEqual([15]);
    expect(musicAccents(pcm, { ...clip, muted: true }, 0)).toEqual({
      peaks: [],
      dynamics: "近静音",
    });
  });
});
