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
