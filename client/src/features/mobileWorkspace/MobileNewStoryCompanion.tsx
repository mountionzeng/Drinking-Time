import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { MobileCompanionActions } from "./MobileCompanionActions";
import React, {
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { useNayin } from "@/features/nayin/NayinContext";
import { trpc } from "@/lib/trpc";
import {
  MobileMemoryFollowup,
  companionSourceLabel,
  memoryFollowupKey,
  readMemoryFollowup,
  type MemoryFollowupSource,
} from "./mobileMemoryFollowup";
import { MobileMemoryFollowupChat } from "./MobileMemoryFollowupChat";
import { MobileTextDraftFlow } from "./MobileTextDraftFlow";
import { MobileChatView } from "./MobileChatView";
import { useMobileConversation } from "./useMobileConversation";
import { NayinCompanion } from "./NayinCompanion";
import {
  nayinCompanionTravel,
  NAYIN_COMPANION_MOTION,
} from "./nayinCompanionMotion";
import { XiaoyiBird } from "./XiaoyiBird";
import { companionAttention } from "./companionAttention";
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
export function MobileNewStoryCompanion({
  userId,
  idleAnimations = false,
}: {
  userId: number;
  idleAnimations?: boolean;
}) {
  const t = useUiText();

  const { element, visualTheme } = useNayin();
  const reduced = useReducedMotion();
  const [actionLocked, setActionLocked] = useState(false);
  const [open, setOpen] = useState(false);
  const { source: pageSource, moduleSource } = useContext(MobileMemoryFollowup);
  const memorySource = moduleSource ?? pageSource;
  const [restoredMemory] = useState(() =>
    readMemoryFollowup(sessionStorage(), userId)
  );
  const [activeMemory, setActiveMemory] = useState<MemoryFollowupSource | null>(
    restoredMemory.source
  );
  const [memoryLocked, setMemoryLocked] = useState(
    Boolean(restoredMemory.draft.trim())
  );
  const [memoryThinking, setMemoryThinking] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState(restoredMemory.draft);
  useEffect(() => {
    if (
      !actionLocked &&
      activeMemory?.kind === "layout" &&
      memorySource?.kind === "layout" &&
      activeMemory.id === memorySource.id &&
      activeMemory.storyId === memorySource.storyId &&
      activeMemory !== memorySource
    )
      setActiveMemory(memorySource);
  }, [actionLocked, activeMemory, memorySource]);
  const memoryBaseline = useRef<Set<string> | null>(
    restoredMemory.baseline ? new Set(restoredMemory.baseline) : null
  );
  useEffect(() => {
    try {
      sessionStorage()?.setItem(
        memoryFollowupKey(userId),
        JSON.stringify({
          source: activeMemory,
          draft: memoryDraft,
          baseline: memoryBaseline.current ? [...memoryBaseline.current] : null,
        })
      );
    } catch {
      /* in-memory input stays usable */
    }
  }, [userId, activeMemory, memoryDraft, memoryLocked]);
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
  function changeOpen(next: boolean) {
    if (!next && actionLocked) return;
    if (next) {
      const different =
        activeMemory?.id !== memorySource?.id ||
        activeMemory?.storyId !== memorySource?.storyId;
      if (
        activeMemory?.kind === "layout" &&
        memorySource?.kind === "layout" &&
        !different &&
        !actionLocked
      ) {
        // Queued turns already own immutable snapshots. Keep unsent words while
        // following the currently selected module in the same layout session.
        setActiveMemory(memorySource);
        setError(null);
      } else if (!memoryLocked && !busy && !unsynced && !session.draft.trim()) {
        if (different) memoryBaseline.current = null;
        setActiveMemory(memorySource);
        setError(null);
      } else if (different) {
        setError(
          "还有未发送或未同步的内容，先继续当前对话；处理好后再切换回忆。"
        );
      }
    }
    setOpen(next);
  }
  useEffect(() => {
    const openFromEditor = (event: Event) => {
      const source = (event as CustomEvent<MemoryFollowupSource>).detail;
      if (memoryLocked || busy || unsynced || session.draft.trim()) {
        setError("还有未发送或未同步的内容，请先处理当前对话。");
        setOpen(true);
        return;
      }
      if (
        activeMemory?.id !== source.id ||
        activeMemory?.storyId !== source.storyId
      )
        memoryBaseline.current = null;
      setActiveMemory(source);
      setError(null);
      setOpen(true);
    };
    window.addEventListener("dt:open-mobile-companion", openFromEditor);
    return () =>
      window.removeEventListener("dt:open-mobile-companion", openFromEditor);
  }, [memoryLocked, busy, unsynced, session.draft, activeMemory]);
  const height = Math.max(180, Math.min(560, viewport.height - 130));
  const dockBottom = 0;
  const attention = companionAttention(
    open,
    activeMemory
      ? memoryThinking
      : creating ||
          conversation.isSubmitting ||
          (queued !== null && conversation.historyState !== "error")
  );
  return (
    <DialogPrimitive.Root open={open} onOpenChange={changeOpen}>
      <DialogPrimitive.Trigger asChild>
        <motion.button
          type="button"
          className="mobile-xiaoyi-launcher"
          data-open={open}
          data-idle-animations={idleAnimations && !open}
          data-theme={visualTheme}
          aria-label={
            open
              ? t("收起小忆")
              : memorySource
                ? t("找小忆，接着这段{0}聊", [
                    t(companionSourceLabel(memorySource)),
                  ])
                : t("找小忆，聊一个新故事")
          }
          style={{
            bottom: open
              ? `calc(${viewport.bottom}px + env(safe-area-inset-bottom, 0px))`
              : `${viewport.bottom}px`,
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
          <span className="mobile-xiaoyi-visual">
            {visualTheme === "shiguang" ? (
              <XiaoyiBird
                active={!open && idleAnimations}
                attention={attention}
              />
            ) : (
              <NayinCompanion
                element={element}
                active={!open && idleAnimations}
                docked={!open}
                attention={attention}
              />
            )}
          </span>
          <span className="sr-only">{t("小忆")}</span>
        </motion.button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="mobile-xiaoyi-overlay"
          data-theme={visualTheme}
          data-element={element}
        />
        <DialogPrimitive.Content
          className="mobile-xiaoyi-dialog"
          aria-describedby={undefined}
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
          <DialogPrimitive.Title className="sr-only">
            {t("小忆")}
          </DialogPrimitive.Title>
          <header className="mobile-xiaoyi-header">
            <DialogPrimitive.Close
              ref={closeRef}
              disabled={actionLocked}
              className="mobile-xiaoyi-close"
            >
              {t("收起")}
              <ChevronDown size={16} />
            </DialogPrimitive.Close>
          </header>
          {error && (
            <p role="alert" className="px-4 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          {queued && conversation.historyState === "error" && (
            <p role="status" className="px-4 text-sm">
              {t("第一句话已保留，重试聊天记录后继续发送。")}
            </p>
          )}
          <div
            className="min-h-0 flex-1"
            style={activeMemory ? { display: "none" } : undefined}
          >
            <MobileChatView
              controller={controller}
              composerDisabled={creating || queued !== null || actionLocked}
              storyTitle="新故事"
              greeting={t("我在呢。\n今天想从哪件小事聊起？")}
              draftValue={session.draft}
              onDraftChange={draft =>
                setSession(current => ({ ...current, draft }))
              }
            />
          </div>
          {activeMemory && (
            <div className="min-h-0 flex-1">
              <MobileMemoryFollowupChat
                key={`${userId}:${activeMemory.storyId}:${activeMemory.id}`}
                userId={userId}
                source={activeMemory}
                draft={memoryDraft}
                setDraft={setMemoryDraft}
                baseline={memoryBaseline}
                onThinkingChange={setMemoryThinking}
                onLocked={setMemoryLocked}
                onActionLocked={setActionLocked}
                onTextSaved={setActiveMemory}
              />
            </div>
          )}
          {!activeMemory && (
            <>
              {session.storyId && (
                <MobileTextDraftFlow
                  key={`${userId}:${session.storyId}`}
                  userId={userId}
                  storyId={session.storyId}
                  messages={conversation.messages.map(
                    ({ id, role, content }) => ({ id, role, content })
                  )}
                  instruction={session.draft}
                  disabled={busy || unsynced || actionLocked}
                  onLocked={setActionLocked}
                />
              )}
              <MobileCompanionActions
                storyId={session.storyId}
                draft={session.draft}
                setDraft={draft =>
                  setSession(current => ({ ...current, draft }))
                }
                messages={conversation.messages}
                disabled={busy || unsynced || actionLocked}
                onLocked={setActionLocked}
              />
            </>
          )}
          <footer
            className="mobile-xiaoyi-footer"
            style={activeMemory ? { display: "none" } : undefined}
          >
            <span role="status" className={busy ? "sr-only" : undefined}>
              {busy
                ? creating
                  ? t("正在建立故事…")
                  : t("正在想…")
                : session.storyId
                  ? t("对话保存在故事里，电脑也能接着看")
                  : t("发送第一句话后，才会建立故事")}
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
                {t("另聊一个")}
              </button>
            )}
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
