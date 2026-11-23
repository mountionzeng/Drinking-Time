import { useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useUiText } from "@/features/uiLanguage/UiLanguage";

export function ChatVoiceOptions({ notice, allowLocal, disabled, onDismiss, onRecord, onFile, onFocusDraft }: {
  notice: string;
  allowLocal: boolean;
  disabled: boolean;
  onDismiss: () => void;
  onRecord: () => void;
  onFile: (file: File) => void;
  onFocusDraft?: () => void;
}) {
  const ui = useUiText();
  const [expanded, setExpanded] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const focusAfterClose = useRef<(() => void) | null>(null);
  const setOpen = (open: boolean) => {
    setExpanded(open);
    if (!open) onDismiss();
  };
  if (!allowLocal && !notice) return null;

  return <>
    <Popover open={expanded || Boolean(notice)} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={ui("录音选项")} title={ui("录音选项")}
          className="flex h-7 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground">
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" aria-label={ui("录音选项")}
        onOpenAutoFocus={event => { if (notice) event.preventDefault(); }}
        onCloseAutoFocus={event => {
          if (!focusAfterClose.current) return;
          event.preventDefault();
          focusAfterClose.current();
          focusAfterClose.current = null;
        }}
        className="max-w-[calc(100vw-1rem)] space-y-2 p-3 text-xs">
        <div className="flex items-start justify-between gap-2">
          {notice
            ? <p role="status">{ui(notice)}</p>
            : <p>{ui("停止后，录音会转成文字填入聊天输入框，最长两分钟。")}</p>}
          <button type="button" aria-label={ui("收起录音提示")} onClick={() => setOpen(false)}
            className="shrink-0 rounded p-1 hover:bg-muted"><X className="h-3.5 w-3.5" /></button>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="underline" disabled={disabled}
            onClick={() => {
              focusAfterClose.current = onFocusDraft ?? null;
              setOpen(false);
              if (!onFocusDraft) onRecord();
            }}>{ui(onFocusDraft ? "回到输入框" : allowLocal ? "本机录音" : "重试录音")}</button>
          {allowLocal && <button type="button" className="underline" disabled={disabled}
            onClick={() => fileInput.current?.click()}>{ui("选择录音转文字")}</button>}
        </div>
      </PopoverContent>
    </Popover>
    {allowLocal && <input ref={fileInput} type="file" accept="audio/*,.m4a,.webm" className="hidden"
      onChange={event => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (!file || disabled) return;
        setOpen(false);
        onFile(file);
      }} />}
  </>;
}
