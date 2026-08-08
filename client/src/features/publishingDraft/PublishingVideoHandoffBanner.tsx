import { MessageCircleMore, Quote, Sparkles, X } from "lucide-react";
import { useCreationEditor } from "@/features/creationEditor/CreationEditorContext";
import { PUBLISHING_PLATFORM_REGISTRY } from "@shared/publishingDraft";
import type { PublishingVideoHandoff } from "./publishingVideoHandoff";

export function PublishingVideoHandoffBannerView({
  handoff,
  onDismiss,
}: {
  handoff: PublishingVideoHandoff;
  onDismiss?: () => void;
}) {
  const adapter = PUBLISHING_PLATFORM_REGISTRY[handoff.sourcePlatform];
  return (
    <section
      className="flex shrink-0 items-start gap-3 border-b bg-[var(--nayin-surface)]/70 px-4 py-3"
      style={{ borderColor: "var(--panel-border)" }}
      aria-label="文字稿视频交接"
      data-testid="publishing-video-handoff"
    >
      {handoff.cover ? (
        <img
          src={handoff.cover.imageUrl}
          alt="文字稿封面"
          className="h-14 w-14 shrink-0 rounded-md object-cover"
        />
      ) : (
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-background text-[var(--nayin-accent)]">
          <Sparkles className="h-4 w-4" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold text-foreground">
            从 {adapter.label} 文字稿继续 · {handoff.versionId.toUpperCase()}
          </p>
          {handoff.needsReview ? (
            <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[9px] text-rose-700">
              当前稿建议先复核
            </span>
          ) : null}
        </div>
        <p className="mt-1 truncate text-[11px] text-muted-foreground">
          {handoff.core?.thesis || handoff.draft.title || handoff.draft.body}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <MessageCircleMore className="h-3 w-3" />
            {handoff.narrationCandidates.length} 段旁白候选
          </span>
          <span className="inline-flex items-center gap-1">
            <Quote className="h-3 w-3" />
            {handoff.dialogueCandidates.length} 句台词候选
          </span>
          <strong className="font-medium text-foreground">
            想把它做成什么视频？
          </strong>
        </div>
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35"
          aria-label="收起文字稿交接"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </section>
  );
}

export default function PublishingVideoHandoffBanner({
  onDismiss,
}: {
  onDismiss?: () => void;
}) {
  const { publishingHandoff } = useCreationEditor();
  if (!publishingHandoff) return null;
  return (
    <PublishingVideoHandoffBannerView
      handoff={publishingHandoff}
      onDismiss={onDismiss}
    />
  );
}
