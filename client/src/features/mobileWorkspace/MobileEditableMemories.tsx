import React, { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { MobileEditSeed } from "./MobileSyncedEditor";

export function MobileEditableMemories({
  storyId,
  onEdit,
  onMakeArtwork,
}: {
  storyId: number;
  onEdit: (seed: MobileEditSeed) => void;
  onMakeArtwork?: (card: {
    id: string;
    title: string;
    content: string;
  }) => void;
}) {
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [syncError, setSyncError] = useState(false);
  const query = trpc.memoryWarehouse.forStory.useQuery(
    { storyId, offset },
    { retry: false }
  );
  const sync = trpc.memoryWarehouse.syncStory.useMutation({ retry: false });
  const utils = trpc.useUtils();
  const run = useRef(sync.mutateAsync);
  run.current = sync.mutateAsync;
  const synchronize = async () => {
    setSyncError(false);
    try {
      await run.current({ storyId });
      await utils.memoryWarehouse.forStory.invalidate({ storyId });
    } catch {
      setSyncError(true);
    }
  };
  useEffect(() => {
    void synchronize();
  }, [storyId]);
  const cards = query.data?.cards ?? [];
  const card = cards.find(card => card.id === selected);
  return (
    <div>
      {syncError && (
        <p role="alert" className="mb-3 text-sm">
          部分聊天还未收录。
          <button
            className="min-h-11 px-2 underline"
            onClick={() => void synchronize()}
          >
            重试
          </button>
        </p>
      )}
      {query.isLoading ? (
        <p role="status">正在读取记忆…</p>
      ) : query.isError ? (
        <p role="alert">
          记忆暂未读到。
          <button
            className="min-h-11 px-2 underline"
            onClick={() => void query.refetch()}
          >
            重试
          </button>
        </p>
      ) : card ? (
        <article>
          <div className="flex items-center justify-between">
            <button
              className="min-h-11 text-sm text-muted-foreground"
              onClick={() => setSelected(null)}
            >
              ‹ 全部记忆
            </button>
            <button
              className="min-h-11 px-2 text-sm text-primary"
              onClick={() =>
                onEdit({
                  kind: "memory",
                  id: card.id,
                  title: card.title,
                  content: card.content,
                })
              }
            >
              编辑
            </button>
          </div>
          <h2 className="my-4 font-chat-brand text-xl">{card.title}</h2>
          {onMakeArtwork && card.content.trim() ? (
            <button
              type="button"
              className="mb-3 min-h-11 text-sm text-primary"
              onClick={() => onMakeArtwork(card)}
            >
              制作图文 · 配图、排版与分享 →
            </button>
          ) : null}
          <p className="whitespace-pre-wrap break-words font-serif text-base leading-8">
            {card.content}
          </p>
        </article>
      ) : (
        <>
          {!cards.length && (
            <p className="py-6 text-sm text-muted-foreground">
              {sync.isPending
                ? "正在收录聊天记忆…"
                : "还没有记忆，可以先到“聊聊”记下一段。"}
            </p>
          )}
          {cards.map(card => (
            <button
              key={card.id}
              className="block w-full border-b border-border/60 py-4 text-left"
              onClick={() => setSelected(card.id)}
            >
              <span className="text-xs text-muted-foreground">
                {card.origin === "assistant"
                  ? "聊聊整理"
                  : card.origin === "user"
                    ? "我的原话"
                    : "我的记事 / 修订"}
              </span>
              <span className="mt-2 block line-clamp-2 font-chat-brand text-lg">
                {card.title}
              </span>
              <span className="mt-2 block line-clamp-2 text-sm leading-7 text-muted-foreground">
                {card.content}
              </span>
            </button>
          ))}
          <div className="flex justify-between py-3">
            {offset > 0 && (
              <button
                className="min-h-11 text-sm"
                onClick={() => setOffset(Math.max(0, offset - 50))}
              >
                上一页
              </button>
            )}
            {query.data?.nextOffset != null && (
              <button
                className="ml-auto min-h-11 text-sm"
                onClick={() => setOffset(query.data!.nextOffset!)}
              >
                下一页
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
