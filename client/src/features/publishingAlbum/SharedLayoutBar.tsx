import { useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import type { SharedLayoutPackage } from "@shared/sharedLayout";
import type {
  SharedLayoutCandidate,
  SharedLayoutStored,
} from "./sharedLayoutClient";

const button =
  "rounded-lg border border-[var(--panel-border)] bg-transparent px-3 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)] disabled:opacity-40";

/**
 * Layout co-creation entry, shared by phone and desktop:
 * - the author sees layouts a friend shared back and chooses to adopt or ignore;
 * - a friend's copy can send its whole layout page set back to the author.
 */
export function SharedLayoutBar({
  storyId,
  candidates,
  canShareBack,
  onApply,
  buildPackage,
  compact = false,
}: {
  storyId: number;
  candidates: SharedLayoutCandidate[];
  canShareBack: boolean;
  /** Applies the layout and returns an undo. */
  onApply(layout: SharedLayoutStored): () => void;
  buildPackage(): Promise<SharedLayoutPackage>;
  compact?: boolean;
}) {
  const t = useUiText();
  const utils = trpc.useUtils();
  const status = trpc.storyContextShare.backStatus.useQuery(
    { storyId },
    { enabled: storyId > 0, retry: false, refetchOnWindowFocus: false }
  );
  const shareBack = trpc.artworkShare.shareBackLayout.useMutation();
  const resolve = trpc.artworkShare.resolveLayoutCandidate.useMutation();
  const [operationToken, setOperationToken] = useState(() =>
    crypto.randomUUID()
  );
  const [sending, setSending] = useState(false);
  // Retries reuse the exact payload so the server's idempotent token matches.
  const prepared = useRef<SharedLayoutPackage | null>(null);
  const pending = candidates.filter(row => row.status === "pending");
  const available = Boolean(status.data?.available);
  if (!pending.length && !available) return null;

  async function send() {
    if (sending) return;
    setSending(true);
    try {
      prepared.current ??= await buildPackage();
      await shareBack.mutateAsync({
        storyId,
        operationToken,
        layout: prepared.current,
      });
      prepared.current = null;
      setOperationToken(crypto.randomUUID());
      toast.success(t("已把排版分享回给作者，作者确认后才会采用"));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "分享失败，你的排版仍保留";
      if (/已完成/.test(message)) {
        prepared.current = null;
        setOperationToken(crypto.randomUUID());
      }
      toast.error(message);
    } finally {
      setSending(false);
    }
  }
  async function decide(
    candidate: SharedLayoutCandidate,
    decision: "adopted" | "dismissed"
  ) {
    const undo = decision === "adopted" ? onApply(candidate) : null;
    try {
      await resolve.mutateAsync({
        storyId,
        candidateId: candidate.id,
        status: decision,
      });
      await utils.artworkShare.layout.invalidate({ storyId });
      if (undo)
        toast.success(t("已采用和{0}一起改的排版", [candidate.authorName]), {
          action: { label: t("撤销"), onClick: undo },
        });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "操作失败，请稍后重试"
      );
    }
  }

  const controls = (
    <div
      className="space-y-2 rounded-lg border border-[var(--panel-border)] p-3"
      aria-label={t("和朋友一起改排版")}
    >
      {pending.map(candidate => (
        <div
          key={candidate.id}
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label={t("和{0}一起改的排版", [candidate.authorName])}
        >
          <div className="flex gap-1" aria-hidden="true">
            {candidate.assets.slice(0, 4).map(asset => (
              <img
                key={asset.id}
                src={asset.imageUrl}
                alt=""
                className="h-10 w-8 rounded object-cover"
              />
            ))}
          </div>
          <p className="min-w-0 flex-1 text-xs">
            {t("和{0}一起改的排版", [candidate.authorName])}
            {candidate.settings.title ? `「${candidate.settings.title}」` : ""}
          </p>
          <button
            type="button"
            className={button}
            disabled={resolve.isPending}
            onClick={() => void decide(candidate, "adopted")}
          >
            {t("采用")}
          </button>
          <button
            type="button"
            className={button}
            disabled={resolve.isPending}
            onClick={() => void decide(candidate, "dismissed")}
          >
            {t("忽略")}
          </button>
        </div>
      ))}
      {available ? (
        <button
          type="button"
          className={button}
          disabled={!canShareBack || sending}
          title={
            canShareBack
              ? t("把整套排版和其中的图片发给作者")
              : t("排版更新完成后再分享")
          }
          onClick={() => void send()}
        >
          {sending ? t("正在分享排版…") : t("把排版分享回给作者")}
        </button>
      ) : null}
    </div>
  );
  return compact ? (
    <details className="border-t border-border pt-3 text-sm">
      <summary className="min-h-11 cursor-pointer text-muted-foreground">
        {pending.length
          ? t("协作与分享 · {0} 份待确认", [pending.length])
          : t("协作与分享")}
      </summary>
      {controls}
    </details>
  ) : (
    controls
  );
}
