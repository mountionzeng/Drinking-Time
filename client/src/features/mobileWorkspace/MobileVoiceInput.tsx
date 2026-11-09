import React, { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { useVoiceInput } from "@/features/storyAgent/hooks/useVoiceInput";
import {
  liveRecognitionConstructor,
  startLiveDictation,
  type DictationState,
} from "./liveDictation";

type Props = {
  disabled: boolean;
  onText: (text: string) => void;
  onPreviewChange?: (text: string) => void;
  onBusyChange?: (busy: boolean) => void;
  onNoticeChange?: (notice: string) => void;
};

export function MobileVoiceInput(props: Props) {
  const [fallback, setFallback] = useState(false);
  const [state, setState] = useState<DictationState>("idle");
  const liveState = useRef<DictationState>("idle");
  const session = useRef<ReturnType<typeof startLiveDictation> | null>(null);
  const latest = useRef(props);
  latest.current = props;
  useEffect(
    () => () => {
      session.current?.dispose();
      latest.current.onBusyChange?.(false);
      latest.current.onPreviewChange?.("");
      latest.current.onNoticeChange?.("");
    },
    []
  );
  if (fallback) return <RecordedVoiceInput {...props} />;
  const busy = state !== "idle";
  const label = busy ? "停止听写" : "语音输入";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={busy}
      disabled={state === "stopping" || (props.disabled && !busy)}
      className={`flex size-11 shrink-0 items-center justify-center rounded-full disabled:opacity-40 ${busy ? "bg-primary/10 text-primary" : "text-primary"}`}
      onClick={() => {
        if (session.current && liveState.current !== "idle") {
          session.current.stop();
          return;
        }
        props.onNoticeChange?.("");
        const Recognition = liveRecognitionConstructor();
        if (!Recognition) {
          setFallback(true);
          return;
        }
        session.current?.dispose();
        try {
          session.current = startLiveDictation(new Recognition(), {
            onText: text => latest.current.onText(text),
            onPreview: text => latest.current.onPreviewChange?.(text),
            onError: message => latest.current.onNoticeChange?.(message),
            onState: next => {
              liveState.current = next;
              setState(next);
              latest.current.onBusyChange?.(next !== "idle");
            },
          });
        } catch {
          props.onNoticeChange?.(
            "无法启动实时听写，请使用键盘听写或换用 Safari、Chrome。"
          );
          setState("idle");
          liveState.current = "idle";
          props.onBusyChange?.(false);
        }
      }}
    >
      {state === "requesting" || state === "stopping" ? (
        <Loader2 size={20} className="animate-spin" />
      ) : busy ? (
        <Square size={18} />
      ) : (
        <Mic size={20} />
      )}
    </button>
  );
}

/** Unsupported browsers keep record-then-transcribe, without a second start button. */
function RecordedVoiceInput({
  disabled,
  onText,
  onBusyChange,
  onNoticeChange,
}: Props) {
  const latest = useRef({ onText, onNoticeChange });
  latest.current = { onText, onNoticeChange };
  const voice = useVoiceInput({
    onTranscribed: text => latest.current.onText(text),
    onError: message =>
      latest.current.onNoticeChange?.(
        /权限|麦克风|不支持录音|没有录到|没有识别/.test(message) &&
          message.length < 100
          ? message
          : "语音转写暂时不可用，请使用键盘听写或稍后重试。"
      ),
  });
  const toggle = useRef(voice.toggleRecording);
  toggle.current = voice.toggleRecording;
  useEffect(() => {
    latest.current.onNoticeChange?.(
      "此浏览器暂不支持实时听写，录完后转成文字。"
    );
    // Cancel StrictMode's throwaway mount before requesting microphone permission.
    const timer = setTimeout(() => toggle.current(), 0);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    onBusyChange?.(voice.isBusy);
    return () => onBusyChange?.(false);
  }, [voice.isBusy, onBusyChange]);
  const label = voice.isRecording
    ? "停止并转写"
    : voice.isTranscribing
      ? "正在转写…"
      : "语音输入";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={voice.isRecording}
      className="flex size-11 shrink-0 items-center justify-center rounded-full text-primary disabled:opacity-40"
      disabled={voice.isTranscribing || (disabled && !voice.isRecording)}
      onClick={() => voice.toggleRecording()}
    >
      {voice.isTranscribing ? (
        <Loader2 size={20} className="animate-spin" />
      ) : voice.isRecording ? (
        <Square size={18} />
      ) : (
        <Mic size={20} />
      )}
    </button>
  );
}
