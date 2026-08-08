import { afterEach, describe, expect, it, vi } from "vitest";
import { ENV } from "./env";
import { transcribeAudioBytes } from "./voiceTranscription";

const originalApiKey = ENV.doubaoSpeechApiKey;
const original302ApiKey = ENV.api302Key;
const original302BaseUrl = ENV.api302BaseUrl;
const originalFallbackModel = ENV.voiceTranscriptionFallbackModel;

afterEach(() => {
  ENV.doubaoSpeechApiKey = originalApiKey;
  ENV.api302Key = original302ApiKey;
  ENV.api302BaseUrl = original302BaseUrl;
  ENV.voiceTranscriptionFallbackModel = originalFallbackModel;
  vi.unstubAllGlobals();
});

describe("transcribeAudioBytes", () => {
  it("sends browser audio to Doubao and returns its text", async () => {
    ENV.doubaoSpeechApiKey = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: { text: "今天天气很好" } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(transcribeAudioBytes({
      audioBase64: "data:audio/webm;base64,aGVsbG8=",
      mimeType: "audio/webm",
      language: "zh",
    })).resolves.toMatchObject({ text: "今天天气很好" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Api-Key": "test-key",
          "X-Api-Resource-Id": "volc.bigasr.auc_turbo",
          "X-Api-Sequence": "-1",
        }),
        body: expect.stringContaining('"data":"aGVsbG8="'),
      }),
    );
  });

  it("reports a missing Doubao key without calling the network", async () => {
    ENV.doubaoSpeechApiKey = "";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(transcribeAudioBytes({ audioBase64: "aGVsbG8=", mimeType: "audio/webm" }))
      .resolves.toMatchObject({ code: "SERVICE_ERROR", details: "DOUBAO_SPEECH_API_KEY is not set" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps Doubao's error message actionable", async () => {
    ENV.doubaoSpeechApiKey = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "invalid audio" }), { status: 400, statusText: "Bad Request" }),
    ));

    await expect(transcribeAudioBytes({ audioBase64: "aGVsbG8=", mimeType: "audio/webm" }))
      .resolves.toMatchObject({ code: "TRANSCRIPTION_FAILED", details: "400 Bad Request: invalid audio" });
  });

  it("falls back to 302 only when Doubao rejects the requested resource", async () => {
    ENV.doubaoSpeechApiKey = "test-doubao-key";
    ENV.api302Key = "test-302-key";
    ENV.api302BaseUrl = "https://api.302.ai";
    ENV.voiceTranscriptionFallbackModel = "gpt-4o-mini-transcribe";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        header: {
          code: 45000030,
          message: "[resource_id=volc.bigasr.auc_turbo] requested resource not granted",
        },
      }), { status: 403, statusText: "Forbidden" }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        text: "这是用户真实说的话",
        task: "transcribe",
        language: "zh",
        duration: 1.2,
        segments: [],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(transcribeAudioBytes({
      audioBase64: "aGVsbG8=",
      mimeType: "audio/webm",
      language: "zh",
    })).resolves.toMatchObject({ text: "这是用户真实说的话" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [fallbackUrl, fallbackInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(fallbackUrl).toBe("https://api.302.ai/v1/audio/transcriptions");
    expect(fallbackInit.headers).toEqual(expect.objectContaining({
      Authorization: "Bearer test-302-key",
    }));
    expect(fallbackInit.body).toBeInstanceOf(FormData);
    expect((fallbackInit.body as FormData).get("model")).toBe("gpt-4o-mini-transcribe");
    expect((fallbackInit.body as FormData).get("response_format")).toBeNull();
    expect((fallbackInit.body as FormData).get("prompt")).toBeNull();
  });

  it("keeps the WebM extension when the browser includes its codec in the MIME type", async () => {
    ENV.doubaoSpeechApiKey = "test-doubao-key";
    ENV.api302Key = "test-302-key";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        header: { code: 45000030, message: "requested resource not granted" },
      }), { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ text: "转写成功" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(transcribeAudioBytes({
      audioBase64: "aGVsbG8=",
      mimeType: "audio/webm;codecs=opus",
    })).resolves.toMatchObject({ text: "转写成功" });

    const [, fallbackInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const audioFile = (fallbackInit.body as FormData).get("file") as File;
    expect(audioFile.name).toBe("audio.webm");
  });

  it("does not fall back for other Doubao errors", async () => {
    ENV.doubaoSpeechApiKey = "test-doubao-key";
    ENV.api302Key = "test-302-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "invalid audio" }), {
        status: 400,
        statusText: "Bad Request",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(transcribeAudioBytes({ audioBase64: "aGVsbG8=", mimeType: "audio/webm" }))
      .resolves.toMatchObject({ details: "400 Bad Request: invalid audio" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports the Doubao entitlement error when no fallback key is configured", async () => {
    ENV.doubaoSpeechApiKey = "test-doubao-key";
    ENV.api302Key = "";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 45000030,
      message: "requested resource not granted",
    }), { status: 403, statusText: "Forbidden" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(transcribeAudioBytes({ audioBase64: "aGVsbG8=", mimeType: "audio/webm" }))
      .resolves.toMatchObject({
        code: "TRANSCRIPTION_FAILED",
        details: "403 Forbidden: requested resource not granted",
      });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a Doubao error carried in a successful HTTP response actionable", async () => {
    ENV.doubaoSpeechApiKey = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 45000001, message: "audio decode failed" }), { status: 200 }),
    ));

    await expect(transcribeAudioBytes({ audioBase64: "aGVsbG8=", mimeType: "audio/webm" }))
      .resolves.toMatchObject({ code: "TRANSCRIPTION_FAILED", details: "audio decode failed" });
  });
});
