/**
 * Voice transcription helper using internal Speech-to-Text service
 *
 * Frontend implementation guide:
 * 1. Capture audio using MediaRecorder API
 * 2. Upload audio to storage (e.g., S3) to get URL
 * 3. Call transcription with the URL
 * 
 * Example usage:
 * ```tsx
 * // Frontend component
 * const transcribeMutation = trpc.voice.transcribe.useMutation({
 *   onSuccess: (data) => {
 *     console.log(data.text); // Full transcription
 *     console.log(data.language); // Detected language
 *     console.log(data.segments); // Timestamped segments
 *   }
 * });
 * 
 * // After uploading audio to storage
 * transcribeMutation.mutate({
 *   audioUrl: uploadedAudioUrl,
 *   language: 'en', // optional
 *   prompt: 'Transcribe the meeting' // optional
 * });
 * ```
 */
import { ENV } from "./env";

export type TranscribeOptions = {
  audioUrl: string; // URL to the audio file (e.g., S3 URL)
  language?: string; // Optional: specify language code (e.g., "en", "es", "zh")
  prompt?: string; // Optional: custom prompt for the transcription
};

export type TranscribeBytesOptions = {
  audioBase64: string;
  mimeType: string;
  language?: string;
  prompt?: string;
};

// Native Whisper API segment format
export type WhisperSegment = {
  id: number;
  seek: number;
  start: number;
  end: number;
  text: string;
  tokens: number[];
  temperature: number;
  avg_logprob: number;
  compression_ratio: number;
  no_speech_prob: number;
};

// Native Whisper API response format
export type WhisperResponse = {
  task: "transcribe";
  language: string;
  duration: number;
  text: string;
  segments: WhisperSegment[];
};

export type TranscriptionResponse = WhisperResponse; // Return native Whisper API response directly

export type TranscriptionError = {
  error: string;
  code: "FILE_TOO_LARGE" | "INVALID_FORMAT" | "TRANSCRIPTION_FAILED" | "UPLOAD_FAILED" | "SERVICE_ERROR";
  details?: string;
};

/**
 * Transcribe audio to text using the internal Speech-to-Text service
 * 
 * @param options - Audio data and metadata
 * @returns Transcription result or error
 */
export async function transcribeAudio(
  options: TranscribeOptions
): Promise<TranscriptionResponse | TranscriptionError> {
  try {
    const envError = validateTranscriptionEnv();
    if (envError) return envError;

    // Step 1: Download audio from URL
    let audioBuffer: Buffer;
    let mimeType: string;
    try {
      const response = await fetch(options.audioUrl);
      if (!response.ok) {
        return {
          error: "Failed to download audio file",
          code: "INVALID_FORMAT",
          details: `HTTP ${response.status}: ${response.statusText}`
        };
      }

      audioBuffer = Buffer.from(await response.arrayBuffer());
      mimeType = response.headers.get('content-type') || 'audio/mpeg';
    } catch (error) {
      return {
        error: "Failed to fetch audio file",
        code: "SERVICE_ERROR",
        details: error instanceof Error ? error.message : "Unknown error"
      };
    }

    return postWhisperTranscription({
      audioBuffer,
      mimeType,
      language: options.language,
      prompt: options.prompt,
    });

  } catch (error) {
    // Handle unexpected errors
    return {
      error: "Voice transcription failed",
      code: "SERVICE_ERROR",
      details: error instanceof Error ? error.message : "An unexpected error occurred"
    };
  }
}

/**
 * Transcribe browser-recorded audio without uploading it to storage first.
 */
export async function transcribeAudioBytes(
  options: TranscribeBytesOptions
): Promise<TranscriptionResponse | TranscriptionError> {
  try {
    const envError = validateTranscriptionEnv();
    if (envError) return envError;

    const audioBase64 = stripDataUrlPrefix(options.audioBase64);
    const audioBuffer = Buffer.from(audioBase64, "base64");

    return postWhisperTranscription({
      audioBuffer,
      mimeType: options.mimeType || "audio/webm",
      language: options.language,
      prompt: options.prompt,
    });
  } catch (error) {
    return {
      error: "Voice transcription failed",
      code: "SERVICE_ERROR",
      details: error instanceof Error ? error.message : "An unexpected error occurred"
    };
  }
}

type PostWhisperOptions = {
  audioBuffer: Buffer;
  mimeType: string;
  language?: string;
  prompt?: string;
};

function validateTranscriptionEnv(): TranscriptionError | null {
  if (!ENV.forgeApiUrl) {
    return {
      error: "Voice transcription service is not configured",
      code: "SERVICE_ERROR",
      details: "BUILT_IN_FORGE_API_URL is not set"
    };
  }
  if (!ENV.forgeApiKey) {
    return {
      error: "Voice transcription service authentication is missing",
      code: "SERVICE_ERROR",
      details: "BUILT_IN_FORGE_API_KEY is not set"
    };
  }
  return null;
}

async function postWhisperTranscription(
  options: PostWhisperOptions
): Promise<TranscriptionResponse | TranscriptionError> {
  const sizeMB = options.audioBuffer.length / (1024 * 1024);
  if (options.audioBuffer.length === 0) {
    return {
      error: "Audio file is empty",
      code: "INVALID_FORMAT",
      details: "No audio bytes were provided"
    };
  }
  if (sizeMB > 16) {
    return {
      error: "Audio file exceeds maximum size limit",
      code: "FILE_TOO_LARGE",
      details: `File size is ${sizeMB.toFixed(2)}MB, maximum allowed is 16MB`
    };
  }

  // Create FormData for multipart upload to Whisper API.
  const formData = new FormData();

  const filename = `audio.${getFileExtension(options.mimeType)}`;
  const audioBlob = new Blob([new Uint8Array(options.audioBuffer)], {
    type: options.mimeType,
  });
  formData.append("file", audioBlob, filename);

  formData.append("model", ENV.voiceTranscriptionModel);
  formData.append("response_format", "verbose_json");

  if (options.language) {
    formData.append("language", options.language);
  }

  const prompt = options.prompt || (
    options.language
      ? `Transcribe the user's voice to text, the user's working language is ${getLanguageName(options.language)}`
      : "Transcribe the user's voice to text"
  );
  formData.append("prompt", prompt);

  const response = await fetch(getTranscriptionUrl(), {
    method: "POST",
    headers: {
      authorization: `Bearer ${ENV.forgeApiKey}`,
      "Accept-Encoding": "identity",
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    return {
      error: "Transcription service request failed",
      code: "TRANSCRIPTION_FAILED",
      details: formatTranscriptionServiceError({
        status: response.status,
        statusText: response.statusText,
        body: errorText,
        model: ENV.voiceTranscriptionModel,
      })
    };
  }

  const whisperResponse = await response.json() as WhisperResponse;

  if (!whisperResponse.text || typeof whisperResponse.text !== 'string') {
    return {
      error: "Invalid transcription response",
      code: "SERVICE_ERROR",
      details: "Transcription service returned an invalid response format"
    };
  }

  return whisperResponse;
}

function getTranscriptionUrl(): string {
  const baseUrl = ENV.forgeApiUrl.endsWith("/")
    ? ENV.forgeApiUrl
    : `${ENV.forgeApiUrl}/`;
  const base = new URL(baseUrl);
  const normalizedPath = base.pathname.replace(/\/+$/, "");
  const relativePath = normalizedPath.endsWith("/v1")
    ? "audio/transcriptions"
    : "v1/audio/transcriptions";

  return new URL(relativePath, `${base.toString().replace(/\/+$/, "")}/`).toString();
}

function stripDataUrlPrefix(audioBase64: string): string {
  const marker = "base64,";
  const markerIndex = audioBase64.indexOf(marker);
  if (markerIndex === -1) return audioBase64;
  return audioBase64.slice(markerIndex + marker.length);
}

function formatTranscriptionServiceError(options: {
  status: number;
  statusText: string;
  body: string;
  model: string;
}): string {
  const fallback = `${options.status} ${options.statusText}${options.body ? `: ${options.body}` : ""}`;
  if (!options.body) return fallback;

  try {
    const parsed = JSON.parse(options.body) as {
      error?: {
        err_code?: number;
        message?: string;
        message_cn?: string;
        type?: string;
      };
      message?: string;
    };
    const message = parsed.error?.message_cn || parsed.error?.message || parsed.message || "";
    const disabledByPermission = parsed.error?.err_code === -10013
      || /permission denied|disabled|权限不足|模型已被禁用/i.test(message);

    if (disabledByPermission) {
      return [
        `302 API Key 没有语音转写模型权限，当前模型：${options.model}。`,
        "请到 302.AI 的 API Key / 模型权限里开启一个语音转写模型，",
        "或在项目 .env 中设置 VOICE_TRANSCRIPTION_MODEL 为这个 key 可用的转写模型。",
      ].join("");
    }

    if (message) {
      return `${options.status} ${options.statusText}: ${message}`;
    }
  } catch {
    // Non-JSON service errors fall through to the raw fallback for debugging.
  }

  return fallback;
}

/**
 * Helper function to get file extension from MIME type
 */
function getFileExtension(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/mp3': 'mp3',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/wave': 'wav',
    'audio/ogg': 'ogg',
    'audio/m4a': 'm4a',
    'audio/mp4': 'm4a',
  };
  
  return mimeToExt[mimeType] || 'audio';
}

/**
 * Helper function to get full language name from ISO code
 */
function getLanguageName(langCode: string): string {
  const langMap: Record<string, string> = {
    'en': 'English',
    'es': 'Spanish',
    'fr': 'French',
    'de': 'German',
    'it': 'Italian',
    'pt': 'Portuguese',
    'ru': 'Russian',
    'ja': 'Japanese',
    'ko': 'Korean',
    'zh': 'Chinese',
    'ar': 'Arabic',
    'hi': 'Hindi',
    'nl': 'Dutch',
    'pl': 'Polish',
    'tr': 'Turkish',
    'sv': 'Swedish',
    'da': 'Danish',
    'no': 'Norwegian',
    'fi': 'Finnish',
  };
  
  return langMap[langCode] || langCode;
}

/**
 * Example tRPC procedure implementation:
 * 
 * ```ts
 * // In server/routers.ts
 * import { transcribeAudio } from "./_core/voiceTranscription";
 * 
 * export const voiceRouter = router({
 *   transcribe: protectedProcedure
 *     .input(z.object({
 *       audioUrl: z.string(),
 *       language: z.string().optional(),
 *       prompt: z.string().optional(),
 *     }))
 *     .mutation(async ({ input, ctx }) => {
 *       const result = await transcribeAudio(input);
 *       
 *       // Check if it's an error
 *       if ('error' in result) {
 *         throw new TRPCError({
 *           code: 'BAD_REQUEST',
 *           message: result.error,
 *           cause: result,
 *         });
 *       }
 *       
 *       // Optionally save transcription to database
 *       await db.insert(transcriptions).values({
 *         userId: ctx.user.id,
 *         text: result.text,
 *         duration: result.duration,
 *         language: result.language,
 *         audioUrl: input.audioUrl,
 *         createdAt: new Date(),
 *       });
 *       
 *       return result;
 *     }),
 * });
 * ```
 */
