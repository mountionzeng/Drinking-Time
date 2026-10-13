import React, { useEffect, useRef, useState, type CSSProperties } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronDown, Loader2 } from "lucide-react";
import { useNayin } from "@/features/nayin/NayinContext";
import { trpc } from "@/lib/trpc";
import { MobileChatView } from "./MobileChatView";
import { useMobileConversation } from "./useMobileConversation";
import { NayinCompanion } from "./NayinCompanion";
import {
  nayinCompanionTravel,
  NAYIN_COMPANION_MOTION,
} from "./nayinCompanionMotion";
import { XiaoyiBird } from "./XiaoyiBird";
import {
  canStartAnotherStory,
  emptyNewStorySession,
  newStorySessionKey,
  readNewStorySession,
} from "./newStorySession";
import "./mobileNewStoryCompanion.css";

function sessionStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Independent from the viewed story. Keeping this mounted preserves in-flight turns on close. */
export function MobileNewStoryCompanion({ userId }: { userId: number }) {
  const { element, visualTheme } = useNayin();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(() =>
    readNewStorySession(sessionStorage(), userId)
  );
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [queued, setQueued] = useState<string | null>(null);
  const creatingRef = useRef(false);
  const firstSend = useRef(false);
  const composing = useRef(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [viewport, setViewport] = useState({
    height: typeof window === "undefined" ? 800 : window.innerHeight,
    bottom: 0,
  });
  const storyUpsert = trpc.storyAgent.storyUpsert.useMutation({ retry: false });
  const utils = trpc.useUtils();
  const conversation = useMobileConversation({
    userId,
    storyId: session.storyId ?? 0,
  });
  const busy = creating || queued !== null || conversation.isSubmitting;
  const unsynced = conversation.recoveryTurns.some(
    turn => turn.status !== "synced"
  );

  useEffect(() => {
    try {
      sessionStorage()?.setItem(
        newStorySessionKey(userId),
        JSON.stringify(session)
      );
    } catch {
      /* Keep the in-memory draft usable. */
    }
  }, [session, userId]);
  useEffect(() => {
    const vv = window.visualViewport;
    const update = () =>
      setViewport({
        height: vv?.height ?? window.innerHeight,
        bottom: Math.max(
          0,
          window.innerHeight -
            (vv?.height ?? window.innerHeight) -
            (vv?.offsetTop ?? 0)
        ),
      });
    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  useEffect(() => {
    if (
      !queued ||
      !session.storyId ||
      !conversation.canSend ||
      !conversation.recoveryReady ||
      firstSend.current
    )
      return;
    firstSend.current = true;
    const content = queued;
    setQueued(null);
    setSession(current => ({ ...current, draft: "" }));
    void conversation
      .submit(content)
      .then(result => {
        if (!result) setSession(current => ({ ...current, draft: content }));
      })
      .catch(() => {
        setSession(current => ({ ...current, draft: content }));
        setError("消息未发出，文字已保留。");
      });
  }, [
    queued,
    session.storyId,
    conversation.canSend,
    conversation.recoveryReady,
    conversation.submit,
  ]);

  const submit = async (content: string) => {
    if (session.storyId) return conversation.submit(content);
    if (creatingRef.current) return null;
    creatingRef.current = true;
    setCreating(true);
    setError(null);
    setSession(current => ({ ...current, draft: content }));
    try {
      const result = await storyUpsert.mutateAsync({
        title: content.trim().slice(0, 24) || "新的故事",
      });
      if (!result?.id) throw new Error("没有收到故事编号");
      firstSend.current = false;
      setSession({ storyId: result.id, draft: content });
      setQueued(content);
      void utils.storyAgent.storyList.invalidate();
    } catch {
      setError(
        "新故事暂未创建成功，文字已保留。若网络中断，可先在故事列表检查是否已经创建，再重试。"
      );
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
    return null;
  };
  const controller = session.storyId
    ? { ...conversation, canSend: conversation.canSend && !queued }
    : {
        ...conversation,
        historyState: "empty" as const,
        historyError: null,
        messages: [],
        recoveryTurns: [],
        canSend: !creating,
        isSubmitting: creating,
        submit,
      };
  const height = Math.max(180, Math.min(560, viewport.height - 130));
  const dockBottom = 0;
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <div className="mobile-xiaoyi-dock-edge" aria-hidden="true" />
      <DialogPrimitive.Trigger asChild>
        <motion.button
          type="button"
          className="mobile-xiaoyi-launcher"
          data-open={open}
          data-theme={visualTheme}
          aria-label={open ? "收起小忆" : "找小忆，聊一个新故事"}
          style={{
            bottom: `calc(${viewport.bottom + dockBottom}px + env(safe-area-inset-bottom, 0px))`,
          }}
          initial={false}
          animate={
            visualTheme === "nayin"
              ? nayinCompanionTravel(
                  element,
                  open,
                  height + 14 - dockBottom,
                  !!reduced
                )
              : {
                  y: open ? -(height + 14 - dockBottom) : 0,
                  scale: open ? 1.03 : 1,
                }
          }
          transition={
            reduced
              ? { duration: 0 }
              : { type: "spring", stiffness: 190, damping: 22 }
          }
        >
          {visualTheme === "shiguang" ? (
            <XiaoyiBird active={!open} />
          ) : (
            <NayinCompanion element={element} active={!open} />
          )}
          <span className="sr-only">小忆</span>
        </motion.button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="mobile-xiaoyi-overlay" />
        <DialogPrimitive.Content
          className="mobile-xiaoyi-dialog"
          data-theme={visualTheme}
          style={
            {
              "--xiaoyi-height": `${height}px`,
              "--xiaoyi-duration":
                visualTheme === "shiguang"
                  ? "0.6s"
                  : `${NAYIN_COMPANION_MOTION[element].duration}s`,
              bottom: `calc(${viewport.bottom + 14}px + env(safe-area-inset-bottom, 0px))`,
            } as CSSProperties
          }
          onOpenAutoFocus={event => {
            event.preventDefault();
            closeRef.current?.focus();
          }}
          onEscapeKeyDown={event => {
            if (event.isComposing || composing.current) event.preventDefault();
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
        >
          <header className="mobile-xiaoyi-header">
            <div>
              <DialogPrimitive.Title>小忆</DialogPrimitive.Title>
              <DialogPrimitive.Description>
                {session.storyId
                  ? "这段新故事，慢慢聊"
                  : "从一件小事开始，聊一个新故事"}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              ref={closeRef}
              className="mobile-xiaoyi-close"
            >
              收起 <ChevronDown size={16} />
            </DialogPrimitive.Close>
          </header>
          {error && (
            <p role="alert" className="px-4 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          {queued && conversation.historyState === "error" && (
            <p role="status" className="px-4 text-sm">
              第一句话已保留，重试聊天记录后继续发送。
            </p>
          )}
          <div className="min-h-0 flex-1">
            <MobileChatView
              controller={controller}
              composerDisabled={creating || queued !== null}
              storyTitle="新故事"
              greeting={"我在呢。\n今天想从哪件小事聊起？"}
              draftValue={session.draft}
              onDraftChange={draft =>
                setSession(current => ({ ...current, draft }))
              }
            />
          </div>
          <footer className="mobile-xiaoyi-footer">
            <span role="status">
              {busy ? (
                <>
                  <Loader2 size={13} className="animate-spin" />{" "}
                  {creating ? "正在建立故事…" : "小忆正在听…"}
                </>
              ) : session.storyId ? (
                "对话保存在故事里，电脑也能接着看"
              ) : (
                "发送第一句话后，才会建立故事"
              )}
            </span>
            {session.storyId && (
              <button
                type="button"
                disabled={
                  !canStartAnotherStory({
                    busy,
                    draft: session.draft,
                    unsynced,
                  })
                }
                onClick={() => {
                  setSession(emptyNewStorySession());
                  setError(null);
                  firstSend.current = false;
                }}
              >
                另聊一个
              </button>
            )}
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
