import { ArrowUp, Copy, Loader2, RefreshCw, Trash2 } from "lucide-react";
import {
  type KeyboardEvent,
  type FormEvent,
  default as React,
  useEffect,
  useLayoutEffect,
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

/**
 * 折叠档该露出的那条回信；没有则 null。
 *
 * 外壳要用它决定收起档留多高（露了回信就得留得下，否则输入框会被挤出屏幕），
 * 聊天视图要用它决定画什么。两边必须是同一个判断，所以只写一次。
 *
 * 等回信期间返回 null：那会儿抬头的小人正在动，再摆一条旧回复会让人分不清新旧。
 */
export function mobileChatPeekReply(controller: {
  messages: readonly { role: string; content: string }[];
  isSubmitting: boolean;
  recoveryTurns: readonly { status: string }[];
}): string | null {
  if (
    controller.isSubmitting ||
    controller.recoveryTurns.some(turn => turn.status === "replying")
  ) {
    return null;
  }
  const last = [...controller.messages]
    .reverse()
    .find(message => message.role === "assistant");
  return last?.content ?? null;
}

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
  dense = false,
  replyMaxHeight,
  onArchive,
  onReplyHeightChange,
}: {
  controller: MobileConversationController;
  storyTitle: string;
  /** 常驻输入条那一档：只留输入行，消息区收起来（连它的内距一起）。 */
  dense?: boolean;
  /** 折叠档话语框的高度上限，由外壳按屏幕高度算好传进来。 */
  replyMaxHeight?: number;
  /** 打开「存入故事」。收起和展开档都在，位置固定。 */
  onArchive?: () => void;
  /** 把话语框实际需要的高度报给外壳，好让它把面板留够。 */
  onReplyHeightChange?: (height: number) => void;
}) {
  const [draft, setDraft] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const replyRef = useRef<HTMLDivElement>(null);

  const latestReply = mobileChatPeekReply(controller);

  /*
    话语框要多高，只有排完版才知道，所以量出来报给外壳。
    量的是 scrollHeight——内容自己的高度，和我们施加的 max-height 无关，
    因此「量到 → 外壳加高 → 又量一遍」不会互相追着涨。
  */
  useLayoutEffect(() => {
    if (!onReplyHeightChange) return;
    const element = dense ? replyRef.current : null;
    if (!element) {
      onReplyHeightChange(0);
      return;
    }
    const report = () => onReplyHeightChange(element.scrollHeight);
    report();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, [dense, latestReply, replyMaxHeight, onReplyHeightChange]);

  // 等回信的样子由面板抬头那只小人代言（MobileWorkspaceFrame 的 waitingForReply）。
  // 这里只负责一件事：replying 的轮次不要再以故障卡片的样子重复出现一遍。
  const visibleRecoveryTurns = controller.recoveryTurns.filter(
    turn => turn.status !== "replying"
  );

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
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-contain px-3",
          dense ? "hidden" : "py-5"
        )}
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
                  "max-w-[85%] whitespace-pre-wrap break-words px-3.5 py-2.5 text-[15px] leading-relaxed shadow-sm",
                  message.role === "user"
                    ? "ml-auto rounded-2xl rounded-tr-sm bg-primary text-primary-foreground"
                    : "mr-auto rounded-2xl rounded-tl-sm border border-border/70 bg-background/90 text-foreground"
                )}
              >
                {message.content}
              </li>
            ))}
          </ol>
        ) : null}

        {visibleRecoveryTurns.length > 0 ? (
          <div className="mx-auto mt-4 flex w-full max-w-2xl flex-col gap-2">
            {visibleRecoveryTurns.map(turn => (
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

      {/*
        折叠档的话语框：消息区是收起的，但新回信必须自己蹦出来——否则用户在
        常驻输入条发完消息，回信到了却毫无动静，只能靠自己想起来去拉面板。

        这里刻意**不截断**。原来是 line-clamp-2 + 点一下展开，长回答就只能靠
        拉开整个聊天才读得完；话语框自己能滚，长短都在收起档读完，展开与否
        永远是用户自己的选择。

        也刻意**不是 button**：框内要滚动，包一层按钮会让每次滑动都像在点它。
      */}
      {dense && latestReply ? (
        <div
          ref={replyRef}
          data-sheet-action="latest-reply"
          role="log"
          aria-live="polite"
          aria-label="聊聊说的话"
          tabIndex={0}
          style={
            replyMaxHeight ? { maxHeight: `${replyMaxHeight}px` } : undefined
          }
          className="mx-3 mb-1 min-h-0 shrink-0 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words rounded-[4px_16px_16px_16px] bg-muted px-4 py-3.5 text-left text-[15px] leading-[1.8] text-foreground"
        >
          {latestReply}
        </div>
      ) : null}

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
          {/*
            输入框｜存入故事｜发送。位置固定，收起和展开档都在。
            存入和发送是两个独立动作：这颗**不**发送输入框里的字，
            它存的是聊聊说出来的正文。
          */}
          {onArchive ? (
            <Button
              type="button"
              variant="outline"
              className="h-11 shrink-0 whitespace-nowrap rounded-2xl px-3 text-xs"
              onClick={onArchive}
            >
              存入故事
            </Button>
          ) : null}
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
              // 确认稿里发送是一支向上的箭头
              <ArrowUp aria-hidden="true" />
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
