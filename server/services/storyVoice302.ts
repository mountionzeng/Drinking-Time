import { ENV } from "../_core/env";

type StoryVoiceFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export type StoryVoice302Result = {
  audioUrl: string;
  provider: string;
  voice: string;
};

function positiveInteger(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function safeOption(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 80 || !/^[\w.-]+$/i.test(normalized)) {
    throw new Error(`${label}配置无效`);
  }
  return normalized;
}

export async function generateStoryVoice302(input: {
  text: string;
  provider?: string;
  voice?: string;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetcher?: StoryVoiceFetch;
}): Promise<StoryVoice302Result> {
  const narration = input.text.trim();
  if (!narration) throw new Error("旁白文字不能为空");
  if (narration.length > 5_000) {
    throw new Error("单镜旁白不能超过 5000 个字符");
  }

  const apiKey = input.apiKey ?? ENV.api302Key;
  if (!apiKey.trim()) throw new Error("尚未配置 302 API Key");
  const provider = safeOption(
    input.provider ?? ENV.tts302Provider,
    "语音服务商"
  );
  const voice = safeOption(input.voice ?? ENV.tts302Voice, "语音音色");
  const baseUrl = (input.baseUrl ?? ENV.api302BaseUrl).trim().replace(/\/+$/, "");
  if (!baseUrl) throw new Error("302 API 地址未配置");

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? positiveInteger(ENV.tts302TimeoutMs, 60_000)
  );
  try {
    const response = await (input.fetcher ?? fetch)(
      `${baseUrl}/302/tts/generate`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: narration, provider, voice }),
        signal: controller.signal,
      }
    );
    if (!response.ok) {
      throw new Error(`302 语音生成失败（HTTP ${response.status}）`);
    }
    const payload = (await response.json()) as { audio_url?: unknown };
    const audioUrl =
      typeof payload.audio_url === "string" ? payload.audio_url.trim() : "";
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(audioUrl);
    } catch {
      throw new Error("302 没有返回可播放的音频地址");
    }
    if (!/^https?:$/.test(parsedUrl.protocol)) {
      throw new Error("302 没有返回可播放的音频地址");
    }
    return { audioUrl, provider, voice };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("302 语音生成超时，请稍后重试");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
