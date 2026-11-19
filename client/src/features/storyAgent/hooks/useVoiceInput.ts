import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { LOCAL_VOICE_MAX_BYTES, LOCAL_VOICE_MAX_SECONDS } from "@shared/localVoiceInput";
import {
  liveRecognitionConstructor,
  startLiveDictation,
  type DictationState,
} from "@/features/mobileWorkspace/liveDictation";

type VoiceInputStatus = "idle" | "requesting" | "recording" | "transcribing";

type UseVoiceInputOptions = {
  language?: string;
  onTranscribed: (text: string) => void;
  onError?: (message: string) => void;
  preferLive?: boolean;
  allowLocalTranscription?: boolean;
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
  allowLocalTranscription = false,
  onPreview,
  scopeKey,
}: UseVoiceInputOptions) {
  const [status, setStatus] = useState<VoiceInputStatus>("idle");
  const [isLive, setIsLive] = useState(false);
  const [localRecovery, setLocalRecovery] = useState(false);
  const liveSession = useRef<ReturnType<typeof startLiveDictation> | null>(null);
  const liveState = useRef<DictationState>("idle");
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
  const transcribing = useRef(false);
  const recordingLimit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcribeMutation = trpc.voice.transcribe.useMutation();
  const localMutation = trpc.voice.transcribeLocal.useMutation();

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  }, []);

  const resetRecorder = useCallback(() => {
    if (recordingLimit.current !== null) clearTimeout(recordingLimit.current);
    recordingLimit.current = null;
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    releaseStream();
  }, [releaseStream]);

  const stopRecording = useCallback(() => {
    if (liveState.current === "requesting") {
      liveSession.current?.cancelStart();
      return;
    }
    if (liveState.current !== "idle") {
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

  const transcribeBlob = useCallback(async (audio: Blob, local: boolean, active: () => boolean) => {
    if (transcribing.current || !active()) return;
    if (!audio.size || (local && audio.size > LOCAL_VOICE_MAX_BYTES)) {
      callbacks.current.onError(audio.size ? "请选择 8 MB 以内的录音。" : "没有录到声音，可以再试一次。");
      setStatus("idle");
      return;
    }
    transcribing.current = true;
    setStatus("transcribing");
    try {
      const audioBase64 = await blobToBase64(audio);
      if (!active()) return;
      const result = local
        ? await localMutation.mutateAsync({ audioBase64 })
        : await transcribeMutation.mutateAsync({ audioBase64, mimeType: audio.type, language });
      if (!active()) return;
      if ("error" in result) callbacks.current.onError(result.error);
      else if (result.text.trim()) callbacks.current.onTranscribed(result.text.trim());
      else callbacks.current.onError("这段语音没有识别出文字，可以再说一遍。");
    } catch (error) {
      if (active()) callbacks.current.onError(local ? "本机转写未完成，请检查本机语音模型和音频解码环境。" : getErrorMessage(error));
    } finally {
      if (active()) {
        transcribing.current = false;
        setStatus("idle");
      }
    }
  }, [language, localMutation, transcribeMutation]);

  const transcribeLocalFile = async (file: File) => {
    if (!allowLocalTranscription || status !== "idle" || starting.current || liveState.current !== "idle") return;
    const epoch = lifecycle.current;
    await transcribeBlob(file, true, () => mountedRef.current && lifecycle.current === epoch && currentScope.current === scopeKey);
  };

  const startRecording = useCallback(async (localOnly = false) => {
    if (localOnly && !allowLocalTranscription) return;
    if (status !== "idle" || starting.current || transcribing.current || liveState.current !== "idle") return;
    const epoch = lifecycle.current;
    const active = () => mountedRef.current && lifecycle.current === epoch && currentScope.current === scopeKey;
    const Recognition = preferLive && !localRecovery && !localOnly ? liveRecognitionConstructor() : undefined;
    if (Recognition) {
      liveSession.current?.dispose();
      setIsLive(true);
      try {
        liveSession.current = startLiveDictation(new Recognition(), {
          onText: text => { if (active()) callbacks.current.onTranscribed(text); },
          onPreview: text => { if (active()) callbacks.current.onPreview?.(text); },
          onError: message => {
            if (!active()) return;
            if (allowLocalTranscription) setLocalRecovery(true);
            callbacks.current.onError(message);
          },
          onState: next => {
            if (!active()) return;
            liveState.current = next;
            setStatus(next === "listening" ? "recording" : next === "stopping" ? "transcribing" : next);
          },
        });
      } catch {
        liveState.current = "idle";
        setStatus("idle");
        if (allowLocalTranscription) setLocalRecovery(true);
        callbacks.current.onError("无法启动实时听写，请检查浏览器的麦克风与语音识别权限。");
      }
      return;
    }
    setIsLive(false);
    if (allowLocalTranscription) setLocalRecovery(true);
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
        resetRecorder();
        await transcribeBlob(new Blob(chunks, { type: outputMimeType }), allowLocalTranscription, active);
      };

      recorder.start();
      if (allowLocalTranscription) {
        recordingLimit.current = setTimeout(() => {
          if (active() && recorder.state === "recording") recorder.stop();
        }, (LOCAL_VOICE_MAX_SECONDS - 1) * 1000);
      }
      setStatus("recording");
    } catch (error) {
      if (active()) {
        resetRecorder();
        setStatus("idle");
        onError(getErrorMessage(error));
      }
    } finally {
      if (active()) starting.current = false;
    }
  }, [
    onError,
    resetRecorder,
    status,
    transcribeBlob,
    allowLocalTranscription,
    localRecovery,
    preferLive,
    scopeKey,
  ]);

  const toggleRecording = useCallback(() => {
    if (liveState.current !== "idle" || status === "recording") {
      stopRecording();
      return;
    }
    if (starting.current) {
      // getUserMedia cannot be aborted. Its late stream belongs to the cancelled request.
      lifecycle.current += 1;
      starting.current = false;
      setStatus("idle");
      return;
    }
    if (status === "idle") {
      void startRecording();
    }
  }, [startRecording, status, stopRecording]);

  useEffect(() => {
    mountedRef.current = true;
    starting.current = false;
    transcribing.current = false;
    setLocalRecovery(false);
    setStatus("idle");
    return () => {
      if (recordingLimit.current !== null) clearTimeout(recordingLimit.current);
      lifecycle.current += 1;
      mountedRef.current = false;
      liveSession.current?.dispose();
      liveSession.current = null;
      liveState.current = "idle";
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
    localRecovery,
    transcribeLocalFile,
    startLocalRecording: () => startRecording(true),
    isRecording: status === "recording",
    isTranscribing: status === "transcribing" || status === "requesting",
    isBusy: status !== "idle",
    toggleRecording,
    stopRecording,
  };
}
