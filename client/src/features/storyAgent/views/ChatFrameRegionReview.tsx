import { forestPaletteStatus, regionLabels, type FrameRegionReview, type FrameRegionSource } from "@shared/frameRegionReview";
import { useUiLanguage } from "@/features/uiLanguage/UiLanguage";
import { ChatFrameReferences } from "./ChatFrameReferences";
import type { ChatImageRevision } from "@shared/chatImageRevision";
import { formatComputeQuote } from "@shared/computeMoney";
import { frameLocationLabel, regionTreatmentLabel } from "../frameRegionPresentation";
import { ImageChangePreview } from "./ImageChangePreview";
import { ChatRegionImageViewer } from "./ChatRegionImageViewer";

export function ChatFrameRegionReview({ review, storyId, selectedImageId, onSelect, onFeedback, onContentChange, imageRevisions, pendingCloudRequests = [] }: {
  review: FrameRegionReview; storyId: number | null; selectedImageId?: number | null; onSelect: (frame: FrameRegionSource) => void; onContentChange?: () => void;
  imageRevisions?: ChatImageRevision[]; pendingCloudRequests?: string[]; onFeedback?: (frame: FrameRegionSource) => void;
}) {
  const { language } = useUiLanguage();
  const en = language === "en";
  if (!review.tasks.length) return <ChatFrameReferences frames={review.frames} storyId={storyId} selectedImageId={selectedImageId} onSelect={onSelect} />;
  const sourceFrames = [...review.frames, ...(review.sourceImages ?? [])]
    .filter((frame, index, all) => review.tasks.some(task => task.imageId === frame.imageId)
      && all.findIndex(other => other.imageId === frame.imageId) === index);
  const sourceLabel = (frame: FrameRegionSource) => {
    const timed = review.frames.find(item => item.imageId === frame.imageId);
    return timed ? `${timed.origin === "warehouse-video" ? (en ? "Source video " : "源视频 ") : ""}${timed.shotTimeSec.toFixed(2)}s`
      : (en ? "Selected image" : "所选图片");
  };
  return <div className="mb-2 space-y-3" aria-label={en ? "Keyframe region review" : "关键帧范围确认 / Keyframe region review"}>
    <p className="text-xs text-muted-foreground">{en ? "Shot" : "第"} {String(review.shotNo).padStart(2, "0")} {en ? "" : "镜"} · {en ? "Edit record" : "修改记录"} R{review.revision}</p>
    <div className="flex gap-1 overflow-x-auto pb-1" aria-label={en ? "Source keyframes" : "原始关键帧 / Source keyframes"}>
      {sourceFrames.map(frame => <button key={frame.imageId} type="button" disabled={storyId !== review.storyId}
        aria-label={`${en ? "Select source frame" : "选择原帧 / Select source frame"} · ${sourceLabel(frame)} · #${frame.imageId}`}
        onClick={() => onSelect(frame)} className="w-16 shrink-0 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--nayin-accent)]">
        <img src={frame.imageUrl} alt={`${sourceLabel(frame)}`} onLoad={onContentChange} className="h-16 w-16 rounded object-contain" />
        <span className="text-[10px] text-muted-foreground">#{frame.imageId}</span>
      </button>)}
    </div>
    {[...review.tasks].sort((a, b) => {
      const priority = (task: typeof a) => task.candidate ? (task.target === review.activeTarget ? 2 : 1) : 0;
      return priority(b) - priority(a);
    }).map(task => {
      const videoFrame = review.frames.find(frame => frame.imageId === task.imageId);
      const frame = videoFrame ?? review.sourceImages?.find(source => source.imageId === task.imageId);
      if (!frame) return null;
      const label = regionLabels[task.target][en ? "en" : "zh"];
      const paletteStatus = task.candidate ? forestPaletteStatus(task.candidate.imageId, [review]) : "unreviewed";
      const rejected = paletteStatus === "rejected";
      const quote = task.shapeQuote;
      const receipt = quote && storyId === review.storyId
        ? imageRevisions?.find(row => row.requestId === quote.requestId && row.stableShotId === review.stableShotId && row.sourceImageId === quote.sourceImageId) : undefined;
      const pending = quote && storyId === review.storyId && pendingCloudRequests.includes(quote.requestId);
      const say = (zh: string, english: string) => en ? english : zh;
      const status = review.phase === "cancelled" ? say("已取消", "Cancelled")
        : rejected ? say("这版配色不满意，保留记录", "Colors rejected; history retained")
        : paletteStatus === "accepted" ? say("配色已认可 · 剪辑未替换", "Colors approved · Timeline unchanged")
        : task.candidate ? say("已有新图 · 请看下方对比", "New image ready · Compare below")
        : pending || receipt?.status === "preparing" || receipt?.status === "accepted" ? say("正在生成 · 完成后在这里显示新图", "Generating · The new image will appear here")
        : receipt?.status === "unknown" ? say("结果待核对 · 不会重复购买", "Result unconfirmed · No repeat purchase")
        : receipt?.status === "failed" ? say("这次未完成 · 尚无新图", "This attempt failed · No new image")
        : receipt?.status === "succeeded" ? say("本次已生成 · 结果见最新回复", "Generated · See the latest reply for the result")
        : quote && !imageRevisions ? say("正在核对生成记录", "Checking generation records")
        : quote && quote.expiresAt < Date.now() ? say("报价已过期 · 尚未生成", "Quote expired · Not generated")
        : quote ? say(`尚未生成 · 待确认 ${formatComputeQuote(quote.estimatedCny)}`, `Not generated · Awaiting confirmation of ${formatComputeQuote(quote.estimatedCny).replace(/算力$/, "compute units")}`)
        : task.inheritance?.status === "pending" ? say("待确认是否沿用上一帧", "Awaiting confirmation to reuse the previous treatment")
        : task.approvedRevision != null ? say("范围已确认 · 尚无新图", "Region confirmed · No new image yet")
        : say("待确认范围 · 尚未改图", "Review the region · Image not edited yet");
      const treatment = regionTreatmentLabel(task, en);
      const editSource=task.shapeQuote?{...frame,imageId:task.shapeQuote.sourceImageId,imageUrl:task.shapeQuote.sourceImageUrl}:frame;
      const pictures = task.candidate ? [
        { url: editSource.imageUrl, label: en ? `Source #${editSource.imageId}` : `原图 #${editSource.imageId} / Source`, frame:editSource },
        { url: task.candidate.imageUrl, label: rejected ? (en ? `Candidate #${task.candidate.imageId} · Rejected colors` : `候选 #${task.candidate.imageId} · 配色不满意 / Rejected`) : (en ? `Candidate #${task.candidate.imageId}` : `候选 #${task.candidate.imageId} / Candidate`), frame: { ...frame, imageId: task.candidate.imageId, imageUrl: task.candidate.imageUrl } },
      ] : [{ url: task.shapeQuote?.overlayUrl??task.overlayUrl, label: task.selectedPixels ? (en ? "Proposed region" : "待确认范围 / Proposed region") : (en ? "Target not located" : "尚未定位 / Not located"), frame:editSource }];
      return <figure key={task.target} data-chat-result-preview={task.candidate ? "" : undefined}>
        <figcaption className="mb-1 text-xs">{label} · {videoFrame ? frameLocationLabel(videoFrame, en) : (en ? "Selected image" : "所选图片 / Selected image")} · #{editSource.imageId}</figcaption>
        <p className="mb-1 text-xs font-medium" role="status">{status}</p>
        {treatment && <p className="mb-1 text-xs">{say("处理内容：", "Treatment: ")}{treatment}</p>}
        {task.instruction.trim() && <details className="mb-2 text-xs text-muted-foreground" onToggle={onContentChange}>
          <summary className="cursor-pointer">{say("修改要求 / Edit request", "Edit request")}</summary>
          <p className="mt-1 whitespace-pre-wrap">{say("你的要求：", "Your request: ")}{task.instruction.trim()}</p>
        </details>}
        {task.inheritance && <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <img src={task.inheritance.imageUrl} alt={task.inheritance.forestTone
            ? (en ? "Previous forest treatment reference" : "上一帧森林处理参考 / Previous forest treatment")
            : (en ? "Previous frame color reference" : "上一帧配色参考 / Previous color reference")} className="h-12 w-12 shrink-0 rounded object-contain" onLoad={onContentChange} />
          <p>{task.inheritance.forestTone ? (task.inheritance.status === "pending"
            ? (en ? `Forest treatment reference #${task.inheritance.imageId} · Awaiting confirmation` : `森林处理参考 #${task.inheritance.imageId} · 待确认`)
            : ["harmonize_green", "harmonize_green_less_blue"].includes(task.inheritance.forestTone)
            ? (en ? `Using the harmonized forest palette from #${task.inheritance.imageId}; only this frame’s trees, with shading and soft edges retained.` : `沿用 #${task.inheritance.imageId} 协调后的森林绿色，仅处理这帧的树木，保留明暗和柔和边缘。`)
            : (en ? `Using the softened forest palette from #${task.inheritance.imageId}; only this frame’s trees, with shading and soft edges retained.` : `沿用 #${task.inheritance.imageId} 降低绿感后的森林配色，仅处理这帧的树木，保留明暗和柔和边缘。`))
            : task.inheritance.status === "pending"
            ? (en ? `Color reference #${task.inheritance.imageId} · Awaiting confirmation` : `配色参考 #${task.inheritance.imageId} · 待确认`)
            : (en ? `Using green from #${task.inheritance.imageId}; only this frame’s trees.` : `沿用 #${task.inheritance.imageId} 的绿色，仅作用于这帧的树木。`)}</p>
        </div>}
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
        <ChatRegionImageViewer key={`${review.id}:${review.revision}:${task.target}`} pictures={pictures}
          maskUrl={task.candidate ? undefined : task.shapeQuote?.maskUrl ?? task.maskUrl} en={en}
          enabled={storyId === review.storyId} onFeedback={review.phase === "cancelled" ? undefined : onFeedback} />
        {task.candidate && review.phase !== "cancelled" && paletteStatus === "unreviewed" && <p className="mt-2 text-sm">
          {say(`这张 #${task.candidate.imageId} 的${label}效果满意吗？点图后直接在下方聊天里说哪里要改。`, `Are you happy with ${label} in #${task.candidate.imageId}? Select the image and describe changes in the chat below.`)}
          {task.target === "forest" && <span className="block text-xs text-muted-foreground">{say(`满意可回复“森林配色满意 #${task.candidate.imageId}”。认可配色不会替换剪辑或批准付费生成。`, `If satisfied, reply “approve forest colors #${task.candidate.imageId}”. This does not replace the timeline or authorize paid generation.`)}</span>}
        </p>}
        <p className="mt-1 text-[10px] text-muted-foreground">{storyId === review.storyId && pictures.some(picture => picture.frame.imageId === selectedImageId)
          ? say(`当前聊天图片 #${selectedImageId}`, `Current chat image #${selectedImageId}`)
          : say("尚未选中这组图片，点图后继续修改。", "These images are not selected. Click an image to continue editing it.")}</p>
        {task.candidate && <ImageChangePreview sourceUrl={editSource.imageUrl} candidateUrl={task.candidate.imageUrl} en={en} onContentChange={onContentChange} />}
      </figure>;
    })}
  </div>;
}
