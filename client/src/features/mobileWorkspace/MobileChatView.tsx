import { Copy, Loader2, RefreshCw, Send, Trash2 } from "lucide-react";
import {
  type KeyboardEvent,
  type FormEvent,
  default as React,
  useEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useMobileConversation } from "./useMobileConversation";
import type { MobileConversationRecoveryTurn } from "./mobileConversationStore";

export type MobileConversationController = ReturnType<
  typeof useMobileConversation
>;

export function shouldSubmitMobileChatKey(input: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
}): boolean {
  return input.key === "Enter" && !input.shiftKey && !input.isComposing;
}

async function copyText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }
  if (typeof document === "undefined") throw new Error("当前环境无法复制");
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("复制失败");
}

function recoveryStatus(turn: MobileConversationRecoveryTurn): string {
  switch (turn.status) {
    case "replying":
      return "正在生成回复…";
    case "generation-failed":
      return "回复失败，内容已保留";
    case "generation-unknown":
      return "无法确认回复结果，内容已保留";
    case "persisting":
      return "正在同步到其他设备…";
    case "synced":
      return "已同步，正在刷新记录…";
    case "persistence-failed":
      return "回答已保留，但尚未同步";
  }
}

function MobileTurnRecovery({
  turn,
  onRetry,
  onDiscard,
  onAnnounce,
}: {
  turn: MobileConversationRecoveryTurn;
  onRetry: () => void;
  onDiscard: () => void;
  onAnnounce: (message: string) => void;
}) {
  const canRetry =
    turn.status === "generation-failed" ||
    turn.status === "generation-unknown" ||
    turn.status === "persistence-failed";
  const isWorking = turn.status === "replying" || turn.status === "persisting";
  const copyValue = turn.assistantContent || turn.userContent;

  return (
    <aside
      aria-label="待恢复的对话"
      className="mx-3 rounded-xl border border-amber-700/20 bg-amber-50/80 p-3 text-sm text-amber-950"
    >
      <div className="flex items-start gap-2">
        {isWorking ? (
          <Loader2 aria-hidden="true" className="mt-0.5 size-4 animate-spin" />
        ) : null}
        <p className="min-w-0 flex-1 leading-5" role="status">
          {recoveryStatus(turn)}
          {turn.error ? `：${turn.error}` : ""}
        </p>
      </div>
      {canRetry ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={onRetry}>
            <RefreshCw aria-hidden="true" />
            {turn.status === "persistence-failed" ? "重新同步" : "重试"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              void copyText(copyValue)
                .then(() => onAnnounce("内容已复制"))
                .catch(() => onAnnounce("复制失败，请长按正文复制"));
            }}
          >
            <Copy aria-hidden="true" />
            复制内容
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDiscard}>
            <Trash2 aria-hidden="true" />
            移除提示
          </Button>
        </div>
      ) : null}
    </aside>
  );
}

export function MobileChatView({
  controller,
  storyTitle,
}: {
  controller: MobileConversationController;
  storyTitle: string;
}) {
  const [draft, setDraft] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [controller.messages.length, controller.recoveryTurns.length]);

  const send = () => {
    const content = draft.trim();
    if (!content || !controller.canSend) return;
    setDraft("");
    setAnnouncement("消息已提交");
    void controller.submit(content);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    send();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      !shouldSubmitMobileChatKey({
        key: event.key,
        shiftKey: event.shiftKey,
        isComposing: event.nativeEvent.isComposing,
      })
    ) {
      return;
    }
    event.preventDefault();
    send();
  };

  return (
    <section
      aria-label={`${storyTitle}的聊聊`}
      className="flex h-full min-h-0 flex-col"
    >
      <div
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-5"
      >
        {controller.historyState === "loading" ? (
          <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            正在读取聊天记录…
          </div>
        ) : null}

        {controller.historyState === "error" ? (
          <div className="mx-auto flex min-h-40 max-w-sm flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-destructive">
              {controller.historyError || "聊天记录加载失败"}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => void controller.reloadHistory()}
            >
              <RefreshCw aria-hidden="true" />
              重试聊天记录
            </Button>
          </div>
        ) : null}

        {controller.historyState === "empty" ? (
          <div className="mx-auto flex min-h-48 max-w-xs flex-col items-center justify-center text-center">
            <div className="font-chat-brand text-2xl text-foreground">聊聊</div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              从一个念头开始，电脑上也能继续这段对话。
            </p>
          </div>
        ) : null}

        {controller.historyState === "loaded" ? (
          <ol className="mx-auto flex w-full max-w-2xl flex-col gap-3">
            {controller.messages.map(message => (
              <li
                key={message.id}
                className={cn(
                  "max-w-[88%] whitespace-pre-wrap break-words px-4 py-3 text-[15px] leading-6 shadow-sm",
                  message.role === "user"
                    ? "ml-auto rounded-2xl rounded-br-md bg-primary text-primary-foreground"
                    : "mr-auto rounded-2xl rounded-bl-md border border-border/70 bg-background/90 text-foreground"
                )}
              >
                {message.content}
              </li>
            ))}
          </ol>
        ) : null}

        {controller.recoveryTurns.length > 0 ? (
          <div className="mx-auto mt-4 flex w-full max-w-2xl flex-col gap-2">
            {controller.recoveryTurns.map(turn => (
              <MobileTurnRecovery
                key={turn.clientTurnId}
                turn={turn}
                onAnnounce={setAnnouncement}
                onRetry={() => void controller.retryTurn(turn.clientTurnId)}
                onDiscard={() =>
                  controller.discardRecoveryTurn(turn.clientTurnId)
                }
              />
            ))}
          </div>
        ) : null}
        <div ref={endRef} aria-hidden="true" />
      </div>

      <form
        className="mobile-workspace-composer shrink-0 border-t border-border/70 bg-background/95 px-3 pt-3 backdrop-blur"
        onSubmit={handleSubmit}
      >
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          <Textarea
            aria-label="给聊聊发送消息"
            className="max-h-32 min-h-11 resize-none rounded-2xl bg-background px-4 py-3 leading-5 shadow-sm"
            disabled={controller.historyState === "loading"}
            placeholder="继续聊聊…"
            rows={1}
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <Button
            type="submit"
            size="icon-lg"
            aria-label="发送消息"
            className="size-11 rounded-full"
            disabled={!draft.trim() || !controller.canSend}
          >
            {controller.isSubmitting ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <Send aria-hidden="true" />
            )}
            <span className="sr-only">发送</span>
          </Button>
        </div>
      </form>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}
