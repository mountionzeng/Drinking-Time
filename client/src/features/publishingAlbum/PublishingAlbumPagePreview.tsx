import { PublishingAlbumTextLayer } from "./PublishingAlbumTextLayer";
import type { PublishingAlbumLayoutPlan } from "./publishingAlbumLayout";
import { type CSSProperties } from "react";

export function PublishingAlbumPagePreview({
  backgroundUrl,
  plan,
  label = "画册页面预览",
  candidate = false,
  canvas = { width: 900, height: 1200 },
  backgroundStyle,
  onDoubleClick,
}: {
  backgroundUrl: string | null;
  plan: PublishingAlbumLayoutPlan | null;
  label?: string;
  candidate?: boolean;
  canvas?: { width: number; height: number };
  backgroundStyle?: CSSProperties;
  onDoubleClick?: () => void;
}) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-xl bg-black/10"
      style={{ aspectRatio: `${canvas.width} / ${canvas.height}` }}
      aria-label={label}
      onDoubleClick={onDoubleClick}
      data-candidate={candidate ? "true" : "false"}
    >
      {backgroundUrl ? (
        <img
          src={backgroundUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          style={backgroundStyle}
          draggable={false}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
          尚未采用底图
        </div>
      )}
      {plan ? <PublishingAlbumTextLayer plan={plan} canvas={canvas} /> : null}
      {candidate ? (
        <span className="absolute left-2 top-2 rounded bg-black/65 px-2 py-1 text-[10px] text-white">
          候选 · 尚未采用
        </span>
      ) : null}
    </div>
  );
}
