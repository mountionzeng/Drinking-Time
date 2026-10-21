import React, { useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { useVoiceInput } from "@/features/storyAgent/hooks/useVoiceInput";

export function MobileVoiceInput(props: {
  disabled: boolean;
  onText: (text: string) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  return enabled ? (
    <RecordingControl {...props} />
  ) : (
    <button
      type="button"
      aria-label="语音输入"
      title="语音输入"
      disabled={props.disabled}
      className="flex size-11 shrink-0 items-center justify-center rounded-full text-primary disabled:opacity-40"
      onClick={() => setEnabled(true)}
    >
      <Mic size={20} />
    </button>
  );
}

function RecordingControl({
  disabled,
  onText,
  onBusyChange,
}: {
  disabled: boolean;
  onText: (text: string) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [error, setError] = useState("");
  // 录音开始后用户仍可能编辑草稿；完成时必须追加到最新内容。
  const latest = useRef(onText);
  latest.current = onText;
  const voice = useVoiceInput({
    onTranscribed: text => latest.current(text),
    onError: setError,
  });
  useEffect(() => {
    onBusyChange?.(voice.isBusy);
    return () => onBusyChange?.(false);
  }, [voice.isBusy, onBusyChange]);
  return (
    <div className="max-w-24 shrink-0 text-xs">
      <button
        type="button"
        className="min-h-11 px-2 text-primary disabled:opacity-40"
        disabled={voice.isTranscribing || (disabled && !voice.isRecording)}
        onClick={() => {
          setError("");
          voice.toggleRecording();
        }}
      >
        {voice.isRecording
          ? "停止并转写"
          : voice.isTranscribing
            ? "正在转写…"
            : "开始录音"}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
