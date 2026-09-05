import { describe, expect, it } from "vitest";
import {
  buildAudioMixPlan,
  emptyAudioState,
  insertAudioClip,
  setAudioClipFade,
} from "@shared/timelineAudioModel";
import { analyzeAudioMixPlanFrame } from "./audioPlanAnalysis";
import {
  SUBTITLE_TRACK_ID,
  buildSubtitleRenderPlan,
  resolveSubtitleRenderPlanAtFrame,
} from "@shared/timelineSubtitleModel";

describe("audioPlanAnalysis", () => {
  it("reports the same source offset and gain contract used by both executors", () => {
    const inserted = insertAudioClip(emptyAudioState(), {
      id: "music",
      kind: "music",
      assetId: 7,
      timelineStartFrame: 30,
      sourceInFrame: 60,
      sourceOutFrame: 180,
      gain: 0.5,
    });
    if (inserted.status !== "ok") throw new Error(inserted.message);
    const faded = setAudioClipFade(inserted.state, {
      clipId: "music",
      fadeInFrames: 30,
    });
    if (faded.status !== "ok") throw new Error(faded.message);
    const plan = buildAudioMixPlan({ audioState: faded.state });

    expect(analyzeAudioMixPlanFrame(plan, 45)).toEqual([
      {
        id: "music",
        kind: "music",
        sourceFrame: 75,
        gain: 0.25,
      },
    ]);
    expect(analyzeAudioMixPlanFrame(plan, 150)).toEqual([]);
  });

  it("keeps muted active inputs in diagnostics but can filter to audible inputs", () => {
    const plan = buildAudioMixPlan({
      audioState: emptyAudioState(),
      visualSources: [
        {
          id: "video",
          timelineStartFrame: 0,
          sourceInFrame: 30,
          sourceOutFrame: 90,
          durationFrames: 60,
          gain: 1,
          muted: true,
        },
      ],
    });

    expect(analyzeAudioMixPlanFrame(plan, 10)).toMatchObject([
      { id: "visual:video", sourceFrame: 40, gain: 0 },
    ]);
    expect(analyzeAudioMixPlanFrame(plan, 10, { audibleOnly: true })).toEqual(
      []
    );
  });

  it("activates subtitle and audio on the same canonical head frame and removes both at the exclusive tail", () => {
    const inserted = insertAudioClip(emptyAudioState(), {
      id: "voice",
      kind: "narration",
      assetId: 8,
      timelineStartFrame: 30,
      sourceOutFrame: 30,
    });
    if (inserted.status !== "ok") throw new Error(inserted.message);
    const audioPlan = buildAudioMixPlan({ audioState: inserted.state });
    const subtitlePlan = buildSubtitleRenderPlan({
      tracks: [
        {
          id: SUBTITLE_TRACK_ID,
          cues: [
            {
              id: "caption",
              startFrame: 30,
              durationFrames: 30,
              text: "同步",
              provenance: { kind: "manual" },
              sourceTextRevision: 0,
              textEdited: false,
              timingEdited: false,
              textRevision: 1,
            },
          ],
        },
      ],
    });

    expect(resolveSubtitleRenderPlanAtFrame(subtitlePlan, 30)).toHaveLength(1);
    expect(analyzeAudioMixPlanFrame(audioPlan, 30)).toHaveLength(1);
    expect(resolveSubtitleRenderPlanAtFrame(subtitlePlan, 60)).toHaveLength(0);
    expect(analyzeAudioMixPlanFrame(audioPlan, 60)).toHaveLength(0);
  });
});
