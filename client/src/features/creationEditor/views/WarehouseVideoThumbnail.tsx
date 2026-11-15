import { useEffect, useRef, useState } from "react";
import { Loader2, Video } from "lucide-react";
import { useUiLanguage } from "@/features/uiLanguage/UiLanguage";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";

/** Hover plays a contained source preview; selection freezes the displayed source time. */
export function WarehouseVideoThumbnail({ url, ready, state, durationSec, aspectRatio, label, onSelect }: {
  url: string | null; ready: boolean; state?: "rendering" | "failed" | "unknown";
  durationSec?: number; aspectRatio?: string; label: string; onSelect: (sourceTimeSec: number) => void;
}) {
  const { language } = useUiLanguage();
  const en = language === "en";
  const [open, setOpen] = useState(false);
  const [metadata, setMetadata] = useState<{ url: string; width: number; height: number; duration: number }>();
  const [time, setTime] = useState(0);
  const [error, setError] = useState(false);
  const [previewVideo, setPreviewVideo] = useState<HTMLVideoElement | null>(null);
  const thumb = useRef<HTMLVideoElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const displayedTime = useRef<number | null>(null);
  const frozenTime = useRef<number | null>(null);
  const current = metadata?.url === url ? metadata : undefined;
  const duration = current && Number.isFinite(current.duration) ? current.duration : durationSec;
  const keepOpen = () => { clearTimeout(closeTimer.current); if (ready && url) setOpen(true); };
  const closeSoon = () => { clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => setOpen(false), 220); };
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useEffect(() => { setOpen(false); setError(false); setTime(0); displayedTime.current = null; frozenTime.current = null; }, [url, ready]);
  useEffect(() => {
    if (!open) return;
    const media = previewVideo;
    if (!media) return;
    let active = true;
    let callback: number | undefined;
    displayedTime.current = null;
    frozenTime.current = null;
    const track = (_now: number, frame: VideoFrameCallbackMetadata) => {
      if (!active) return;
      displayedTime.current = frame.mediaTime;
      callback = media.requestVideoFrameCallback(track);
    };
    if (media.requestVideoFrameCallback) callback = media.requestVideoFrameCallback(track);
    void media.play().then(() => { if (!active) media.pause(); }).catch(() => {
      // Autoplay may be denied; its visible first frame is still selectable.
    });
    return () => { active = false; media.pause(); if (callback != null) media.cancelVideoFrameCallback(callback); };
  }, [open, url, previewVideo]);
  const sourceTime = (media: HTMLVideoElement | null) => {
    const value = media === previewVideo ? displayedTime.current ?? media?.currentTime ?? 0 : media?.currentTime ?? 0;
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  };
  const freeze = (media: HTMLVideoElement | null) => {
    frozenTime.current = sourceTime(media);
    media?.pause();
  };
  const select = (media: HTMLVideoElement | null) => {
    if (!media || error) return;
    const atSec = frozenTime.current ?? sourceTime(media);
    media.pause();
    setOpen(false);
    onSelect(atSec);
  };
  const readMetadata = (media: HTMLVideoElement) => {
    if (url) setMetadata({ url, width: media.videoWidth, height: media.videoHeight, duration: media.duration });
  };
  const dimensions = current?.width && current.height ? `${current.width}×${current.height}` : aspectRatio;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverAnchor asChild><button type="button" disabled={!ready || !url} aria-label={label}
      onPointerEnter={event => { if (event.pointerType === "mouse") keepOpen(); }} onPointerLeave={closeSoon}
      onFocus={keepOpen} onBlur={closeSoon}
      onPointerDown={() => freeze(open && previewVideo ? previewVideo : thumb.current)} onClick={() => select(open && previewVideo ? previewVideo : thumb.current)}
      className="relative block h-[84px] w-full shrink-0 overflow-hidden rounded bg-muted/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
      {ready && url ? <video ref={thumb} src={url} muted playsInline preload="metadata" className="h-full w-full object-contain" aria-label={label}
        onLoadedMetadata={event => readMetadata(event.currentTarget)} onError={() => setError(true)} />
        : <span role="status" className="flex h-full flex-col items-center justify-center gap-1 text-[10px] text-muted-foreground">
          {state === "rendering" ? <Loader2 className="size-5 animate-spin motion-reduce:animate-none" /> : <Video className="size-5" />}
          {state === "rendering" ? (en ? "Generating" : "生成中 / Generating") : state === "failed" ? (en ? "Failed" : "生成失败 / Failed") : (en ? "Checking" : "状态待确认 / Checking")}
        </span>}
      {ready && <span className="pointer-events-none absolute bottom-0 left-0 right-0 flex justify-between gap-1 bg-black/60 px-1 text-[9px] text-white">
        <span>{dimensions}</span><span>{duration != null && Number.isFinite(duration) ? `${duration.toFixed(1)}s` : ""}</span>
      </span>}
    </button></PopoverAnchor>
    <PopoverContent side="top" align="center" sideOffset={48} collisionPadding={12}
      onPointerEnter={keepOpen} onPointerLeave={closeSoon} onFocusCapture={keepOpen}
      onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}
      className="w-[300px] max-w-[calc(100vw-24px)] p-2 space-y-1" aria-label={en ? "Warehouse video preview" : "仓库视频预览 / Video preview"}>
      <button type="button" className="block w-full rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        aria-label={en ? "Reference this video frame" : "引用视频当前帧 / Reference current frame"}
        onPointerDown={() => freeze(previewVideo)} onClick={() => select(previewVideo)}>
        <video ref={setPreviewVideo} src={url ?? undefined} muted playsInline loop preload="auto"
          className="mx-auto block w-full max-h-[min(42vh,300px)] rounded object-contain"
          onLoadedMetadata={event => readMetadata(event.currentTarget)} onTimeUpdate={event => setTime(event.currentTarget.currentTime)} onError={() => setError(true)} />
      </button>
      <p className="text-[10px] text-muted-foreground" role="status">{error ? (en ? "Preview unavailable" : "视频暂时无法播放 / Preview unavailable")
        : `${dimensions ?? ""} · ${time.toFixed(2)}s / ${duration?.toFixed(2) ?? "…"}s · ${en ? "Click a frame to reference it in chat" : "点击画面，引用到聊天 / Click to reference"}`}</p>
    </PopoverContent>
  </Popover>;
}
