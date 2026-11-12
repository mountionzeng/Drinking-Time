import { PausedFrameBadge } from "./PausedFrameBadge";
import type { ChatFrameReference } from "@shared/chatFrameReference";
import { useUiLanguage } from "@/features/uiLanguage/UiLanguage";

export function ChatFrameReferences({ frames, storyId, selectedImageId, onSelect }: {
  frames: ChatFrameReference[];
  storyId: number | null;
  selectedImageId?: number | null;
  onSelect: (frame: ChatFrameReference) => void;
}) {
  const { language } = useUiLanguage();
  if (frames.every(frame => frame.origin === "paused-preview")) return <>{frames.map(frame => <PausedFrameBadge key={frame.imageId} frame={frame} onSelect={storyId === frame.storyId ? onSelect : undefined} />)}</>;
  return <div className="mb-2 grid grid-cols-2 gap-2" aria-label={language === "zh" ? "视频参考帧 / Video references" : "Video references"}>
    {frames.map(frame => <figure key={frame.imageId}>
      <button type="button" disabled={storyId !== frame.storyId} aria-pressed={selectedImageId === frame.imageId}
        aria-label={`${language === "zh" ? "选择参考帧 / Select reference" : "Select reference"} · ${String(frame.shotNo).padStart(2, "0")} · ${frame.shotTimeSec.toFixed(2)}s`}
        className="block w-full rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--nayin-accent)] aria-pressed:ring-2 aria-pressed:ring-[var(--nayin-accent)]"
        onClick={() => onSelect(frame)}>
        <img src={frame.imageUrl} alt={`${language === "zh" ? "视频参考帧" : "Video reference"} #${frame.imageId}`} className="max-h-48 w-full rounded object-contain" />
      </button>
      <figcaption className="mt-1 text-[10px] text-muted-foreground">
        {language === "zh" ? `第 ${String(frame.shotNo).padStart(2, "0")} 镜 · 镜内` : `Shot ${String(frame.shotNo).padStart(2, "0")} · shot time`} {frame.shotTimeSec.toFixed(2)}s · #{frame.imageId}
      </figcaption>
    </figure>)}
  </div>;
}
