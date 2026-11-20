import { pictureRegionLabel } from "@shared/chatPictureRegion";
import { useEffect, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useUiLanguage } from "@/features/uiLanguage/UiLanguage";

/** The original URL is used at both sizes; previewing never changes the reference. */
export function ChatImageReferenceChip({ imageId, imageUrl, onReference, note }: { imageId: number; imageUrl: string; note?: string; onReference?: () => void }) {
  const { language } = useUiLanguage();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelClose = () => clearTimeout(closeTimer.current);
  const closeSoon = () => { cancelClose(); closeTimer.current = setTimeout(() => setOpen(false), 120); };
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const label = `${language === "en" ? "Image" : "图片"} #${imageId}`;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" aria-label={onReference ? (language === "en" ? `Reference ${label} in chat` : `引用${label}到聊天`) : label}
        onClick={onReference ? event => { event.preventDefault(); setOpen(false); onReference(); } : undefined} data-testid="chat-image-reference-chip" data-chat-image-id={imageId}
        className="inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-md border border-border bg-muted/50 p-1 pr-2 text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        onPointerEnter={event => { if (event.pointerType === "mouse" && !event.currentTarget?.closest("[data-picture-regions]")) { cancelClose(); setOpen(true); } }}
        onPointerLeave={closeSoon} onFocus={() => { cancelClose(); setOpen(true); }} onBlur={closeSoon}>
        <img src={imageUrl} alt="" draggable={false} className="h-7 w-7 rounded object-contain" />
        <span className="max-w-[16ch] truncate">{note ? pictureRegionLabel(note, language === "en") : label}</span>
      </button>
    </PopoverTrigger>
    <PopoverContent side="top" align="start" sideOffset={8} collisionPadding={12}
      aria-label={`${language === "en" ? "Preview" : "预览"} ${label}`}
      className="z-[200] w-[420px] max-w-[calc(100vw-24px)] p-2"
      onPointerEnter={cancelClose} onPointerLeave={closeSoon}
      onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}>
      <img src={imageUrl} alt={label} className="max-h-[55vh] w-full rounded object-contain" />
      <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
    </PopoverContent>
  </Popover>;
}
