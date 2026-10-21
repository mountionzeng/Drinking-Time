import React, { useContext, useEffect, useState } from "react";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { cn } from "@/lib/utils";
import type { TextDraftVersion } from "@shared/textDraftHistory";
import type { MobileConversationController } from "./MobileChatView";
import type { MobileEditSeed } from "./MobileSyncedEditor";
import { MobileMemoryFollowup } from "./mobileMemoryFollowup";
import { MobileMemoryConversation } from "./MobileMemoryConversation";
import { MobileEditableMemories } from "./MobileEditableMemories";
const selectStyle =
  "min-h-11 max-w-full rounded-lg border border-border bg-background px-3 text-sm";
const readable =
  "whitespace-pre-wrap break-words font-serif text-base leading-[2] text-foreground";

export function MobileStoryMemories({
  storyId,
  onEdit,
  versions,
  conversation,
  onMakeArtwork,
}: {
  storyId: number;
  onEdit: (seed: MobileEditSeed) => void;
  versions: TextDraftVersion[];
  conversation: MobileConversationController;
  onMakeArtwork: (card: { id: string; title: string; content: string }) => void;
}) {
  const t = useUiText();

  const [sourceChoice, setSource] = useState<string | null>(null);
  const combinations = versions.filter(version => version.memoryCards?.length);
  const source = sourceChoice ?? "conversation";
  const cards = combinations.find(
    version => version.id === source
  )?.memoryCards;
  const { select: selectContext } = useContext(MobileMemoryFollowup);
  const cardContext = cards
    ? JSON.stringify(
        cards.map(card => ({
          id: card.id,
          content: card.content,
          origin: card.origin,
        }))
      )
    : null;
  useEffect(() => {
    if (!cardContext) return;
    selectContext({
      storyId,
      id: `combination:${source}`,
      origin: "note",
      content: `生成文字时使用的记忆（每段已标注来源，助手内容并非用户事实）：\n${cardContext}`,
    });
    return () => selectContext(null);
  }, [selectContext, storyId, source, cardContext]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
      {
        <select
          aria-label={t("记忆来源")}
          className={cn(selectStyle, "mb-4 w-full")}
          value={source}
          onChange={event => setSource(event.target.value)}
        >
          <option value="conversation">{t("原始聊天 · 目录与上下文")}</option>
          <option value="current">{t("回忆存档 · 记事、修订与图文")}</option>
          {combinations.map(version => (
            <option key={version.id} value={version.id}>
              {t("文字稿")}
              {version.sequence} {t("使用的记忆 ·")}{" "}
              {version.memoryCards!.length} {t("段")}
            </option>
          ))}
        </select>
      }
      {cards && (
        <p className="mb-4 text-xs leading-6 text-muted-foreground">
          {cards
            ? t("这份文字稿使用的记忆组合，按生成时的顺序保留。")
            : t("这段故事留下的聊天；不同记忆可以组合成不同文字稿。")}
        </p>
      )}
      {source === "current" ? (
        <MobileEditableMemories
          storyId={storyId}
          onEdit={onEdit}
          onMakeArtwork={onMakeArtwork}
        />
      ) : cards ? (
        cards.map(card => (
          <article key={card.id} className="border-b border-border/60 py-4">
            <p className="mb-2 text-xs text-muted-foreground">
              {card.origin === "assistant"
                ? t("聊聊整理")
                : card.origin === "user"
                  ? t("我的原话")
                  : t("我的记事")}
            </p>
            <h2 className="mb-2 text-base">{card.title}</h2>
            <p className={readable}>{card.content}</p>
            {card.content.trim() ? (
              <button
                type="button"
                className="mt-2 min-h-11 text-sm text-primary"
                onClick={() =>
                  onMakeArtwork({ ...card, id: `${source}:${card.id}` })
                }
              >
                {t("制作图文 →")}
              </button>
            ) : null}
          </article>
        ))
      ) : (
        <MobileMemoryConversation
          storyId={storyId}
          conversation={conversation}
          onMakeArtwork={onMakeArtwork}
        />
      )}
    </div>
  );
}
