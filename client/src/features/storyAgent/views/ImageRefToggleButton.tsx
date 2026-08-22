import { Check, Quote } from "lucide-react";
import { toast } from "sonner";
import { chatImageRefsStore, useIsChatImageRef } from "../chatImageRefsStore";

/**
 * 「加进对话框」角标。素材仓库、故事版缩略图、时间轴上的图片 clip 共用这一个 ——
 * 它们背后是 generated_images 的同一行，引用只认 imageId，不必各做一套。
 */
export default function ImageRefToggleButton({
  storyId,
  imageId,
  imageUrl,
  label,
  className = "",
}: {
  storyId: number | null;
  imageId: number;
  imageUrl: string;
  /** 篮子和提示词里显示的来源，如「0102 首帧」「待归类」。 */
  label: string;
  className?: string;
}) {
  const picked = useIsChatImageRef(imageId);
  return (
    <button
      type="button"
      onClick={event => {
        event.stopPropagation();
        const rejected = chatImageRefsStore
          .getState()
          .toggle(storyId, { imageId, imageUrl, label });
        if (rejected) toast.error(rejected);
      }}
      className={`inline-flex h-6 w-6 items-center justify-center rounded transition-colors ${
        picked
          ? "bg-[var(--nayin-accent)] text-white"
          : "bg-black/55 text-white/85 hover:bg-black/75"
      } ${className}`}
      aria-pressed={picked}
      aria-label={picked ? `取消引用 ${label}` : `把 ${label} 加进对话框`}
      title={picked ? "已加进对话框，点一下取消" : "加进对话框，作为改图的参考"}
      data-testid={`image-ref-toggle-${imageId}`}
    >
      {picked ? <Check className="h-3 w-3" /> : <Quote className="h-3 w-3" />}
    </button>
  );
}
