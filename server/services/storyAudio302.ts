import { ENV } from "../_core/env";

export type GeneratedStoryAudioKind = "music" | "ambience" | "sfx";

export type StoryAudio302Result = {
  provider: "302-elevenlabs";
  model: string;
  source: { kind: "url"; url: string };
};

export class StoryAudio302Error extends Error {
  readonly outcome:
    | "not_charged_failure"
    | "charged_failure"
    | "submission_unknown";

  constructor(
    outcome: "not_charged_failure" | "charged_failure" | "submission_unknown",
    message: string
  ) {
    super(message);
    this.name = "StoryAudio302Error";
    this.outcome = outcome;
  }
}

type AudioFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

const MAX_PROVIDER_JSON_BYTES = 1 * 1024 * 1024;

function positiveInteger(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function safeModel(value: string, label: string): string {
  const model = value.trim();
  if (!model || model.length > 100 || !/^[\w.-]+$/i.test(model)) {
    throw new Error(`${label}配置无效`);
  }
  return model;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function audioUrlFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  for (const key of ["url", "audio_url", "audioUrl"]) {
    const url = httpsUrl(record[key]);
    if (url) return url;
  }
  if (Array.isArray(record.data)) {
    for (const item of record.data) {
      const url = audioUrlFromPayload(item);
      if (url) return url;
    }
  }
  return null;
}

async function limitedJsonPayload(
  response: Response,
  label: string
): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!/json/i.test(contentType)) {
    await response.body?.cancel().catch(() => undefined);
    throw new StoryAudio302Error(
      "charged_failure",
      `${label}未按 URL 格式返回，已停止读取响应`
    );
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_PROVIDER_JSON_BYTES
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new StoryAudio302Error(
      "charged_failure",
      `${label}返回的 URL 响应过大`
    );
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new StoryAudio302Error(
      "charged_failure",
      `${label}没有返回可读取的 URL 响应`
    );
  }
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let json = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > MAX_PROVIDER_JSON_BYTES) {
        await reader.cancel();
        throw new StoryAudio302Error(
          "charged_failure",
          `${label}返回的 URL 响应过大`
        );
      }
      json += decoder.decode(chunk.value, { stream: true });
    }
    json += decoder.decode();
  } catch (error) {
    if (error instanceof StoryAudio302Error) throw error;
    throw new StoryAudio302Error(
      "charged_failure",
      `${label}的 URL 响应读取失败`
    );
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(json);
  } catch {
    throw new StoryAudio302Error(
      "charged_failure",
      `${label}返回了无法解析的 URL 响应`
    );
  }
}

async function checkedFetch(
  url: string,
  init: RequestInit,
  fetcher: AudioFetch
): Promise<Response> {
  try {
    const response = await fetcher(url, init);
    if (!response.ok) {
      throw new StoryAudio302Error(
        response.status >= 500 ? "submission_unknown" : "not_charged_failure",
        `302 声音生成失败（HTTP ${response.status}）`
      );
    }
    return response;
  } catch (error) {
    if (error instanceof StoryAudio302Error) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new StoryAudio302Error(
        "submission_unknown",
        "302 声音生成超时；请求结果未知，不会自动重试"
      );
    }
    if (error instanceof TypeError) {
      throw new StoryAudio302Error(
        "submission_unknown",
        "302 声音请求连接中断；结果未知，不会自动重试"
      );
    }
    throw error;
  }
}

/**
 * Generate scene sound against 302's documented media endpoints.
 *
 * Music uses ElevenLabs Music v1. Ambience and SFX use ElevenLabs
 * text-to-sound v2. Both endpoints are requested with `response_format=url`:
 * a durable URL is required so a paid result can be resumed after a process
 * restart without resubmitting the provider request.
 */
export async function generateStoryAudio302(input: {
  kind: GeneratedStoryAudioKind;
  prompt: string;
  durationSeconds: number;
  apiKey?: string;
  baseUrl?: string;
  musicModel?: string;
  soundModel?: string;
  timeoutMs?: number;
  fetcher?: AudioFetch;
}): Promise<StoryAudio302Result> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("声音生成提示不能为空");
  if (prompt.length > 10_000)
    throw new Error("声音生成提示不能超过 10000 字符");
  const apiKey = input.apiKey ?? ENV.api302Key;
  if (!apiKey.trim()) throw new Error("尚未配置 302 API Key");
  const baseUrl = (input.baseUrl ?? ENV.api302BaseUrl)
    .trim()
    .replace(/\/+$/, "");
  if (!baseUrl) throw new Error("302 API 地址未配置");

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? positiveInteger(ENV.audio302TimeoutMs, 180_000)
  );
  const fetcher = input.fetcher ?? fetch;
  try {
    if (input.kind === "music") {
      const model = safeModel(
        input.musicModel ?? ENV.audio302MusicModel,
        "音乐模型"
      );
      const response = await checkedFetch(
        `${baseUrl}/elevenlabs/music?response_format=url`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt,
            music_length_ms: Math.round(
              Math.min(300, Math.max(10, input.durationSeconds)) * 1_000
            ),
            model_id: model,
          }),
          signal: controller.signal,
        },
        fetcher
      );
      const url = audioUrlFromPayload(
        await limitedJsonPayload(response, "302 音乐模型")
      );
      if (!url) {
        throw new StoryAudio302Error(
          "charged_failure",
          "302 音乐模型没有返回可下载的音频"
        );
      }
      return {
        provider: "302-elevenlabs",
        model,
        source: { kind: "url", url },
      };
    }

    const model = safeModel(
      input.soundModel ?? ENV.audio302SoundModel,
      "音效模型"
    );
    const response = await checkedFetch(
      `${baseUrl}/elevenlabs/sound-generation?response_format=url`,
      {
        method: "POST",
        headers: {
          Accept: "application/json, audio/mpeg, audio/wav",
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: prompt,
          loop: input.kind === "ambience",
          duration_seconds: Math.min(30, Math.max(0.5, input.durationSeconds)),
          prompt_influence: 0.5,
          model_id: model,
        }),
        signal: controller.signal,
      },
      fetcher
    );
    const url = audioUrlFromPayload(
      await limitedJsonPayload(response, "302 音效模型")
    );
    if (!url) {
      throw new StoryAudio302Error(
        "charged_failure",
        "302 音效模型没有返回可用的音频"
      );
    }
    return {
      provider: "302-elevenlabs",
      model,
      source: { kind: "url", url },
    };
  } finally {
    clearTimeout(timeout);
  }
}
