import { describe, expect, it } from "vitest";

import {
  isAllowedStoryAudioUrl,
  storyAudioUrl,
} from "./storyAudioProxy";

describe("story audio proxy", () => {
  it("resolves only a clip stored in the story ChatCut audio tracks", () => {
    const body = {
      chatCutImport: {
        audioTracks: [
          {
            clips: [
              {
                id: "voice-0101",
                audioUrl:
                  "https://bucket.s3.us-east-1.amazonaws.com/voice.mp3",
              },
            ],
          },
        ],
      },
    };
    expect(storyAudioUrl(body, "voice-0101")).toContain("voice.mp3");
    expect(storyAudioUrl(body, "not-in-story")).toBeNull();
  });

  it("allows HTTPS S3 media but rejects arbitrary and private hosts", () => {
    expect(
      isAllowedStoryAudioUrl(
        "https://bucket.s3.us-east-1.amazonaws.com/voice.mp3"
      )
    ).toBe(true);
    expect(isAllowedStoryAudioUrl("http://127.0.0.1/private.mp3")).toBe(false);
    expect(isAllowedStoryAudioUrl("https://example.com/voice.mp3")).toBe(
      false
    );
  });
});
