/**
 * Voice transcription helper using Volcengine (Doubao) recording-file ASR.
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
import { randomUUID } from "node:crypto";
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

// Kept for compatibility with callers that may consume a verbose transcript.
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

export type TranscriptionResponse = WhisperResponse;

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

    return postDoubaoTranscription({
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

    return postDoubaoTranscription({
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

type PostDoubaoOptions = {
  audioBuffer: Buffer;
  mimeType: string;
  language?: string;
  prompt?: string;
};

function validateTranscriptionEnv(): TranscriptionError | null {
  if (!ENV.doubaoSpeechApiKey) {
    return {
      error: "Voice transcription service authentication is missing",
      code: "SERVICE_ERROR",
      details: "DOUBAO_SPEECH_API_KEY is not set"
    };
  }
  return null;
}

async function postDoubaoTranscription(
  options: PostDoubaoOptions
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

  const response = await fetch("https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": ENV.doubaoSpeechApiKey,
      "X-Api-Resource-Id": "volc.bigasr.auc_turbo",
      "X-Api-Request-Id": randomUUID(),
      "X-Api-Sequence": "-1",
    },
    body: JSON.stringify({
      user: { uid: ENV.doubaoSpeechApiKey },
      audio: { data: options.audioBuffer.toString("base64") },
      request: { model_name: "bigmodel" },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    const doubaoDetails = formatDoubaoServiceError({
      status: response.status,
      statusText: response.statusText,
      body: errorText,
    });

    if (isDoubaoResourceNotGranted(response.status, errorText) && ENV.api302Key) {
      const fallbackResult = await post302Transcription(options);
      if (!("error" in fallbackResult)) return fallbackResult;

      return {
        error: "Transcription service request failed",
        code: "TRANSCRIPTION_FAILED",
        details: `豆包失败：${doubaoDetails}；302 回退失败：${fallbackResult.details || fallbackResult.error}`,
      };
    }

    return {
      error: "Transcription service request failed",
      code: "TRANSCRIPTION_FAILED",
      details: doubaoDetails,
    };
  }

  const doubaoResponse = await response.json() as DoubaoResponse;
  const text = doubaoResponse.result?.text ?? doubaoResponse.data?.text;

  if (!text || typeof text !== "string") {
    return {
      error: "Transcription service request failed",
      code: "TRANSCRIPTION_FAILED",
      details: doubaoResponse.message || "Transcription service returned an invalid response format"
    };
  }

  return {
    task: "transcribe",
    language: options.language || "",
    duration: 0,
    text,
    segments: [],
  };
}

async function post302Transcription(
  options: PostDoubaoOptions,
): Promise<TranscriptionResponse | TranscriptionError> {
  const formData = new FormData();
  formData.append("file", new Blob([new Uint8Array(options.audioBuffer)], {
    type: options.mimeType,
  }), `audio.${getFileExtension(options.mimeType)}`);
  formData.append("model", ENV.voiceTranscriptionFallbackModel);
  if (options.language) formData.append("language", options.language);

  const baseUrl = (ENV.api302BaseUrl || "https://api.302.ai").replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ENV.api302Key}` },
    body: formData,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return {
      error: "302 transcription fallback failed",
      code: "TRANSCRIPTION_FAILED",
      details: formatGenericServiceError(response.status, response.statusText, body),
    };
  }

  const result = await response.json() as Partial<WhisperResponse>;
  if (!result.text || typeof result.text !== "string") {
    return {
      error: "302 transcription fallback failed",
      code: "TRANSCRIPTION_FAILED",
      details: "302 returned an invalid transcription response",
    };
  }

  return {
    task: result.task || "transcribe",
    language: result.language || options.language || "",
    duration: result.duration || 0,
    text: result.text,
    segments: result.segments || [],
  };
}

function stripDataUrlPrefix(audioBase64: string): string {
  const marker = "base64,";
  const markerIndex = audioBase64.indexOf(marker);
  if (markerIndex === -1) return audioBase64;
  return audioBase64.slice(markerIndex + marker.length);
}

type DoubaoResponse = {
  result?: { text?: string };
  data?: { text?: string };
  message?: string;
};

function isDoubaoResourceNotGranted(status: number, body: string): boolean {
  if (status !== 403) return false;

  try {
    const parsed = JSON.parse(body) as {
      code?: number | string;
      message?: string;
      header?: { code?: number | string; message?: string };
    };
    return String(parsed.code ?? parsed.header?.code ?? "") === "45000030"
      || /requested resource not granted/i.test(parsed.message || parsed.header?.message || "");
  } catch {
    return /requested resource not granted/i.test(body);
  }
}

function formatDoubaoServiceError(options: {
  status: number;
  statusText: string;
  body: string;
}): string {
  const fallback = `${options.status} ${options.statusText}${options.body ? `: ${options.body}` : ""}`;
  if (!options.body) return fallback;

  try {
    const parsed = JSON.parse(options.body) as { message?: string; error?: { message?: string } };
    const message = parsed.message || parsed.error?.message || "";

    if (message) {
      return `${options.status} ${options.statusText}: ${message}`;
    }
  } catch {
    // Non-JSON service errors fall through to the raw fallback for debugging.
  }

  return fallback;
}

function formatGenericServiceError(status: number, statusText: string, body: string): string {
  const fallback = `${status} ${statusText}${body ? `: ${body}` : ""}`;
  if (!body) return fallback;

  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string; message_cn?: string };
      message?: string;
    };
    const message = parsed.error?.message_cn || parsed.error?.message || parsed.message;
    return message ? `${status} ${statusText}: ${message}` : fallback;
  } catch {
    return fallback;
  }
}

function getFileExtension(mimeType: string): string {
  const normalizedMimeType = mimeType.split(";", 1)[0]?.trim().toLowerCase();
  const mimeToExt: Record<string, string> = {
    "audio/webm": "webm",
    "audio/mp3": "mp3",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/ogg": "ogg",
    "audio/m4a": "m4a",
    "audio/mp4": "m4a",
  };
  return mimeToExt[normalizedMimeType] || "audio";
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
