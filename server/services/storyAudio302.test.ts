import { describe, expect, it, vi } from "vitest";
import { StoryAudio302Error, generateStoryAudio302 } from "./storyAudio302";

describe("generateStoryAudio302", () => {
  it("uses ElevenLabs Music v1 and its minimum ten-second duration", async () => {
    const fetcher = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(
          JSON.stringify({ url: "https://file.302.ai/audio/music.mp3" }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    );
    const result = await generateStoryAudio302({
      kind: "music",
      prompt: "quiet piano underscore",
      durationSeconds: 8,
      apiKey: "test-key",
      baseUrl: "https://api.302.ai/",
      fetcher,
    });

    expect(result).toEqual({
      provider: "302-elevenlabs",
      model: "music_v1",
      source: { kind: "url", url: "https://file.302.ai/audio/music.mp3" },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toBe(
      "https://api.302.ai/elevenlabs/music?response_format=url"
    );
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body).toEqual({
      prompt: "quiet piano underscore",
      music_length_ms: 10_000,
      model_id: "music_v1",
    });
  });

  it("uses loopable ElevenLabs sound generation for ambience", async () => {
    const fetcher = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(
          JSON.stringify({ audio_url: "https://file.302.ai/audio/room.mp3" }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    );
    await expect(
      generateStoryAudio302({
        kind: "ambience",
        prompt: "quiet old apartment room tone",
        durationSeconds: 12,
        apiKey: "test-key",
        baseUrl: "https://api.302.ai",
        fetcher,
      })
    ).resolves.toMatchObject({
      provider: "302-elevenlabs",
      model: "eleven_text_to_sound_v2",
      source: { kind: "url" },
    });
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      loop: true,
      duration_seconds: 12,
      model_id: "eleven_text_to_sound_v2",
    });
  });

  it("rejects binary sound-effect responses without buffering them", async () => {
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    const fetcher = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(bytes, {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        })
    );
    await expect(
      generateStoryAudio302({
        kind: "sfx",
        prompt: "one wooden door close",
        durationSeconds: 90,
        apiKey: "test-key",
        baseUrl: "https://api.302.ai",
        fetcher,
      })
    ).rejects.toMatchObject({ outcome: "charged_failure" });
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ loop: false, duration_seconds: 30 });
  });

  it("caps chunked provider URL responses before they can exhaust memory", async () => {
    const oversized = new Uint8Array(600 * 1024).fill(97);
    const fetcher = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(oversized);
              controller.enqueue(oversized);
              controller.close();
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    );

    await expect(
      generateStoryAudio302({
        kind: "ambience",
        prompt: "room tone",
        durationSeconds: 4,
        apiKey: "test-key",
        baseUrl: "https://api.302.ai",
        fetcher,
      })
    ).rejects.toMatchObject({
      outcome: "charged_failure",
      message: expect.stringContaining("过大"),
    });
  });

  it("treats a provider 5xx as submission-unknown", async () => {
    const fetcher = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response("bad", { status: 503 })
    );
    await expect(
      generateStoryAudio302({
        kind: "sfx",
        prompt: "impact",
        durationSeconds: 1,
        apiKey: "test-key",
        baseUrl: "https://api.302.ai",
        fetcher,
      })
    ).rejects.toMatchObject({
      outcome: "submission_unknown",
    } satisfies Partial<StoryAudio302Error>);
  });
});
