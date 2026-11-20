import { PausedFrameBadge } from "./PausedFrameBadge";
import type { ChatFrameReference } from "@shared/chatFrameReference";
import { useUiLanguage } from "@/features/uiLanguage/UiLanguage";

export function ChatFrameReferences({ frames, storyId, selectedImageId, onSelect, showThumbnails = false, shotLabel }: {
  frames: ChatFrameReference[];
  storyId: number | null;
  showThumbnails?: boolean;
  shotLabel?: (number: number, stableShotId: string) => string;
  selectedImageId?: number | null;
  onSelect: (frame: ChatFrameReference) => void;
}) {
  const { language } = useUiLanguage();
  const code = (frame: ChatFrameReference) => shotLabel?.(frame.shotNo, frame.stableShotId) ?? String(frame.shotNo).padStart(2, "0");
  if (!showThumbnails && frames.every(frame => frame.origin === "paused-preview" || frame.origin === "warehouse-video")) return <>{frames.map(frame => <PausedFrameBadge key={frame.imageId} frame={frame} shotCode={code(frame)} onSelect={storyId === frame.storyId ? onSelect : undefined} />)}</>;
  return <div className="mb-2 grid grid-cols-2 gap-2" aria-label={language === "zh" ? "视频参考帧 / Video references" : "Video references"}>
    {frames.map(frame => <figure key={frame.imageId}>
      <button type="button" disabled={storyId !== frame.storyId} aria-pressed={selectedImageId === frame.imageId}
        aria-label={`${language === "zh" ? "选择参考帧 / Select reference" : "Select reference"} · ${code(frame)} · ${frame.shotTimeSec.toFixed(2)}s`}
        className="block w-full rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--nayin-accent)] aria-pressed:ring-2 aria-pressed:ring-[var(--nayin-accent)]"
        onClick={() => onSelect(frame)}>
        <img src={frame.imageUrl} alt={`${language === "zh" ? "视频参考帧" : "Video reference"} #${frame.imageId}`} className="max-h-48 w-full rounded object-contain" />
      </button>
      <figcaption className="mt-1 text-[10px] text-muted-foreground">
        {language === "zh" ? `第 ${code(frame)} 镜 · 镜内` : `Shot ${code(frame)} · shot time`} {frame.shotTimeSec.toFixed(2)}s · #{frame.imageId}
      </figcaption>
    </figure>)}
  </div>;
}
