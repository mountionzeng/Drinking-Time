import { describe, expect, it, vi } from "vitest";

import { generateStoryVoice302 } from "./storyVoice302";

describe("generateStoryVoice302", () => {
  it("submits only narration text and returns the generated audio URL", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({ audio_url: "https://file.302.ai/voice/narration.mp3" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await generateStoryVoice302({
      text: "这是要朗读的文字稿。",
      apiKey: "test-key",
      baseUrl: "https://api.302.ai/",
      provider: "openai",
      voice: "alloy",
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.302.ai/302/tts/generate",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
        }),
      })
    );
    const request = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(request).toEqual({
      text: "这是要朗读的文字稿。",
      provider: "openai",
      voice: "alloy",
    });
    expect(result).toEqual({
      audioUrl: "https://file.302.ai/voice/narration.mp3",
      provider: "openai",
      voice: "alloy",
    });
  });

  it("rejects empty text and missing configuration before making a request", async () => {
    const fetcher = vi.fn();

    await expect(
      generateStoryVoice302({ text: "  ", apiKey: "test-key", fetcher })
    ).rejects.toThrow("旁白文字不能为空");
    await expect(
      generateStoryVoice302({ text: "正文", apiKey: "", fetcher })
    ).rejects.toThrow("尚未配置 302 API Key");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("surfaces provider errors and invalid response payloads", async () => {
    await expect(
      generateStoryVoice302({
        text: "正文",
        apiKey: "test-key",
        fetcher: vi.fn(async () => new Response("quota exceeded", { status: 402 })),
      })
    ).rejects.toThrow("302 语音生成失败（HTTP 402）");

    await expect(
      generateStoryVoice302({
        text: "正文",
        apiKey: "test-key",
        fetcher: vi.fn(async () =>
          new Response(JSON.stringify({}), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        ),
      })
    ).rejects.toThrow("没有返回可播放的音频地址");
  });
});
