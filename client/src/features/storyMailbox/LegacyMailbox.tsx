import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import {
  deliveryImportAttempt,
  forgetDeliveryImportAttempt,
  rememberDeliveryCandidate,
  readDeliveryImages,
} from "@/features/publishingAlbum/chapterDeliveryImport";
import type { ShareBackNotice } from "@shared/shareBackInbox";
const button =
  "rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50";
/** One entry for existing deliveries; reuse their authenticated read/import/resolve contract. */
export function LegacyMailbox({
  onOpenStory,
  shareBacks,
}: {
  onOpenStory: (id: number, versionId?: string) => void;
  shareBacks: ShareBackNotice[];
}) {
  const t = useUiText(),
    utils = trpc.useUtils();
  const status = trpc.chapterDelivery.status.useQuery(undefined, {
    retry: false,
  });
  const inbox = trpc.chapterDelivery.inbox.useQuery(undefined, {
    enabled: status.data?.enabled === true,
    retry: false,
  });
  const [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState("");
  const read = trpc.chapterDelivery.read.useQuery(
    { deliveryId: selected ?? "" },
    { enabled: Boolean(selected), retry: false }
  );
  const receive = trpc.chapters.importPackage.useMutation(),
    resolve = trpc.chapterDelivery.resolve.useMutation();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const busy = receive.isPending || resolve.isPending;
  async function keep() {
    if (!selected) return;
    setError("");
    try {
      const fresh = await utils.chapterDelivery.read.fetch({
        deliveryId: selected,
      });
      const attempt = deliveryImportAttempt(selected, "keep", null);
      const result = await receive.mutateAsync({
        requestId: attempt.requestId,
        mode: "keep",
        package: fresh.package,
        images: await readDeliveryImages(fresh.imageUrls),
      });
      if (result.outcome === "candidate")
        rememberDeliveryCandidate(fresh.package.packageId, selected);
      else await resolve.mutateAsync({ deliveryId: selected, status: "kept" });
      forgetDeliveryImportAttempt(selected);
      await inbox.refetch();
      if (alive.current) onOpenStory(result.storyId);
    } catch {
      setError(t("来稿处理失败，已有内容保留，请重试。"));
    }
  }
  return (
    <section className="space-y-5">
      <h3 className="text-lg font-medium">{t("已有来稿")}</h3>
      {status.isError || inbox.isError ? (
        <p role="alert">{t("收件箱暂时无法读取，请重试。")}</p>
      ) : null}
      {status.isPending || (status.data?.enabled && inbox.isPending) ? (
        <p role="status">{t("正在读取收件箱…")}</p>
      ) : null}
      {inbox.data
        ?.filter(row => row.status === "pending")
        .map(row => (
          <button
            type="button"
            className={`${button} block w-full text-left`}
            key={row.deliveryId}
            onClick={() => setSelected(row.deliveryId)}
          >
            {t(row.kind === "return" ? "发回的修改稿" : "收到的章节")} ·{" "}
            {new Date(row.createdAt).toLocaleDateString()}
          </button>
        ))}
      {!inbox.isPending &&
      !inbox.data?.some(row => row.status === "pending") &&
      !shareBacks.length ? (
        <p className="text-muted-foreground">{t("没有等待接收的章节。")}</p>
      ) : null}
      {read.isError ? (
        <p role="alert">{t("来稿处理失败，已有内容保留，请重试。")}</p>
      ) : null}
      {read.data ? (
        <article className="space-y-3 border-t pt-4">
          <p>
            {read.data.package.sender.displayName} ·{" "}
            {read.data.package.storyTitle}
          </p>
          <p className="max-h-64 overflow-y-auto whitespace-pre-wrap text-sm">
            {read.data.package.chapters
              .flatMap(c =>
                c.blocks
                  .filter(b => b.type === "text")
                  .map(b => (b.type === "text" ? b.text : ""))
              )
              .join("\n\n")}
          </p>
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={() => void keep()}
          >
            {t(
              read.data.delivery.kind === "return"
                ? "与原章节对照"
                : "留下成新故事"
            )}
          </button>
        </article>
      ) : null}
      {shareBacks.map(notice => (
        <article key={notice.id} className="space-y-2 border-t pt-3">
          <p>
            {notice.authorName} · {notice.storyTitle}
          </p>
          <p className="text-sm text-muted-foreground">
            {t(notice.kind === "text" ? "发回的修改稿" : "排版")}
          </p>
          <button
            type="button"
            className={button}
            onClick={() =>
              onOpenStory(
                notice.storyId,
                notice.kind === "text"
                  ? notice.id.split(":").slice(2).join(":")
                  : undefined
              )
            }
          >
            {t("打开原故事与版本")}
          </button>
        </article>
      ))}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
