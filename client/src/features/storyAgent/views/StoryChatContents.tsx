import React, { useRef, useState } from "react";
import { BookOpen, List, ArrowDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { openMemoryWarehouse } from "@/features/memoryWarehouse/memoryWarehouseEvents";
import { conversationSections } from "../conversationSections";
import type { ChatMessage } from "../types";
import { stripAssistantReasoning } from "@shared/assistantReplyText";

const visibleMessageText = (message: ChatMessage) => message.role === "assistant" ? stripAssistantReasoning(message.content) : message.content;

const excerpt = (content: string) => {
  const chars = Array.from(content.replace(/\s+/g, " ").trim());
  return chars.slice(0, 44).join("") + (chars.length > 44 ? "…" : "");
};

export function storyChatHistoryEntries(
  messages: readonly ChatMessage[],
  query: string
) {
  const search = query.trim();
  return conversationSections(messages)
    .map(group => ({
      ...group,
      entries: search
        ? group.messages.filter(message => visibleMessageText(message).includes(search))
        : group.messages.some(message => message.role === "user")
          ? group.messages.filter(message => message.role === "user")
          : [group.messages[0]],
    }))
    .filter(group => group.entries.length > 0);
}

export default function StoryChatContents({
  messages,
  onLocate,
  onLatest,
  disabled,
}: {
  messages: readonly ChatMessage[];
  onLocate: (id: string) => void;
  onLatest: () => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const locating = useRef(false);
  const query = search.trim();
  const visible = storyChatHistoryEntries(messages, query);
  return (
    <nav
      aria-label="故事对话内容"
      className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3 py-1 text-xs text-muted-foreground"
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex min-h-9 items-center gap-1.5 hover:text-foreground"
          >
            <List size={14} />
            聊天目录
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-80 max-w-[90vw] p-3"
          onCloseAutoFocus={event => {
            if (locating.current) event.preventDefault();
            locating.current = false;
          }}
        >
          <h2 className="font-serif text-base">故事里的对话</h2>
          <p className="mb-3 mt-1 text-xs text-muted-foreground">
            点一句原话，回到当时的上下文。
          </p>
          <input
            aria-label="查找当前故事对话"
            placeholder="查找这段对话…"
            className="mb-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
          <div className="max-h-[45vh] overflow-y-auto">
            {visible.map(group => (
              <section
                key={group.id}
                className="border-b border-border/40 py-2 last:border-0"
              >
                <h3 className="mb-1 text-xs text-muted-foreground">
                  {Number.isFinite(group.timestamp) &&
                  group.timestamp > 946684800000
                    ? new Date(group.timestamp).toLocaleString("zh-CN", {
                        month: "long",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "较早的聊天"}
                </h3>
                {group.entries.map(message => (
                  <button
                    key={message.id}
                    type="button"
                    className="block min-h-11 w-full rounded px-2 py-2 text-left text-sm leading-6 hover:bg-muted focus-visible:outline-primary"
                    onClick={() => {
                      locating.current = true;
                      setOpen(false);
                      onLocate(message.id);
                    }}
                  >
                    {(query || message.role === "assistant") && (
                      <span className="mr-1 text-xs text-muted-foreground">
                        {message.role === "user" ? "我说" : "小忆"} ·
                      </span>
                    )}
                    {excerpt(visibleMessageText(message))}
                  </button>
                ))}
              </section>
            ))}
            {!visible.length && (
              <p className="py-5 text-sm text-muted-foreground">
                {query
                  ? "没有找到这句话，试试其它关键词。"
                  : "从第一句话开始，聊天会留在这里。"}
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>
      <button
        type="button"
        disabled={disabled}
        className="inline-flex min-h-9 items-center gap-1.5 hover:text-foreground disabled:opacity-40"
        onClick={() => openMemoryWarehouse("story")}
      >
        <BookOpen size={14} />
        记事与文章来源
      </button>
      <button
        type="button"
        aria-label="回到最新对话"
        title="回到最新对话"
        className="grid size-9 place-items-center rounded hover:bg-muted"
        onClick={onLatest}
      >
        <ArrowDown size={14} />
      </button>
    </nav>
  );
}
