import { describe, expect, it } from "vitest";
import { auditLegacyTimelineMedia } from "./audit-timeline-media-legacy";

function story(id: number, body: unknown) {
  return { id, userId: 1, body };
}

describe("auditLegacyTimelineMedia", () => {
  it("counts a Story that only legacy ChatCut content can serve", () => {
    const report = auditLegacyTimelineMedia({
      stories: [
        story(1, {
          chatCutImport: {
            audioTracks: [
              {
                clips: [
                  {
                    audioUrl:
                      "https://bucket.s3.us-west-2.amazonaws.com/voice.mp3",
                  },
                  { audioUrl: "https://cdn.example.com/other.mp3" },
                ],
              },
            ],
            scriptCues: [{ code: "C1", text: "台词" }],
          },
          shots: [],
        }),
      ],
      storyTimelines: [{ storyId: 1, items: [] }],
    });

    expect(report).toMatchObject({
      storiesTotal: 1,
      storiesWithFormalSubtitles: 0,
      storiesWithFormalAudio: 0,
      storiesWithChatCutAudioTracks: 1,
      storiesWithChatCutScriptCues: 1,
      storiesOnlyServedByLegacy: 1,
      chatCutAudioClips: 2,
      chatCutAudioClipsMaterializable: 1,
      chatCutAudioClipsUnmaterializable: 1,
    });
  });

  it("does not count a Story as legacy-only once it carries formal media", () => {
    const report = auditLegacyTimelineMedia({
      stories: [
        story(1, {
          chatCutImport: { scriptCues: [{ code: "C1", text: "旧" }] },
          shots: [],
        }),
      ],
      storyTimelines: [
        {
          storyId: 1,
          items: {
            items: [],
            subtitleTracks: {
              tracks: [{ id: "subtitle", cues: [{ id: "a" }] }],
            },
          },
        },
      ],
    });
    expect(report.storiesWithFormalSubtitles).toBe(1);
    expect(report.storiesOnlyServedByLegacy).toBe(0);
  });

  it("counts legacy per-shot voiceAudio fields and linked visual sources", () => {
    const report = auditLegacyTimelineMedia({
      stories: [
        story(1, {
          shots: [
            { voiceAudioUrl: "https://x/a.mp3" },
            { voiceAudioKey: "k" },
            { dialogue: "没有语音" },
          ],
        }),
      ],
      storyTimelines: [
        {
          storyId: 1,
          items: {
            items: [],
            audioTracks: {
              tracks: [
                {
                  kind: "source",
                  clips: [{ id: "c", linkedVisualSourceId: "visual-1" }],
                },
              ],
            },
          },
        },
      ],
    });
    expect(report.storiesWithShotVoiceAudio).toBe(1);
    expect(report.shotsWithVoiceAudio).toBe(2);
    expect(report.linkedVisualSourceClips).toBe(1);
    expect(report.storiesWithFormalAudio).toBe(1);
  });

  it("treats an empty dataset as nothing to retire and nothing at risk", () => {
    expect(auditLegacyTimelineMedia({})).toMatchObject({
      storiesTotal: 0,
      storiesOnlyServedByLegacy: 0,
      chatCutAudioClips: 0,
    });
  });
});
