import {
  PHOTO_EXTRACTION_QUESTION,
  PHOTO_EXTRACTION_REPLIES,
} from "@shared/photoExtraction";

export default function ChatPhotoExtractionQuestion({
  disabled,
  onReply,
}: {
  disabled: boolean;
  onReply: (reply: string) => void;
}) {
  return (
    <section aria-label="照片提取追问" className="mt-2 text-[11px] leading-5">
      <p role="status">{PHOTO_EXTRACTION_QUESTION}</p>
      <p className="text-[10px] text-muted-foreground">
        直接在聊天框回答，比如“小猫”或“左边的花瓶，不要背景”。多张照片可以按顺序说明。
      </p>
      <div className="mt-1 flex flex-wrap gap-1">
        {PHOTO_EXTRACTION_REPLIES.map(reply => (
          <button
            key={reply}
            type="button"
            disabled={disabled}
            onClick={() => onReply(reply)}
            className="rounded px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40"
          >
            {reply}
          </button>
        ))}
      </div>
      <p className="text-[9.5px] text-muted-foreground">
        选择只会填入回复，发送后才上传处理；不会生成新图。
      </p>
    </section>
  );
}
