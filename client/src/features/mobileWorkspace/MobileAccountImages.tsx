import React, { useState } from "react";
import { ImageIcon } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { ImageCandidatePreview } from "@/features/publishingAlbum/ImageCandidatePreview";
import { useUiText } from "@/features/uiLanguage/UiLanguage";

export function MobileAccountImages({
  onOpenStory,
}: {
  onOpenStory(id: number): void;
}) {
  const t = useUiText();
  const [cursors, setCursors] = useState<Array<number | undefined>>([
    undefined,
  ]);
  const query = trpc.storyAgent.accountImages.useQuery(
    { before: cursors.at(-1) },
    { retry: false }
  );
  const items = query.data?.items ?? [];
  return (
    <div data-stage-swipe="ignore">
      <p className="mb-6 text-sm leading-6 text-muted-foreground">
        {t(
          "每个故事里生成的图片，都收在这里。轻点放大，也可以回到故事继续制作。"
        )}
      </p>
      {query.isLoading ? (
        <p role="status" className="py-12 text-center text-sm">
          {t("正在整理图片…")}
        </p>
      ) : query.isError ? (
        <div role="alert" className="py-8 text-center text-sm">
          <p>{t("图片暂时没有读到。")}</p>
          <button
            className="min-h-11 text-primary"
            onClick={() => void query.refetch()}
          >
            {t("重试")}
          </button>
        </div>
      ) : (
        <>
          <div
            className="grid grid-cols-2 gap-x-3 gap-y-6"
            aria-label={t("账号图片库")}
          >
            {items.map(item => (
              <article key={item.id} className="min-w-0">
                <ImageCandidatePreview
                  touchOnly
                  label={`${item.storyTitle ?? t("我的图片")} · ${item.id}`}
                  preview={
                    <img
                      src={item.imageUrl}
                      alt={item.storyTitle ?? t("我的图片")}
                    />
                  }
                >
                  <button
                    className="block w-full overflow-hidden rounded-xl bg-muted/40 focus-visible:outline-2 focus-visible:outline-primary"
                    aria-label={t("放大图片 {0}", [item.id])}
                  >
                    <img
                      src={item.imageUrl}
                      alt={item.storyTitle ?? t("我的图片")}
                      loading="lazy"
                      className="aspect-[4/5] w-full object-contain"
                    />
                  </button>
                </ImageCandidatePreview>
                {item.storyId != null ? (
                  <button
                    onClick={() => onOpenStory(item.storyId!)}
                    className="flex min-h-11 w-full items-center gap-2 text-left text-xs text-muted-foreground"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {item.storyTitle}
                    </span>
                    <span aria-hidden>↗</span>
                  </button>
                ) : (
                  <p className="py-3 text-xs text-muted-foreground">
                    {t("我的图片")}
                  </p>
                )}
              </article>
            ))}
          </div>
          {!items.length && (
            <div className="py-14 text-center text-muted-foreground">
              <ImageIcon size={28} strokeWidth={1.3} className="mx-auto mb-4" />
              <p className="font-chat-brand text-xl">
                {t("图片，从一个故事开始")}
              </p>
              <p className="mt-2 text-sm">
                {t("进入故事的「图片」，为文字生成画面。")}
              </p>
            </div>
          )}
        </>
      )}
      {(cursors.length > 1 || query.data?.nextCursor != null) && (
        <nav
          aria-label={t("图片翻页")}
          className="mt-7 flex items-center justify-between border-t border-border/50 pt-3 text-sm"
        >
          <button
            className="min-h-11 text-primary disabled:opacity-40"
            disabled={cursors.length === 1 || query.isFetching}
            onClick={() => setCursors(current => current.slice(0, -1))}
          >
            {t("上一页")}
          </button>
          <span className="text-xs text-muted-foreground">
            {t("第 {0} 页", [cursors.length])}
          </span>
          <button
            className="min-h-11 text-primary disabled:opacity-40"
            disabled={
              query.data?.nextCursor == null ||
              query.isFetching ||
              query.isError
            }
            onClick={() => {
              const nextCursor = query.data?.nextCursor;
              if (nextCursor != null)
                setCursors(current => [...current, nextCursor]);
            }}
          >
            {t("下一页")}
          </button>
        </nav>
      )}
    </div>
  );
}
