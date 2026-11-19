import { useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useUiLanguage } from "@/features/uiLanguage/UiLanguage";

export function ChatPhotoPreview({ src, name, saved = false }: { src: string; name: string; saved?: boolean }) {
  const { language } = useUiLanguage();
  const [actual, setActual] = useState(false);
  const en = language === "en";
  const label = en ? `View full image: ${name}` : `查看大图：${name}`;
  return <Dialog onOpenChange={open => { if (!open) setActual(false); }}>
    <DialogTrigger asChild>
      <button type="button" aria-label={label} title={label}
        className={`cursor-zoom-in overflow-hidden rounded-md align-middle focus-visible:outline-2 ${saved ? "mr-1 h-16 w-16 border bg-muted" : "block h-full w-full"}`}>
        <img src={src} alt={name} className="h-full w-full object-contain" />
      </button>
    </DialogTrigger>
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
