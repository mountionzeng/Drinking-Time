import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { FrameRegionSource } from "@shared/frameRegionReview";

type ReviewPicture = { url: string; label: string; frame: FrameRegionSource };
export function ChatRegionImageViewer({ pictures, maskUrl, en, enabled, onFeedback }: {
  pictures: ReviewPicture[]; maskUrl?: string; en: boolean; enabled: boolean;
  onFeedback?: (frame: FrameRegionSource) => void;
}) {
  const [open, setOpen] = useState(false);
  const reply = useRef<FrameRegionSource | null>(null);
  const target = pictures.at(-1)?.frame;
  return <Dialog open={open && enabled} onOpenChange={setOpen}>
    <DialogTrigger asChild><button type="button" disabled={!enabled} className="mt-2 text-xs underline underline-offset-4 focus-visible:outline focus-visible:outline-2 disabled:opacity-50">
      {en ? "View larger in chat" : "在聊天中查看大图 / View larger"}
    </button></DialogTrigger>
    <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-2rem)] max-w-5xl sm:max-w-5xl flex-col gap-3 overflow-hidden" onCloseAutoFocus={event => {
      const frame = reply.current; reply.current = null;
      if (frame && enabled && onFeedback) { event.preventDefault(); onFeedback(frame); }
    }}>
      <DialogTitle>{en ? "Review images" : "查看图片"} · #{target?.imageId}</DialogTitle>
      <DialogDescription>{en ? "Viewing does not adopt a version or authorize generation. Return to this conversation to give feedback." : "查看不会采用版本或批准生成。看完后回到这段对话，说出你的意见。"}</DialogDescription>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className={pictures.length > 1 ? "grid grid-cols-1 gap-4 sm:grid-cols-2" : "grid grid-cols-1"}>
          {pictures.map(picture => <figure key={picture.url}>
            <figcaption className="mb-2 text-sm font-medium">{picture.label}</figcaption>
            <img src={picture.url} alt={picture.label} className="max-h-[65dvh] w-full rounded object-contain" />
          </figure>)}
        </div>
        {maskUrl && <details className="mt-3 text-sm">
          <summary className="cursor-pointer">{en ? "Black-and-white mask" : "黑白范围图 / Mask"}</summary>
          <p className="my-2">{en ? "White is editable; black stays unchanged." : "白色是待修改范围，黑色保持原样。"}</p>
          <img src={maskUrl} alt={en ? "Editable region mask" : "待修改范围蒙版"} className="max-h-[65dvh] w-full object-contain" />
        </details>}
      </div>
      {onFeedback && target && <button type="button" className="self-end rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground focus-visible:outline focus-visible:outline-2" onClick={() => { reply.current = target; setOpen(false); }}>
        {en ? `Reply about #${target.imageId} in chat` : `回到聊天反馈 #${target.imageId} / Reply in chat`}
      </button>}
    </DialogContent>
  </Dialog>;
}
