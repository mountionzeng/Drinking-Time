import { Copy, Loader2, RefreshCw, Send, Trash2 } from "lucide-react";
import {
  type KeyboardEvent,
  type FormEvent,
  default as React,
  useEffect,
  useRef,
  useState,
} from "react";

import EmotiveWuxingIcon from "@/features/nayin/views/EmotiveWuxingIcon";
import type { NayinElement } from "@/features/nayin/nayin";
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

/**
 * 等回信时那只小人：左边是当天五行的小家伙，右边一个白气泡里三个点在跳。
 *
 * 为什么不用原来那张琥珀色的「正在生成回复…」卡片：那张卡是给**出事之后**
 * 准备的（带重试／复制／移除），把正常的等待也塞进同一个壳里，等于每聊一句
 * 都先弹一次故障样式的东西。等待是常态，故障才是例外，两者不该长一个样。
 *
 * 三个点用 animation-delay 错开，不引第三方动画库；prefers-reduced-motion
 * 下 Tailwind 的 animate-* 会自己停，静止的三个点仍然读得懂。
 */
function MobileTypingBubble({ element }: { element?: NayinElement }) {
  return (
    <li className="mr-auto flex max-w-[85%] items-end gap-1.5" data-testid="mobile-typing">
      {element ? (
        <EmotiveWuxingIcon animated element={element} size={34} />
      ) : null}
      <span className="flex items-center gap-1 rounded-2xl rounded-bl-sm border border-border/70 bg-background/90 px-3.5 py-3 shadow-sm">
        <span className="sr-only">正在回信…</span>
        {[0, 150, 300].map(delay => (
          <span
            key={delay}
            aria-hidden="true"
            className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
    </li>
  );
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
  element,
  dense = false,
}: {
  controller: MobileConversationController;
  storyTitle: string;
  /**
   * 当天的纳音五行，用来画助手气泡抬头那位小人。
   * 由调用方从 useNayin() 取好传进来 —— 组件内不调，
   * 否则脱离 NayinProvider 单渲（本组件的测试就是）会直接抛错。
   */
  element?: NayinElement;
  /** 常驻输入条那一档：只留输入行，消息区收起来（连它的内距一起）。 */
  dense?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  // 「正在等回信」有两个来源：本轮请求还在飞（isSubmitting），以及刷新后从
  // 本地恢复出来的 replying 的轮次。两者要合成同一个视觉，不能各画各的。
  const waiting =
    controller.isSubmitting ||
    controller.recoveryTurns.some(turn => turn.status === "replying");
  // replying 已经由上面那只小人代言了，故障卡片里就别再重复一遍。
  const visibleRecoveryTurns = controller.recoveryTurns.filter(
    turn => turn.status !== "replying"
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [controller.messages.length, controller.recoveryTurns.length, waiting]);

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
                {message.role === "user" ? null : (
                  <span className="mb-1 flex items-center gap-1.5">
                    {element ? (
                      <EmotiveWuxingIcon
                        animated={false}
                        element={element}
                        size={26}
                      />
                    ) : null}
                    <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground opacity-80">
                      聊聊
                    </span>
                  </span>
                )}
                {message.content}
              </li>
            ))}
            {waiting ? <MobileTypingBubble element={element} /> : null}
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
        面板收起（dense）时整个消息区是 hidden 的，等回信的小人画在里面就等于
        没画——用户在常驻输入条发完消息，只能看着发送键转圈。所以收起档单独
        在输入条上方露一条，拉开时不重复画。
      */}
      {dense && waiting ? (
        <div className="shrink-0 px-4 pb-1 pt-2">
          <ol className="flex">
            <MobileTypingBubble element={element} />
          </ol>
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
