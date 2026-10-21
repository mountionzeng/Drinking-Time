import {
  translateUi,
  useUiLanguage,
  useUiText,
  type UiLanguage,
} from "@/features/uiLanguage/UiLanguage";
import React, { useContext, useEffect, useRef, useState } from "react";
import { MobileMemoryFollowup } from "./mobileMemoryFollowup";
import { useReducedMotion } from "framer-motion";
import type { MobileConversationController } from "./MobileChatView";

export { conversationSections } from "@/features/storyAgent/conversationSections";
import { conversationSections } from "@/features/storyAgent/conversationSections";
function timeLabel(timestamp: number, language: UiLanguage) {
  return Number.isFinite(timestamp) && timestamp > 946684800000
    ? new Date(timestamp).toLocaleString(
        language === "zh" ? "zh-CN" : language,
        {
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }
      )
    : translateUi(language, "较早的聊天");
}
const excerpt = (text: string) => {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.slice(0, 36).join("") + (chars.length > 36 ? "…" : "");
};

export function MobileMemoryConversation({
  conversation,
  storyId,
  onMakeArtwork,
}: {
  storyId: number;
  conversation: MobileConversationController;
  onMakeArtwork: (card: { id: string; title: string; content: string }) => void;
}) {
  const t = useUiText();
  const { language } = useUiLanguage();

  const { select } = useContext(MobileMemoryFollowup);
  useEffect(() => () => select(null), [select, storyId]);
  const groups = conversationSections(conversation.messages);
  const reduced = useReducedMotion();
  const [selected, setSelected] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const current =
    conversation.messages.find(m => m.id === selected) ??
    conversation.messages.find(
      m => m.source !== "recovery" && m.role === "user"
    );
  useEffect(() => {
    select({
      storyId,
      id: current?.id ?? "memory:empty",
      content: current?.content ?? "当前回忆尚无可用聊天内容。",
      origin: current?.role ?? "note",
    });
  }, [select, storyId, current?.id, current?.content, current?.role]);

  useEffect(() => {
    if (!highlighted) return;
    const timer = setTimeout(() => setHighlighted(null), 2200);
    return () => clearTimeout(timer);
  }, [highlighted]);
  function locate(id: string) {
    const message = conversation.messages.find(m => m.id === id);
    if (message)
      select({ storyId, id, content: message.content, origin: message.role });
    setSelected(id);
    setHighlighted(id);
    const target = nodes.current.get(id);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({
      block: "center",
      behavior: reduced ? "instant" : "smooth",
    });
  }
  return (
    <div>
      {conversation.historyState === "loading" && (
        <p role="status">{t("正在读取原聊天…")}</p>
      )}
      {conversation.historyState === "error" && (
        <p role="alert">
          {t("聊天暂未读到。")}
          <button
            className="min-h-11 px-2 underline"
            onClick={() => void conversation.reloadHistory()}
          >
            {t("重试")}
          </button>
        </p>
      )}
      {groups.length > 0 && (
        <nav
          aria-label={t("聊天目录")}
          className="mb-6 border-y border-border/50 py-3"
        >
          <p className="mb-2 text-xs text-muted-foreground">
            {t("那时聊到 · 点一句查看，找小忆接着聊")}
          </p>
          <div className="max-h-44 overflow-y-auto" data-stage-swipe="ignore">
            {groups.map((group, index) => (
              <details key={group.id} open={groups.length === 1}>
                <summary className="cursor-pointer py-2 text-sm text-primary">
                  {timeLabel(group.timestamp, language)} ·{" "}
                  {excerpt(
                    group.messages.find(m => m.role === "user")?.content ??
                      group.messages[0].content
                  )}
                </summary>
                <ol className="border-l border-border pl-3">
                  {group.messages
                    .filter(m => m.role === "user")
                    .map(message => (
                      <li key={message.id}>
                        <button
                          className="min-h-11 w-full py-2 text-left text-sm leading-6 text-muted-foreground hover:text-primary"
                          onClick={() => locate(message.id)}
                        >
                          {excerpt(message.content)}
                        </button>
                      </li>
                    ))}
                  {!group.messages.some(m => m.role === "user") && (
                    <li>
                      <button
                        className="min-h-11 text-sm"
                        onClick={() => locate(group.messages[0].id)}
                      >
                        {t("查看这段对话")}
                        {index + 1}
                      </button>
                    </li>
                  )}
                </ol>
              </details>
            ))}
          </div>
        </nav>
      )}
      {!groups.length &&
        conversation.historyState !== "loading" &&
        conversation.historyState !== "error" && (
          <p className="py-6 text-sm text-muted-foreground">
            {t(
              "这个故事还没有已保存的聊天。手写记事和修订可以在“回忆存档”里查看。"
            )}
          </p>
        )}
      {groups.map(group => (
        <section
          key={group.id}
          aria-label={t("{0}的对话", [timeLabel(group.timestamp, language)])}
        >
          <h2 className="mb-3 mt-6 text-xs text-muted-foreground">
            {timeLabel(group.timestamp, language)}
          </h2>
          {group.messages.map(message => (
            <article
              key={message.id}
              ref={node => {
                if (node) nodes.current.set(message.id, node);
                else nodes.current.delete(message.id);
              }}
              tabIndex={-1}
              className={`mb-3 scroll-mt-4 rounded-xl px-3 py-4 outline-none transition-colors duration-300 motion-reduce:transition-none ${highlighted === message.id ? "bg-primary/10 ring-1 ring-primary/25" : message.role === "user" ? "bg-muted/40" : ""}`}
            >
              <p className="mb-2 text-xs text-muted-foreground">
                {message.role === "user" ? t("我说") : t("小忆")}
              </p>
              <button
                type="button"
                className="block w-full whitespace-pre-wrap break-words text-left font-serif text-base leading-8 focus-visible:outline-primary"
                onClick={() => locate(message.id)}
              >
                {message.content}
              </button>
              {selected === message.id ? (
                <button
                  className="mt-3 min-h-11 text-sm text-primary"
                  onClick={() =>
                    onMakeArtwork({
                      id: `chat:${message.id}`,
                      title:
                        message.role === "user" ? t("我的原话") : t("小忆回应"),
                      content: message.content,
                    })
                  }
                >
                  {t("制作图文 →")}
                </button>
              ) : null}
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}
