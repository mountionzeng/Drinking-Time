import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { CreationEditorShot } from "@/features/creationEditor/CreationEditorContext";
import { videoTakeAffordance } from "@/features/creationEditor/videoAssetViewModel";

export type StoryboardMediaPreview =
  | {
      kind: "image";
      url: string;
      label: string;
    }
  | {
      kind: "video";
      url: string;
      poster?: string | null;
      label: string;
    };

export function storyboardPreviewVideoTake(
  shot: CreationEditorShot | undefined
) {
  const takes = shot?.videoTakes ?? [];
  const selectedTake = shot?.selectedVideoTake;
  const canPreview = (take: (typeof takes)[number] | typeof selectedTake) =>
    Boolean(take?.videoUrl && videoTakeAffordance(take.status).canPlay);

  if (canPreview(selectedTake)) return selectedTake;
  const timelineTake = takes.find(
    take => take.isTimelineSelected && canPreview(take)
  );
  if (timelineTake) return timelineTake;
  if (shot?.imageUrl) return undefined;
  return takes.find(canPreview);
}

export function StoryboardVideoThumbnail({
  src,
  poster,
  active,
  label,
  className,
}: {
  src: string;
  poster?: string | null;
  active: boolean;
  label: string;
  className: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (active) {
      void video.play().catch(() => undefined);
      return;
    }
    video.pause();
    if (video.readyState > 0) video.currentTime = 0;
  }, [active, src]);

  return (
    <video
      ref={videoRef}
      src={src}
      poster={poster ?? undefined}
      muted
      loop
      playsInline
      autoPlay={active}
      preload={active ? "auto" : "metadata"}
      className={className}
      aria-label={label}
      data-storyboard-video-preview="true"
      onMouseEnter={event => {
        void event.currentTarget.play().catch(() => undefined);
      }}
      onMouseLeave={event => {
        if (active) return;
        event.currentTarget.pause();
        if (event.currentTarget.readyState > 0) {
          event.currentTarget.currentTime = 0;
        }
      }}
    />
  );
}

export function StoryboardMediaPreviewDialog({
  preview,
  onClose,
}: {
  preview: StoryboardMediaPreview | null;
  onClose: () => void;
}) {
  if (!preview) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
      onKeyDown={event => {
        if (event.key === "Escape") onClose();
      }}
      role="presentation"
    >
      <div
        className="relative max-h-[80vh] max-w-[80vw] overflow-hidden rounded-lg bg-background shadow-2xl"
        onClick={event => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-background/80 text-muted-foreground shadow-sm transition hover:text-foreground"
          aria-label="关闭预览"
        >
          <X className="h-4 w-4" />
        </button>
        {preview.kind === "video" ? (
          <video
            src={preview.url}
            poster={preview.poster ?? undefined}
            controls
            autoPlay
            playsInline
            className="max-h-[80vh] max-w-[80vw] object-contain"
            aria-label={`${preview.label} 视频预览`}
          />
        ) : (
          <img
            src={preview.url}
            alt={preview.label}
            className="max-h-[80vh] max-w-[80vw] object-contain"
          />
        )}
      </div>
    </div>
  );
}
