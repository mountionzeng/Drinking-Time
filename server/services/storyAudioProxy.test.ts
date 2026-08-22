import { describe, expect, it } from "vitest";

import {
  fetchStoryAudio,
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
                audioUrl: "https://bucket.s3.us-east-1.amazonaws.com/voice.mp3",
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
    expect(isAllowedStoryAudioUrl("https://example.com/voice.mp3")).toBe(false);
  });
  it("retries a transient upstream connection failure before giving up", async () => {
    const attempts: string[] = [];
    const fetchImpl = (async (url: string) => {
      attempts.push(url);
      if (attempts.length < 3) throw new TypeError("fetch failed");
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    const response = await fetchStoryAudio(
      "https://bucket.s3.amazonaws.com/a.mp3",
      {
        fetchImpl,
        sleep: async () => {},
      }
    );

    expect(response.status).toBe(200);
    expect(attempts).toHaveLength(3);
  });

  it("does not retry when upstream answers with a status code", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;

    const response = await fetchStoryAudio(
      "https://bucket.s3.amazonaws.com/a.mp3",
      {
        fetchImpl,
        sleep: async () => {},
      }
    );

    expect(response.status).toBe(404);
    expect(calls).toBe(1);
  });

  it("surfaces the failure when every retry fails", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    await expect(
      fetchStoryAudio("https://bucket.s3.amazonaws.com/a.mp3", {
        fetchImpl,
        sleep: async () => {},
      })
    ).rejects.toThrow("fetch failed");
    expect(calls).toBe(3);
  });
});
