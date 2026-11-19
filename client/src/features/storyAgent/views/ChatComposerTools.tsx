import { useRef } from "react";
import { Mic, Paperclip, X } from "lucide-react";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { RecordingGlyph, TranscribingGlyph } from "./VoiceInputGlyph";
import type { useVoiceInput } from "../hooks/useVoiceInput";

type Props = {
  horizontal: boolean;
  showAttachments: boolean;
  isReplying: boolean;
  isImportingMedia: boolean;
  soundDirectorActive: boolean;
  voice: Pick<ReturnType<typeof useVoiceInput>, "status">;
  onFiles: (files: File[]) => void;
  onVoice: () => void;
};

/** These controls prepare a draft; sending it remains the composer's responsibility. */
export function ChatComposerTools({ horizontal, showAttachments, isReplying,
  isImportingMedia, soundDirectorActive, voice, onFiles, onVoice }: Props) {
  const ui = useUiText();
  const fileInput = useRef<HTMLInputElement>(null);
  const { status } = voice;
  const filesDisabled = soundDirectorActive || status !== "idle" || isImportingMedia;
  // A pending reply owns the send operation, not the next draft or the stop button.
  const voiceDisabled = status === "transcribing" || (status === "idle" && isImportingMedia);
  const filesLabel = ui("添加图片、视频或文件 / Add files");
  const voiceLabel = ui({
    idle: "开始录音", requesting: "取消语音输入",
    recording: "停止录音", transcribing: "正在把声音转成文字…",
  }[status]);
  const replyHint = isReplying ? ` · ${ui("已收到，正在处理 · 可以继续输入")}` : "";
  return <div className="chat-dock-tools flex shrink-0 flex-col items-center gap-1">
    <div className={`flex ${horizontal ? "flex-row" : "flex-col"} items-center gap-1`}>
      {showAttachments && <>
        <button type="button" aria-label={filesLabel} title={filesLabel + replyHint}
          disabled={filesDisabled}
          className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          onClick={() => { if (!filesDisabled) fileInput.current?.click(); }}>
          <Paperclip className="h-3.5 w-3.5" />
        </button>
        <input ref={fileInput} type="file" accept="*/*" multiple className="hidden"
          onChange={event => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (!filesDisabled && files.length) onFiles(files);
          }} />
      </>}
      <button type="button" aria-label={voiceLabel}
        title={(status === "idle" ? ui("语音输入") : voiceLabel) + replyHint}
        disabled={voiceDisabled}
        className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
        style={status === "recording" ? { background: "var(--nayin-glow)", color: "var(--nayin-accent-bright)" } : undefined}
        onClick={() => { if (!voiceDisabled) onVoice(); }}>
        {status === "idle" && <Mic className="h-3.5 w-3.5" />}
        {status === "requesting" && <X className="h-3.5 w-3.5" />}
        {status === "recording" && <RecordingGlyph />}
        {status === "transcribing" && <TranscribingGlyph />}
      </button>
    </div>
  </div>;
}
