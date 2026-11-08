import { describe, expect, it, vi } from "vitest";

import { generateStoryVoice302 } from "./storyVoice302";

describe("generateStoryVoice302", () => {
  it("sends the original script and Chinese Doubao voice through the documented 302 wrapper", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ audio_url: "https://file.302.ai/gpt/tts/a.mp3" })));
    const result = await generateStoryVoice302({ text: "我们相信。\n\n她是你。", provider: "doubao", voice: "zh_female_wenrouxiaoya_moon_bigtts", apiKey: "test-key", baseUrl: "https://api.302.ai", fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.302.ai/302/tts/generate");
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ text: "我们相信。\n\n她是你。", provider: "doubao", voice: "zh_female_wenrouxiaoya_moon_bigtts" });
    expect(result.audioUrl).toBe("https://file.302.ai/gpt/tts/a.mp3");
  });

  it("keeps a Doubao 500 unknown without applying the OpenAI release rule or retrying", async () => {
    const fetcher = vi.fn(async () => new Response("internal error", { status: 500 }));
    await expect(generateStoryVoice302({ text: "你好", provider: "doubao", voice: "zh_female_wenrouxiaoya_moon_bigtts", apiKey: "test-key", fetcher })).rejects.toMatchObject({ outcome: "submission_unknown" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("uses the native ElevenLabs model, voice ID and URL contract without altering the script", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ url: "https://file.302ai.cn/gpt/narration.mp3" })));
    const result = await generateStoryVoice302({ text: "你好。\n\n生生不息。", provider: "elevenlabs", voice: "EXAVITQu4vr4xnSDxMaL", apiKey: "test-key", baseUrl: "https://api.302.ai", fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.302.ai/elevenlabs/text-to-speech/EXAVITQu4vr4xnSDxMaL?output_format=mp3_44100_128&response_format=url");
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      text: "你好。\n\n生生不息。", model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.35, similarity_boost: 0.75, style: 0, speed: 0.94, use_speaker_boost: true },
    });
    expect(result).toMatchObject({ audioUrl: "https://file.302ai.cn/gpt/narration.mp3", provider: "elevenlabs", voice: "EXAVITQu4vr4xnSDxMaL" });
  });

  it("never retries an ElevenLabs 500 or falls back to a different model", async () => {
    const fetcher = vi.fn(async () => new Response("internal error", { status: 500 }));
    await expect(generateStoryVoice302({ text: "你好", provider: "elevenlabs", voice: "EXAVITQu4vr4xnSDxMaL", apiKey: "test-key", fetcher })).rejects.toMatchObject({ outcome: "submission_unknown" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects a successful ElevenLabs response without a secure URL", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ url: "http://file.302ai.cn/a.mp3" })));
    await expect(generateStoryVoice302({ text: "你好", provider: "elevenlabs", voice: "EXAVITQu4vr4xnSDxMaL", apiKey: "test-key", fetcher })).rejects.toMatchObject({ outcome: "charged_failure" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("uses the explicit MiniMax model and URL response contract through 302", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      base_resp: { status_code: 0 },
      data: { audio: "https://minimax-algeng-chat-tts.oss-cn-wulanchabu.aliyuncs.com/audio/test.mp3", status: 2 },
    })));
    const result = await generateStoryVoice302({
      text: "我们可以接住你的任何细碎的情绪。", provider: "minimaxi",
      voice: "audiobook_female_1", apiKey: "test-key", baseUrl: "https://api.302.ai", fetcher,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.302.ai/minimaxi/v1/t2a_v2");
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      model: "speech-2.8-turbo", text: "我们可以接住你的任何细碎的情绪。",
      stream: false, output_format: "url",
      voice_setting: { voice_id: "audiobook_female_1", speed: 1, vol: 1, pitch: 0 },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 },
    });
    expect(result.audioUrl).toContain("minimax-algeng-chat-tts");
  });

  it("does not retry or accept an unsuccessful MiniMax response as audio", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      base_resp: { status_code: 1000, status_msg: "unknown error" }, data: null,
    })));
    await expect(generateStoryVoice302({ text: "你好", provider: "minimaxi", voice: "audiobook_female_1", apiKey: "test-key", fetcher }))
      .rejects.toMatchObject({ outcome: "submission_unknown" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps a MiniMax HTTP 500 unknown instead of applying the legacy failure rule", async () => {
    const fetcher = vi.fn(async () => new Response("internal error", { status: 500 }));
    await expect(generateStoryVoice302({ text: "你好", provider: "minimaxi", voice: "audiobook_female_1", apiKey: "test-key", fetcher }))
      .rejects.toMatchObject({ outcome: "submission_unknown" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
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
        provider: "openai",
        voice: "alloy",
        fetcher: vi.fn(async () => new Response("quota exceeded", { status: 402 })),
      })
    ).rejects.toThrow("302 语音生成失败（HTTP 402）");

    await expect(
      generateStoryVoice302({
        text: "正文",
        apiKey: "test-key",
        provider: "openai",
        voice: "alloy",
        fetcher: vi.fn(async () =>
          new Response(JSON.stringify({}), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        ),
      })
    ).rejects.toThrow("没有返回可播放的音频地址");
  });
  it.each([408, 429, 502, 503, 504])("keeps HTTP %s as an unknown submission", async status => {
    await expect(generateStoryVoice302({ text: "你好", apiKey: "test-key", provider: "openai", voice: "alloy", fetcher: async () => new Response("{}", { status }) }))
      .rejects.toMatchObject({ outcome: "submission_unknown" });
  });
  it("does not release a malformed successful response", async () => {
    await expect(generateStoryVoice302({ text: "你好", apiKey: "test-key", provider: "openai", voice: "alloy", fetcher: async () => new Response("invalid json") }))
      .rejects.toMatchObject({ outcome: "submission_unknown" });
  });
  it("treats an explicit HTTP 500 without audio as an uncharged failure and logs a redacted body", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(generateStoryVoice302({ text: "你好", apiKey: "test-key", provider: "openai", voice: "alloy", fetcher: async () => new Response(JSON.stringify({ error: { message: "internal error", authorization: "Bearer sk-secret123", api_key: "abc" } }) + "x".repeat(800), { status: 500, headers: { "Content-Type": "application/json" } }) }))
      .rejects.toMatchObject({ outcome: "not_charged_failure", message: "302 语音生成失败（HTTP 500）" });
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("internal error");
    expect(logged).not.toContain("sk-secret123");
    expect(logged).not.toMatch(/api_key[^,]*abc/);
    const body = (warn.mock.calls[0]?.[1] as { body: string }).body;
    expect(body.length).toBeLessThanOrEqual(300);
    warn.mockRestore();
  });
  it("keeps HTTP 500 unknown when the body mentions an audio_url", async () => {
    await expect(generateStoryVoice302({ text: "你好", apiKey: "test-key", provider: "openai", voice: "alloy", fetcher: async () => new Response(JSON.stringify({ audio_url: "https://file.302.ai/a.mp3", error: "store failed" }), { status: 500 }) }))
      .rejects.toMatchObject({ outcome: "submission_unknown" });
  });
  it("keeps a timeout as an unknown submission", async () => {
    const fetcher = (_: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => { init?.signal?.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; reject(e); }); });
    await expect(generateStoryVoice302({ text: "你好", apiKey: "test-key", provider: "openai", voice: "alloy", timeoutMs: 5, fetcher: fetcher as never }))
      .rejects.toMatchObject({ outcome: "submission_unknown" });
  });
});
