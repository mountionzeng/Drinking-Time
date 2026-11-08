import { logMediaUnknown, startMediaDiagnostics, trackMediaResponse } from "./mediaUnknownLog";
import { guardComputeFetch, ComputeAccessError } from "./computeRequestAccess";
import { ENV } from "../_core/env";

type StoryVoiceFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

// Fixed per-provider model: changing it also invalidates that provider's quotes.
export const MINIMAX_NARRATION_MODEL = "speech-2.8-turbo";
export const ELEVENLABS_NARRATION_MODEL = "eleven_multilingual_v2";
// Keep this preset paired with the signed narration price version.
export const ELEVENLABS_NARRATION_SETTINGS = {
  stability: 0.35, similarity_boost: 0.75, style: 0, speed: 0.94,
  use_speaker_boost: true,
} as const;

export function narrationModelForProvider(provider: string): string | undefined {
  if (provider === "minimaxi") return MINIMAX_NARRATION_MODEL;
  if (provider === "elevenlabs") return ELEVENLABS_NARRATION_MODEL;
  // The 302 wrapper does not disclose Doubao's backing model revision.
  if (provider === "doubao") return "doubao-tts-unversioned";
  return undefined;
}

export type StoryVoice302Result = {
  audioUrl: string;
  provider: string;
  voice: string;
};

export class StoryVoice302Error extends Error {
  readonly outcome:
    | "not_charged_failure"
    | "charged_failure"
    | "submission_unknown";

  constructor(
    outcome: "not_charged_failure" | "charged_failure" | "submission_unknown",
    message: string
  ) {
    super(message);
    this.name = "StoryVoice302Error";
    this.outcome = outcome;
  }
}

function positiveInteger(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function safeOption(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 80 || !/^[\w.-]+$/i.test(normalized)) {
    throw new StoryVoice302Error("not_charged_failure", `${label}配置无效`);
  }
  return normalized;
}

const ERROR_BODY_LIMIT = 300;

/** 脱敏：去掉 Bearer/sk-/key=/token 等可能出现在上游错误体里的凭据。 */
export function redactUpstreamErrorBody(raw: string): string {
  return raw
    .replace(/(authorization["']?\s*[:=]\s*["']?)(bearer\s+)?[^"',\s}]+/gi, "$1***")
    .replace(/bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***")
    .replace(/\bsk-[A-Za-z0-9._-]+/g, "sk-***")
    .replace(/((?:api[_-]?key|token|secret|access[_-]?key)["']?\s*[:=]\s*["']?)[^"',\s}&]+/gi, "$1***")
    .replace(/\s+/g, " ")
    .slice(0, ERROR_BODY_LIMIT);
}

async function readErrorBodySnippet(response: Response): Promise<string> {
  try {
    return redactUpstreamErrorBody(await response.text());
  } catch {
    return "";
  }
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
  if (!narration)
    throw new StoryVoice302Error("not_charged_failure", "旁白文字不能为空");
  if (narration.length > 5_000) {
    throw new StoryVoice302Error(
      "not_charged_failure",
      "单镜旁白不能超过 5000 个字符"
    );
  }

  const apiKey = input.apiKey ?? ENV.api302Key;
  if (!apiKey.trim())
    throw new StoryVoice302Error("not_charged_failure", "尚未配置 302 API Key");
  const provider = safeOption(
    input.provider ?? ENV.tts302Provider,
    "语音服务商"
  );
  const voice = safeOption(input.voice ?? ENV.tts302Voice, "语音音色");
  const baseUrl = (input.baseUrl ?? ENV.api302BaseUrl)
    .trim()
    .replace(/\/+$/, "");
  if (!baseUrl)
    throw new StoryVoice302Error("not_charged_failure", "302 API 地址未配置");

  const diag = startMediaDiagnostics("tts");
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? positiveInteger(ENV.tts302TimeoutMs, 60_000)
  );
  try {
    const isMiniMax = provider === "minimaxi";
    const isElevenLabs = provider === "elevenlabs";
    const endpoint = isMiniMax ? "/minimaxi/v1/t2a_v2"
      : isElevenLabs ? `/elevenlabs/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128&response_format=url`
      : "/302/tts/generate";
    const response = await trackMediaResponse(guardComputeFetch(input.fetcher ?? fetch), diag)(
      `${baseUrl}${endpoint}`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(isMiniMax ? {
          model: MINIMAX_NARRATION_MODEL,
          text: narration,
          stream: false,
          output_format: "url",
          voice_setting: { voice_id: voice, speed: 1, vol: 1, pitch: 0 },
          audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 },
        } : isElevenLabs ? {
          text: narration, model_id: ELEVENLABS_NARRATION_MODEL,
          voice_settings: ELEVENLABS_NARRATION_SETTINGS,
        } : { text: narration, provider, voice }),
        signal: controller.signal,
      }
    );
    if (!response.ok) {
      const bodySnippet = await readErrorBodySnippet(response);
      console.warn("[302 TTS] 上游返回非 2xx", {
        httpStatus: response.status,
        body: bodySnippet,
      });
      // 302 明确回 500 且没有给音频地址：供应商已确认失败、没有产出，可以释放预占。
      // 408/429/502/503/504 等可能已接单或网关中断，仍保持结果未知。
      const confirmedFailure =
        !isMiniMax && !isElevenLabs && provider !== "doubao" && response.status === 500 && !/audio_url/i.test(bodySnippet);
      throw new StoryVoice302Error(
        confirmedFailure ||
          !(
            response.status === 408 ||
            response.status === 429 ||
            response.status >= 500
          )
          ? "not_charged_failure"
          : "submission_unknown",
        `302 语音生成失败（HTTP ${response.status}）`
      );
    }
    const payload = (await response.json()) as {
      audio_url?: unknown;
      url?: unknown;
      base_resp?: { status_code?: number };
      data?: { audio?: unknown; status?: number };
    };
    if (isMiniMax && (payload.base_resp?.status_code !== 0 || payload.data?.status !== 2)) {
      throw new StoryVoice302Error("submission_unknown", "302 MiniMax 未确认语音生成成功，不会自动重试");
    }
    const rawUrl = isMiniMax ? payload.data?.audio : isElevenLabs ? payload.url : payload.audio_url;
    const audioUrl = typeof rawUrl === "string" ? rawUrl.trim() : "";
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(audioUrl);
    } catch {
      throw new StoryVoice302Error(
        "charged_failure",
        "302 没有返回可播放的音频地址"
      );
    }
    if (parsedUrl.protocol !== "https:") {
      throw new StoryVoice302Error(
        "charged_failure",
        "302 没有返回可播放的音频地址"
      );
    }
    return { audioUrl, provider, voice };
  } catch (error) {
    if (!(error instanceof ComputeAccessError) && (!(error instanceof StoryVoice302Error) || error.outcome === "submission_unknown"))
      logMediaUnknown(diag, error instanceof Error ? error.message : "unknown");
    if (error instanceof ComputeAccessError)
      throw new StoryVoice302Error("not_charged_failure", error.message);
    if (error instanceof Error && error.name === "AbortError") {
      throw new StoryVoice302Error(
        "submission_unknown",
        "302 语音生成超时；请求结果未知，不会自动重试"
      );
    }
    if (error instanceof StoryVoice302Error) throw error;
    if (error instanceof TypeError) {
      throw new StoryVoice302Error(
        "submission_unknown",
        "302 语音请求连接中断；结果未知，不会自动重试"
      );
    }
    throw new StoryVoice302Error(
      "submission_unknown",
      "302 语音响应无法确认，不会自动重试"
    );
  } finally {
    clearTimeout(timeout);
  }
}
