import React, { useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { trpc } from "@/lib/trpc";
import { useMobileConversation } from "@/features/mobileWorkspace/useMobileConversation";
import type { MobileConversationRecoveryTurn } from "@/features/mobileWorkspace/mobileConversationStore";
import {
  assertWritingSnapshotCurrent,
  writingCompanionErrorMessage,
  type WritingCompanionSnapshot,
} from "./writingCompanionText";

type Exchange = { role: "user" | "assistant"; content: string };
type Props = {
  resolveStoryId: () => number | Promise<number>;
  getSnapshot: () => WritingCompanionSnapshot;
  onInsert: (paragraph: string, snapshot: WritingCompanionSnapshot) => void;
  disabled?: boolean;
};

/** The closed trigger has no query hooks: SSR and reading never call a model. */
export function WritingCompanionButton(props: Props) {
  const [snapshot, setSnapshot] = useState<WritingCompanionSnapshot | null>(
    null
  );
  const headingRef = useRef<HTMLHeadingElement>(null);
  const latest = useRef(props);
  latest.current = props;
  return (
    <Popover
      open={snapshot !== null}
      onOpenChange={open => setSnapshot(open ? props.getSnapshot() : null)}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={props.disabled}
          aria-label="和小忆聊聊，帮我继续写"
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-background/80 px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40"
        >
          <img
            src="/shiguang/xiaoyi-avatar.png"
            alt=""
            className="size-9 object-contain"
            draggable={false}
          />
          <span>小忆帮写</span>
        </button>
      </PopoverTrigger>
      {snapshot && (
        <PopoverContent
          align="end"
          side="top"
          sideOffset={10}
          collisionPadding={12}
          className="w-[min(380px,calc(100vw-24px))] overflow-hidden rounded-2xl border-border/70 bg-background p-0 shadow-xl motion-reduce:animate-none"
          aria-label="小忆帮你继续写"
          onOpenAutoFocus={event => {
            event.preventDefault();
            headingRef.current?.focus();
          }}
        >
          <div className="flex items-center gap-2 border-b border-border/50 px-4 py-3">
            <img
              src="/shiguang/xiaoyi-avatar.png"
              alt=""
              className="size-8 object-contain"
            />
            <div className="flex-1">
              <h2
                ref={headingRef}
                tabIndex={-1}
                className="font-serif text-base outline-none"
              >
                {snapshot.selection ? "小忆，帮你改这一段" : "小忆，陪你写一会儿"}
              </h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {snapshot.selection
                  ? "只改选中的文字，其他正文保持原样"
                  : "从你停笔的地方，慢慢往下说"}
              </p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              aria-label="关闭小忆"
              onClick={() => setSnapshot(null)}
            >
              <X className="size-4" />
            </Button>
          </div>
          <WritingCompanionSession
            snapshot={snapshot}
            resolveStoryId={props.resolveStoryId}
            onInsert={(paragraph, original) => {
              if (latest.current.disabled)
                throw new Error(
                  "正文暂时无法编辑，请先处理保存或版本冲突。可以复制这段文字保留。"
                );
              assertWritingSnapshotCurrent(
                original,
                latest.current.getSnapshot()
              );
              latest.current.onInsert(paragraph, original);
              setSnapshot(null);
            }}
          />
        </PopoverContent>
      )}
    </Popover>
  );
}

function WritingCompanionSession({
  snapshot,
  resolveStoryId,
  onInsert,
}: Pick<Props, "resolveStoryId" | "onInsert"> & {
  snapshot: WritingCompanionSnapshot;
}) {
  const auth = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [storyId, setStoryId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const resolution = useRef<Promise<number> | null>(null);
  useEffect(() => {
    let active = true;
    resolution.current ??= Promise.resolve().then(resolveStoryId);
    void resolution.current
      .then(id => {
        if (active) setStoryId(id);
      })
      .catch(error => {
        if (active) setError(writingCompanionErrorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [resolveStoryId]);
  if (error || auth.isError || (!auth.isLoading && !auth.data))
    return (
      <p role="alert" className="p-4 text-sm">
        {error || "请登录后再和小忆聊聊。"}
      </p>
    );
  if (!storyId || !auth.data)
    return (
      <p role="status" className="p-4 text-sm text-muted-foreground">
        正在准备…
      </p>
    );
  return (
    <WritingCompanionPanel
      key={`${auth.data.id}:${storyId}`}
      userId={auth.data.id}
      storyId={storyId}
      snapshot={snapshot}
      onInsert={onInsert}
    />
  );
}

export function WritingCompanionPanel({
  userId,
  storyId,
  snapshot,
  onInsert,
}: {
  userId: number;
  storyId: number;
  snapshot: WritingCompanionSnapshot;
  onInsert: Props["onInsert"];
}) {
  const conversation = useMobileConversation({ userId, storyId });
  const openMutation = trpc.storyConversation.writingCompanionOpen.useMutation({
    retry: false,
  });
  const composeMutation =
    trpc.storyConversation.writingCompanionCompose.useMutation({
      retry: false,
    });
  const [workingSnapshot, setWorkingSnapshot] = useState(snapshot);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [answer, setAnswer] = useState("");
  const [paragraph, setParagraph] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [height, setHeight] = useState(480);
  const started = useRef(false);
  const inFlight = useRef(false);
  const scroll = useRef<HTMLDivElement>(null);
  const pending = conversation.recoveryTurns.find(
    turn => turn.status !== "synced"
  );
  const locked = busy || conversation.isSubmitting;

  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () =>
      setHeight(
        Math.max(
          180,
          Math.min(480, (viewport?.height ?? window.innerHeight) - 130)
        )
      );
    resize();
    viewport?.addEventListener("resize", resize);
    return () => viewport?.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    scroll.current?.scrollTo({
      top: scroll.current.scrollHeight,
      behavior: "auto",
    });
  }, [exchanges, busy, paragraph]);

  const perform = async (operation: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (error) {
      setError(writingCompanionErrorMessage(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const open = () =>
    perform(async () => {
      const result = await openMutation.mutateAsync({
        storyId,
        draft: snapshot.draft,
        cursor: snapshot.cursor,
        ...(snapshot.selection ? { selection: snapshot.selection } : {}),
      });
      setExchanges([{ role: "assistant", content: result.question }]);
    });
  useEffect(() => {
    if (started.current || !conversation.recoveryReady || !conversation.canSend)
      return;
    started.current = true;
    if (pending) {
      if (pending.writingContext)
        setWorkingSnapshot({
          ...pending.writingContext,
          scope: pending.writingContext.scope ?? snapshot.scope,
        });
      setExchanges([
        ...(pending.writingContext?.openingQuestion
          ? [
              {
                role: "assistant" as const,
                content: pending.writingContext.openingQuestion,
              },
            ]
          : []),
        { role: "user", content: pending.userContent },
      ]);
    } else {
      void open();
    }
  });

  const acceptTurn = (turn: MobileConversationRecoveryTurn | null) => {
    if (!turn) throw new Error("聊天记录尚未就绪，请稍后再试。");
    if (turn.status !== "synced")
      throw new Error(turn.error || "回答尚未保存，请恢复这一轮。");
    if (turn.assistantContent)
      setExchanges(current => [
        ...current,
        { role: "assistant", content: turn.assistantContent! },
      ]);
  };
  const send = () =>
    perform(async () => {
      const content = answer.trim();
      if (!content || pending) return;
      // Keep input visible until the durable turn has been created successfully.
      const result = await conversation.submit(content, {
        ...workingSnapshot,
        openingQuestion: exchanges
          .filter(item => item.role === "assistant")
          .at(-1)
          ?.content.slice(0, 500),
      });
      if (!result) throw new Error("聊天记录尚未就绪，请稍后再试。");
      setAnswer("");
      setExchanges(current => [...current, { role: "user", content }]);
      acceptTurn(result);
    });
  const compose = () =>
    perform(async () => {
      const result = await composeMutation.mutateAsync({
        storyId,
        draft: workingSnapshot.draft,
        cursor: workingSnapshot.cursor,
        ...(workingSnapshot.selection
          ? { selection: workingSnapshot.selection }
          : {}),
        exchanges: exchanges
          .slice(-16)
          .map(item => ({ ...item, content: item.content.slice(0, 4000) })),
      });
      if (result.paragraph) setParagraph(result.paragraph);
      else if (result.ask)
        setExchanges(current => [
          ...current,
          { role: "assistant", content: result.ask },
        ]);
    });

  return (
    <div className="flex flex-col" style={{ maxHeight: height }}>
      <div
        ref={scroll}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4"
        role="log"
        aria-label="和小忆的对话"
      >
        {exchanges.map((item, index) => (
          <p
            key={index}
            className={
              item.role === "user"
                ? "ml-8 rounded-2xl rounded-br-sm bg-muted/65 px-3 py-2 text-sm leading-7 whitespace-pre-wrap"
                : "pr-5 font-serif text-[15px] leading-7 whitespace-pre-wrap"
            }
          >
            {item.content}
          </p>
        ))}
        {locked && (
          <p
            role="status"
            className="flex items-center gap-2 text-xs text-muted-foreground"
          >
            <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
            {composeMutation.isPending
              ? "把你说的整理一下…"
              : "小忆正在读你的文字…"}
          </p>
        )}
        {paragraph !== null && (
          <label className="block text-xs text-muted-foreground">
            可以先改一改，再放进正文
            <textarea
              aria-label="准备放入正文的段落"
              className="mt-2 min-h-40 w-full resize-y rounded-lg border border-border/60 bg-transparent p-3 font-serif text-base leading-7 text-foreground focus-visible:outline-primary"
              value={paragraph}
              onChange={event => setParagraph(event.target.value)}
            />
          </label>
        )}
        {(error || conversation.historyError) && (
          <p role="alert" className="text-sm leading-6 text-destructive">
            {error || conversation.historyError}
          </p>
        )}
      </div>
      <div className="shrink-0 space-y-2 border-t border-border/50 px-4 py-3">
        {pending ? (
          <>
            <p className="text-xs leading-5 text-muted-foreground">
              上次回答还没同步。关闭后仍会保留，恢复时沿用同一轮。
            </p>
            <Button
              variant="outline"
              disabled={locked}
              className="w-full"
              onClick={() =>
                void perform(async () =>
                  acceptTurn(await conversation.retryTurn(pending.clientTurnId))
                )
              }
            >
              恢复这次回答
            </Button>
          </>
        ) : paragraph !== null ? (
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" onClick={() => setParagraph(null)}>
              再聊一句
            </Button>
            <Button
              disabled={!paragraph.trim()}
              onClick={() => {
                try {
                  onInsert(paragraph, workingSnapshot);
                } catch (error) {
                  setError(writingCompanionErrorMessage(error));
                }
              }}
            >
              {workingSnapshot.selection ? "替换选中文字" : "放进正文"}
            </Button>
          </div>
        ) : exchanges.length > 0 ? (
          <>
            <form
              className="flex items-end gap-2"
              onSubmit={event => {
                event.preventDefault();
                void send();
              }}
            >
              <textarea
                aria-label="回答小忆"
                placeholder="想起什么，就说什么…"
                rows={2}
                disabled={locked}
                maxLength={4000}
                value={answer}
                onChange={event => setAnswer(event.target.value)}
                className="min-h-12 min-w-0 flex-1 resize-none bg-transparent text-base leading-6 outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring rounded-lg"
              />
              <Button
                type="submit"
                size="icon"
                aria-label="发送回答"
                disabled={locked || !conversation.canSend || !answer.trim()}
                className="size-11 rounded-full"
              >
                <ArrowUp className="size-4" />
              </Button>
            </form>
            {exchanges.some(item => item.role === "user") && (
              <Button
                variant="ghost"
                className="w-full text-xs"
                disabled={locked || Boolean(answer.trim())}
                onClick={() => void compose()}
              >
                整理成一段
              </Button>
            )}
          </>
        ) : (
          !locked && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                if (conversation.historyState === "error")
                  void conversation.reloadHistory();
                else void open();
              }}
            >
              重新连接小忆
            </Button>
          )
        )}
        <p className="text-[10px] leading-4 text-muted-foreground">
          {workingSnapshot.selection
            ? "对话会留在这个故事里。替换后可继续编辑并保存。"
            : "回答会留在这个故事里。放进正文后，记得保存。"}
        </p>
      </div>
    </div>
  );
}
