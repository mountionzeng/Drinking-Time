import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  liveRecognitionConstructor,
  startLiveDictation,
} from "@/features/mobileWorkspace/liveDictation";

type VoiceInputStatus = "idle" | "requesting" | "recording" | "transcribing";

type UseVoiceInputOptions = {
  language?: string;
  onTranscribed: (text: string) => void;
  onError?: (message: string) => void;
  preferLive?: boolean;
  onPreview?: (text: string) => void;
  scopeKey?: string | number;
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function getRecorderMimeType(): string | undefined {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];

  return candidates.find(type => MediaRecorder.isTypeSupported(type));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (
      error.name === "NotAllowedError" ||
      error.name === "PermissionDeniedError"
    ) {
      return "麦克风权限被拒绝了，可以在浏览器地址栏左侧重新打开权限。";
    }
    if (error.name === "NotFoundError") {
      return "没有找到可用的麦克风。";
    }
  }

  return "语音转写暂时不可用，请使用键盘听写或稍后重试。";
}

export function useVoiceInput({
  language = "zh",
  onTranscribed,
  onError = message => alert(message),
  preferLive = false,
  onPreview,
  scopeKey,
}: UseVoiceInputOptions) {
  const [status, setStatus] = useState<VoiceInputStatus>("idle");
  const [isLive, setIsLive] = useState(false);
  const liveSession = useRef<ReturnType<typeof startLiveDictation> | null>(null);
  const liveActive = useRef(false);
  const callbacks = useRef({ onTranscribed, onPreview, onError });
  callbacks.current = { onTranscribed, onPreview, onError };
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const chunksRef = useRef<BlobPart[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const lifecycle = useRef(0);
  const starting = useRef(false);
  const transcribeMutation = trpc.voice.transcribe.useMutation();

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  }, []);

  const resetRecorder = useCallback(() => {
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    releaseStream();
  }, [releaseStream]);

  const stopRecording = useCallback(() => {
    if (liveActive.current) {
      liveSession.current?.stop();
      return;
    }
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      resetRecorder();
      setStatus("idle");
      return;
    }
    recorder.stop();
  }, [resetRecorder]);

  const startRecording = useCallback(async () => {
    if (status !== "idle" || starting.current || liveActive.current) return;
    const epoch = lifecycle.current;
    const active = () => mountedRef.current && lifecycle.current === epoch && currentScope.current === scopeKey;
    const Recognition = preferLive ? liveRecognitionConstructor() : undefined;
    if (Recognition) {
      liveSession.current?.dispose();
      setIsLive(true);
      try {
        liveSession.current = startLiveDictation(new Recognition(), {
          onText: text => { if (active()) callbacks.current.onTranscribed(text); },
          onPreview: text => { if (active()) callbacks.current.onPreview?.(text); },
          onError: message => { if (active()) callbacks.current.onError(message); },
          onState: next => {
            if (!active()) return;
            liveActive.current = next !== "idle";
            setStatus(next === "listening" ? "recording" : next === "stopping" ? "transcribing" : next);
          },
        });
      } catch {
        liveActive.current = false;
        setStatus("idle");
        callbacks.current.onError("无法启动实时听写，请检查浏览器的麦克风与语音识别权限。");
      }
      return;
    }
    setIsLive(false);
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      onError("当前浏览器不支持录音，请换 Chrome 或 Safari 新版本再试。");
      return;
    }

    starting.current = true;
    setStatus("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!active()) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current = stream;
      const mimeType = getRecorderMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      );

      streamRef.current = stream;
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = event => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        if (!active()) return;
        onError("录音失败，请检查麦克风后再试。");
        resetRecorder();
        if (mountedRef.current) setStatus("idle");
      };

      recorder.onstop = async () => {
        const chunks = chunksRef.current;
        const outputMimeType = recorder.mimeType || mimeType || "audio/webm";

        if (!active()) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        releaseStream();

        setStatus("transcribing");

        try {
          const audioBlob = new Blob(chunks, { type: outputMimeType });
          if (audioBlob.size === 0) {
            onError("没有录到声音，可以再试一次。");
            return;
          }

          const audioBase64 = await blobToBase64(audioBlob);
          if (!active()) return;
          const result = await transcribeMutation.mutateAsync({
            audioBase64,
            mimeType: outputMimeType,
            language,
          });
          if (!active()) return;
          const text = result.text.trim();

          if (!text) {
            onError("这段语音没有识别出文字，可以再说一遍。");
            return;
          }

          onTranscribed(text);
        } catch (error) {
          if (active()) onError(getErrorMessage(error));
        } finally {
          if (active()) {
            resetRecorder();
            setStatus("idle");
          }
        }
      };

      recorder.start();
      setStatus("recording");
    } catch (error) {
      if (active()) {
        resetRecorder();
        setStatus("idle");
        onError(getErrorMessage(error));
      }
    } finally {
      starting.current = false;
    }
  }, [
    language,
    onError,
    onTranscribed,
    resetRecorder,
    releaseStream,
    status,
    transcribeMutation,
    preferLive,
    scopeKey,
  ]);

  const toggleRecording = useCallback(() => {
    if (status === "recording") {
      stopRecording();
      return;
    }
    if (status === "idle") {
      void startRecording();
    }
  }, [startRecording, status, stopRecording]);

  useEffect(() => {
    mountedRef.current = true;
    starting.current = false;
    setStatus("idle");
    return () => {
      lifecycle.current += 1;
      mountedRef.current = false;
      liveSession.current?.dispose();
      liveSession.current = null;
      liveActive.current = false;
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
      releaseStream();
    };
  }, [releaseStream, scopeKey]);

  return {
    status,
    isLive,
    isRecording: status === "recording",
    isTranscribing: status === "transcribing" || status === "requesting",
    isBusy: status !== "idle",
    toggleRecording,
    stopRecording,
  };
}
