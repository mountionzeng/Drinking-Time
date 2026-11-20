import { useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useUiLanguage } from "@/features/uiLanguage/UiLanguage";

export function ChatPhotoPreview({ src, name, imageId, saved = false, onReference }: { src: string; imageId?: number; name: string; saved?: boolean; onReference?: () => void }) {
  const { language } = useUiLanguage();
  const [actual, setActual] = useState(false);
  const [open, setOpen] = useState(false);
  const en = language === "en";
  const label = en ? `View full image: ${name}` : `查看大图：${name}`;
  const hint = en ? "Hover to enlarge and select · Click to reference · Alt+Enter for full image" : "悬停放大并框选 · 单击引用 · Alt+Enter 查看原图";
  return <Dialog open={open} onOpenChange={next => { setOpen(next); if (!next) setActual(false); }}>
    {onReference ? <button type="button" data-chat-image-id={imageId}
      onClick={event => { if (event.altKey) setOpen(true); else onReference(); }}
      onKeyDown={event => {
        if (event.altKey && event.key === "Enter") { event.preventDefault(); setOpen(true); }
      }}
      aria-keyshortcuts="Alt+Enter" aria-label={en ? `Reference ${name} in chat` : `引用${name}到聊天`}
      title={hint} className="h-16 w-16 overflow-hidden rounded-md border bg-muted align-middle">
      <img src={src} alt={name} className="h-full w-full object-contain" />
    </button> : <DialogTrigger asChild>
      <button type="button" aria-label={label} title={label}
        className={`cursor-zoom-in overflow-hidden rounded-md align-middle focus-visible:outline-2 ${saved ? "mr-1 h-16 w-16 border bg-muted" : "block h-full w-full"}`}>
        <img src={src} alt={name} className="h-full w-full object-contain" />
      </button>
    </DialogTrigger>}
    <DialogContent aria-describedby={undefined}
      className="z-[250] flex h-[94dvh] w-[96vw] max-w-[96vw] flex-col gap-2 p-3 sm:max-w-[96vw]">
      <div className="flex min-w-0 items-center gap-3 pr-9">
        <DialogTitle className="truncate text-sm">{name}</DialogTitle>
        <button type="button" aria-pressed={actual} onClick={() => setActual(value => !value)}
          className="shrink-0 rounded border px-2 py-1 text-xs">
          {actual ? (en ? "Fit to window" : "适应窗口") : (en ? "Actual size · 1:1" : "原始尺寸 · 1:1")}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded bg-muted">
        <img src={src} alt={name} className={actual ? "mx-auto block h-auto w-auto max-w-none" : "h-full w-full object-contain"} />
      </div>
    </DialogContent>
  </Dialog>;
}
