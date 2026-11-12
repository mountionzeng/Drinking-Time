import { regionLabels, type FrameRegionReview, type FrameRegionSource } from "@shared/frameRegionReview";
import { useUiLanguage } from "@/features/uiLanguage/UiLanguage";
import { ChatFrameReferences } from "./ChatFrameReferences";

export function ChatFrameRegionReview({ review, storyId, selectedImageId, onSelect, onContentChange }: {
  review: FrameRegionReview; storyId: number | null; selectedImageId?: number | null; onSelect: (frame: FrameRegionSource) => void; onContentChange?: () => void;
}) {
  const { language } = useUiLanguage();
  const en = language === "en";
  if (!review.tasks.length) return <ChatFrameReferences frames={review.frames} storyId={storyId} selectedImageId={selectedImageId} onSelect={onSelect} />;
  return <div className="mb-2 space-y-3" aria-label={en ? "Keyframe region review" : "关键帧范围确认 / Keyframe region review"}>
    <p className="text-xs text-muted-foreground">{en ? "Shot" : "第"} {String(review.shotNo).padStart(2, "0")} {en ? "" : "镜"} · R{review.revision}</p>
    <div className="flex gap-1 overflow-x-auto pb-1" aria-label={en ? "Source keyframes" : "原始关键帧 / Source keyframes"}>
      {review.frames.map(frame => <button key={frame.imageId} type="button" disabled={storyId !== review.storyId}
        aria-label={`${en ? "Select source frame" : "选择原帧 / Select source frame"} · ${frame.shotTimeSec.toFixed(2)}s · #${frame.imageId}`}
        onClick={() => onSelect(frame)} className="w-16 shrink-0 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--nayin-accent)]">
        <img src={frame.imageUrl} alt={`${frame.shotTimeSec.toFixed(2)}s`} onLoad={onContentChange} className="h-16 w-16 rounded object-contain" />
        <span className="text-[10px] text-muted-foreground">{frame.shotTimeSec.toFixed(2)}s</span>
      </button>)}
    </div>
    {review.tasks.map(task => {
      const videoFrame = review.frames.find(frame => frame.imageId === task.imageId);
      const frame = videoFrame ?? review.sourceImages?.find(source => source.imageId === task.imageId);
      if (!frame) return null;
      const label = regionLabels[task.target][en ? "en" : "zh"];
      const pictures = task.candidate ? [
        { url: frame.imageUrl, label: en ? "Source" : "原图 / Source", frame },
        { url: task.candidate.imageUrl, label: en ? "Candidate · not adopted" : "候选 · 未采用 / Candidate", frame: { ...frame, imageId: task.candidate.imageId, imageUrl: task.candidate.imageUrl } },
      ] : [{ url: task.overlayUrl, label: task.selectedPixels ? (en ? "Proposed region" : "待确认范围 / Proposed region") : (en ? "Target not located" : "尚未定位 / Not located"), frame }];
      return <figure key={task.target}>
        <figcaption className="mb-1 text-xs">{label} · {videoFrame ? `${videoFrame.shotTimeSec.toFixed(2)}s` : (en ? "Selected image" : "所选图片 / Selected image")} · #{frame.imageId}</figcaption>
        <div className={pictures.length > 1 ? "grid grid-cols-2 gap-2" : "grid grid-cols-1"}>
          {pictures.map(picture => <div key={picture.url}>
            <button type="button" disabled={storyId !== review.storyId} onClick={() => onSelect(picture.frame)}
              aria-label={`${en ? "Select" : "选择 / Select"} ${label} · ${picture.label} · #${picture.frame.imageId}`}
              aria-pressed={selectedImageId === picture.frame.imageId}
              className="block w-full rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--nayin-accent)] aria-pressed:ring-2 aria-pressed:ring-[var(--nayin-accent)]">
              <img onLoad={onContentChange} src={picture.url} alt={`${label} · ${picture.label}`} className="max-h-60 w-full rounded object-contain" />
            </button>
            <p className="mt-1 text-[10px] text-muted-foreground">{picture.label}</p>
          </div>)}
        </div>
      </figure>;
    })}
  </div>;
}
