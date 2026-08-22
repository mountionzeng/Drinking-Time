import { Images, Loader2, Sparkles, X } from "lucide-react";
import { chatImageRefRole } from "../chatImageRefs";
import type { ChatImageRemixController } from "../useChatImageRemix";
import { writeStoryImageDragPayload } from "../storyImageDrag";

/**
 * 对话框里的图生图托盘：选中的参考图 → 待确认的改图卡 → 生成出来的新图。
 *
 * 放在输入框正上方而不是消息流里：这几张图是「正在编辑的东西」，跟着输入框走
 * 才能一直看得见；生成出来的新图也停在这里，直接拖去时间轴或镜头设计表。
 */
export default function ChatImageRemixTray({
  remix,
}: {
  remix: ChatImageRemixController;
}) {
  const { refs, status, draft, result, error } = remix;
  if (refs.length === 0 && !draft && !result && !error) return null;

  return (
    <div className="mt-2.5 min-w-0" data-testid="chat-image-remix-tray">
      {refs.length > 0 ? (
        <>
          <div className="flex gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
            {refs.map((ref, index) => (
              <figure
                key={ref.imageId}
                className={`group relative h-13 w-13 shrink-0 overflow-hidden rounded-md bg-muted ${
                  index === 0 ? "ring-1 ring-[var(--nayin-accent)]" : ""
                }`}
                title={`${ref.label} · 图片 #${ref.imageId}${
                  index === 0 ? "（底图）" : "，点一下设为底图"
                }`}
              >
                <button
                  type="button"
                  onClick={() => remix.promoteRef(ref.imageId)}
                  className="block h-full w-full"
                  aria-label={`把 ${ref.label} 设为底图`}
                >
                  <img
                    src={ref.imageUrl}
                    alt={ref.label}
                    className="h-full w-full object-cover"
                  />
                </button>
                <span className="absolute bottom-0.5 left-0.5 rounded bg-black/65 px-1 text-[8px] font-mono text-white">
                  {index === 0 ? "图1底" : `图${index + 1}`}
                </span>
                <button
                  type="button"
                  onClick={() => remix.removeRef(ref.imageId)}
                  className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded bg-black/65 text-white opacity-85 transition-opacity hover:opacity-100"
                  aria-label={`取消引用 ${ref.label}`}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </figure>
            ))}
          </div>
          <p className="mt-0.5 truncate text-[9.5px] text-muted-foreground">
            引用 {refs.length} 张 · 图1 是底图（画幅和构图从它来）·
            说清楚从每张取什么
          </p>
        </>
      ) : null}

      {draft && status === "confirming" ? (
        <article
          className="mt-1.5 rounded-md border border-[var(--nayin-accent)] bg-[var(--nayin-glow)] px-2.5 py-2"
          aria-label="确认改图"
        >
          <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
            <Images className="h-3 w-3" />
            <span>多图改图 · {draft.refs.length} 张参考</span>
          </div>
          <ul className="mt-1 space-y-0.5 text-[10px] leading-relaxed text-foreground/80">
            {draft.refs.map((ref, index) => (
              <li key={ref.imageId} className="truncate">
                {chatImageRefRole(index)}＝{ref.label}
                <span className="ml-1 text-muted-foreground">
                  #{ref.imageId}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] leading-relaxed text-foreground">
            {draft.instruction}
          </p>
          <p className="mt-1 text-[9.5px] text-muted-foreground">
            预计人民币 ¥{draft.estimatedCny.toFixed(2)}；确认后才会提交 302
            并产生费用。新图先进素材仓库，拖到时间轴或镜头设计表才算采用。
          </p>
          <div className="mt-1.5 flex gap-1.5">
            <button
              type="button"
              onClick={() => void remix.confirm()}
              className="rounded bg-[var(--nayin-accent)] px-2 py-1 text-[10px] font-medium text-white transition-opacity hover:opacity-90"
            >
              确认并生成
            </button>
            <button
              type="button"
              onClick={remix.cancel}
              className="rounded border border-border px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
            >
              取消
            </button>
          </div>
        </article>
      ) : null}

      {status === "generating" ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          正在按你说的合成新图…别重复提交，这一单已经在跑了。
        </p>
      ) : null}

      {result && status === "done" ? (
        <article
          className="mt-1.5 flex items-start gap-2 rounded-md border border-border bg-background px-2.5 py-2"
          aria-label="改图结果"
        >
          <img
            src={result.imageUrl}
            alt={result.instruction}
            draggable
            onDragStart={event =>
              writeStoryImageDragPayload(event.dataTransfer, {
                imageId: result.imageId,
                imageUrl: result.imageUrl,
                label: "对话框改图",
              })
            }
            className="h-16 w-16 shrink-0 cursor-grab rounded object-cover active:cursor-grabbing"
            data-testid="chat-image-remix-result"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
              <Sparkles className="h-3 w-3" />
              <span>新图 #{result.imageId} · 已存进素材仓库</span>
            </div>
            <p className="mt-0.5 truncate text-[10.5px] text-foreground/80">
              {result.instruction}
            </p>
            <p className="mt-0.5 text-[9.5px] text-muted-foreground">
              拖到时间轴的镜头上或镜头设计表的行里，那一镜就换成它；拖到空白处新建一镜。
            </p>
          </div>
          <button
            type="button"
            onClick={remix.dismissResult}
            className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="收起改图结果"
          >
            <X className="h-3 w-3" />
          </button>
        </article>
      ) : null}

      {error && status === "error" ? (
        <p className="mt-1.5 text-[10px] leading-relaxed text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
