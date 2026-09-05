import {
  audioMixInputGainAtFrame,
  audioMixInputSourceFrameAt,
  resolveAudioMixPlanAtFrame,
  type AudioMixPlan,
  type AudioMixPlanInput,
} from "@shared/timelineAudioModel";

export type AudioMixFrameAnalysis = {
  id: string;
  kind: AudioMixPlanInput["kind"];
  sourceFrame: number;
  gain: number;
};

/**
 * Deterministic frame-level projection shared by browser lifecycle tests and
 * U8's decoded-output parity checks. Keeping this pure makes a playback bug
 * reproducible without relying on AudioContext timing.
 */
export function analyzeAudioMixPlanFrame(
  plan: AudioMixPlan,
  frame: number,
  options: { audibleOnly?: boolean } = {}
): AudioMixFrameAnalysis[] {
  return resolveAudioMixPlanAtFrame(plan, frame).flatMap(input => {
    const gain = audioMixInputGainAtFrame(input, frame);
    if (options.audibleOnly && gain <= 0) return [];
    return [
      {
        id: input.id,
        kind: input.kind,
        sourceFrame: audioMixInputSourceFrameAt(input, frame),
        gain,
      },
    ];
  });
}
