import {
  BookOpenText,
  Loader2,
  MailOpen,
  RefreshCw,
  UserRound,
} from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  default as React,
  useEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/_core/hooks/useAuth";
import { useNayin } from "@/features/nayin/NayinContext";
import type { NayinElement } from "@/features/nayin/nayin";
import EmotiveWuxingIcon from "@/features/nayin/views/EmotiveWuxingIcon";
import { resolveRecentStoryEntry } from "@/features/storyAgent/recentStoryEntry";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { ComputeBalanceBadge } from "@/features/computeAccount/ComputeBalanceBadge";
import { MobileChatView } from "./MobileChatView";
import { MobileDailyLetter } from "./MobileDailyLetter";
import { MobileDocumentView } from "./MobileDocumentView";
import {
  MobileStoryPanel,
  type MobileStorySummary,
} from "./MobileStoryPanel";
import { useMobileConversation } from "./useMobileConversation";
import { useMobileDocument } from "./useMobileDocument";

export type MobileWorkspaceView = "chat" | "document";

type MobileStoryEntryCandidate = {
  id: number;
  shotCount?: number;
};

export function resolveMobileInitialStoryId(
  stories: readonly MobileStoryEntryCandidate[]
): number | null {
  return resolveRecentStoryEntry(stories, null)?.storyId ?? null;
}

type DirtyStorySwitchAction = "save" | "discard" | "cancel";
type DirtyStorySwitchOutcome = "switch" | "stay";

export async function resolveMobileDirtyStorySwitch(
  action: DirtyStorySwitchAction,
  controller: {
    save: () => Promise<{ status: string } | null>;
    discard: () => void;
  }
): Promise<DirtyStorySwitchOutcome> {
  if (action === "cancel") return "stay";
  if (action === "discard") {
    controller.discard();
    return "switch";
  }
  const result = await controller.save();
  return result?.status === "saved" || result?.status === "clean"
    ? "switch"
    : "stay";
}

/**
 * 手机工作区外壳 —— 对齐 docs/prototypes/liaohuier-miniapp 的设计。
 *
 * 正文常驻在上面；聊聊是底部那位「杯子小人」，平时只露出一条输入区，
 * 往上拖或点它就升成半屏／全屏浮在正文之上。
 *
 * 刻意**不新增状态机**：上游那套 activeView（chat｜document）原样保留，
 * 这里只把它映射成面板的开合——document = 收起，chat = 展开。
 * 这样切换 Story、脏正文裁决那些既有流程和测试都不受影响。
 */
type SheetStop = "peek" | "half" | "full";

const SHEET_PEEK_PX = 128;

function sheetStopHeight(stop: SheetStop, shellHeight: number): number {
  if (stop === "peek") return SHEET_PEEK_PX;
  return Math.round(shellHeight * (stop === "half" ? 0.5 : 0.88));
}

export function MobileWorkspaceFrame({
  activeView,
  onViewChange,
  storyTitle,
  balanceSlot,
  documentView,
  chatView,
  /** 正在等回信——抬头那只小人会动起来并冒出三个点。 */
  waitingForReply = false,
  children,
  overlays,
  onOpenStories,
  onOpenAccount,
  element = "metal",
}: {
  activeView: MobileWorkspaceView;
  onViewChange: (view: MobileWorkspaceView) => void;
  /** 当前故事名。只读——切换故事走底部「聊点其他的」那张面板。 */
  storyTitle?: string;
  /** 顶栏右侧的算力余额。由调用方传，外壳不碰 tRPC。 */
  balanceSlot?: ReactNode;
  /** 正文常驻区；加载／空／错误态用 children 兜底 */
  documentView?: ReactNode;
  /** 有对话时才挂聊聊面板；空 Story 或读取失败时不挂 */
  /** 收到 stop 决定要不要紧凑显示，所以用函数而不是现成节点 */
  chatView?: (options: { dense: boolean }) => ReactNode;
  waitingForReply?: boolean;
  /** 没有 documentView 时的兜底内容（加载／空／错误态）。 */
  children?: ReactNode;
  /** 浮层：对话框、面板。永远渲染，不受 documentView 影响。 */
  overlays?: ReactNode;
  onOpenStories?: () => void;
  onOpenAccount?: () => void;
  /** 当天的纳音五行。由调用方从 useNayin() 取好传进来，
      外壳本身不碰 context，才能脱离 NayinProvider 单测。 */
  element?: NayinElement;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ y: number; h: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  // 外壳高度必须存进 state：render 期间读 ref 首帧拿到 0，
  // 半屏/全屏会被算成 0 再回退到常驻档的高度。
  const [shellH, setShellH] = useState(0);

  const stop: SheetStop =
    activeView === "document" ? "peek" : expanded ? "full" : "half";

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const updateHeight = () => {
      shellRef.current?.style.setProperty(
        "--mobile-viewport-height",
        `${viewport.height}px`
      );
      setShellH(shellRef.current?.getBoundingClientRect().height ?? 0);
    };
    updateHeight();
    viewport.addEventListener("resize", updateHeight);
    viewport.addEventListener("scroll", updateHeight);
    return () => {
      viewport.removeEventListener("resize", updateHeight);
      viewport.removeEventListener("scroll", updateHeight);
    };
  }, []);

  // visualViewport 缺席时（桌面浏览器、SSR 测试）也要量一次
  useEffect(() => {
    if (window.visualViewport) return;
    setShellH(shellRef.current?.getBoundingClientRect().height ?? 0);
  }, []);

  const shellHeight = () =>
    shellH || shellRef.current?.getBoundingClientRect().height || 0;

  const settle = (height: number) => {
    const full = shellHeight();
    const candidates: SheetStop[] = ["peek", "half", "full"];
    const nearest = candidates.reduce((best, candidate) =>
      Math.abs(height - sheetStopHeight(candidate, full)) <
      Math.abs(height - sheetStopHeight(best, full))
        ? candidate
        : best
    );
    setDragHeight(null);
    setExpanded(nearest === "full");
    onViewChange(nearest === "peek" ? "document" : "chat");
  };

  const sheetHeight =
    dragHeight ?? (sheetStopHeight(stop, shellHeight()) || SHEET_PEEK_PX);

  return (
    <div
      ref={shellRef}
      className="mobile-workspace-page"
      style={{ "--mobile-viewport-height": "100dvh" } as CSSProperties}
    >
      <div className="relative mx-auto flex h-full w-full max-w-3xl flex-col overflow-hidden bg-background">
        {/* 聊聊拉开时把这行收掉，正文多露一截；收起面板它自己回来 */}
        <header
          aria-hidden={activeView === "chat"}
          className={cn(
            "flex min-w-0 items-center gap-3 overflow-hidden px-4",
            "transition-[max-height,opacity,padding] duration-200 ease-out",
            activeView === "chat"
              ? "pointer-events-none max-h-0 pt-0 pb-0 opacity-0"
              : "max-h-16 pt-3 pb-1 opacity-100"
          )}
        >
          <span
            aria-label="碎碎念手机工作区"
            className="font-chat-brand shrink-0 text-xl leading-none text-foreground"
          >
            碎碎念
          </span>
          {storyTitle ? (
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground">
              {storyTitle}
            </span>
          ) : null}
          {/* 钱在两块屏幕上都得一直看得见。由调用方传进来——外壳自己不碰
              tRPC，否则脱离 Provider 单渲（本文件的测试就是）会当场抛错，
              和 element 那个 prop 是同一个道理。 */}
          {balanceSlot}
        </header>

        {/* 正文常驻。children 在这里只当「没有 documentView 时的兜底内容」 */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {documentView ?? children}
        </div>

        {/* 聊聊：常驻输入条 / 半屏 / 全屏 */}
        {chatView && activeView === "chat" && (
          <button
            type="button"
            aria-label="收起聊聊"
            // 不压暗：拉开面板正是为了同时读正文，压暗等于把要读的东西盖住。
            // 这层只用来「点空白处收起」。
            className="absolute inset-0 z-20"
            onClick={() => onViewChange("document")}
          />
        )}
        {chatView && (
        <div
          ref={sheetRef}
          className={cn(
            "absolute inset-x-0 bottom-[64px] z-30 flex flex-col rounded-t-[20px] bg-background",
            "shadow-[0_-10px_30px_-12px_rgba(76,60,20,0.3)]",
            dragRef.current ? "" : "transition-[height] duration-200 ease-out"
          )}
          style={{ height: sheetHeight }}
        >
          <div
            className="shrink-0 cursor-grab touch-none px-4 pt-2"
            onPointerDown={event => {
              if ((event.target as HTMLElement).closest("[data-sheet-action]"))
                return;
              dragRef.current = {
                y: event.clientY,
                h: sheetRef.current?.getBoundingClientRect().height ?? 0,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event => {
              const drag = dragRef.current;
              if (!drag) return;
              const next = Math.max(
                SHEET_PEEK_PX,
                Math.min(
                  sheetStopHeight("full", shellHeight()),
                  drag.h + (drag.y - event.clientY)
                )
              );
              setDragHeight(next);
            }}
            onPointerUp={() => {
              const drag = dragRef.current;
              if (!drag) return;
              dragRef.current = null;
              settle(
                sheetRef.current?.getBoundingClientRect().height ?? SHEET_PEEK_PX
              );
            }}
            onPointerCancel={() => {
              dragRef.current = null;
              setDragHeight(null);
            }}
          >
            <span className="mx-auto mb-1.5 block h-1 w-9 rounded-full bg-border" />
            <div className="flex min-h-9 items-center gap-2">
              {/*
                抬头这只小人就是「聊聊」本人，等回信时让**它**动起来，
                而不是在下面另画一只——两只一模一样的小人上下排着，
                看起来像复制粘贴，也说不清楚哪只才是在等。
              */}
              <EmotiveWuxingIcon
                element={element}
                size={stop === "peek" ? 34 : 28}
                animated={waitingForReply}
              />
              {waitingForReply ? (
                <span
                  aria-hidden="true"
                  className="flex items-center gap-1 rounded-full bg-muted/70 px-2.5 py-1.5"
                >
                  {[0, 150, 300].map(delay => (
                    <span
                      key={delay}
                      className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60"
                      style={{ animationDelay: `${delay}ms` }}
                    />
                  ))}
                </span>
              ) : stop !== "peek" ? (
                <span className="font-chat-brand text-[17px] leading-none text-primary">
                  聊聊
                </span>
              ) : null}
              <button
                type="button"
                data-sheet-action="toggle"
                className="ml-auto min-h-9 px-1.5 text-xs text-muted-foreground"
                onClick={() =>
                  onViewChange(activeView === "document" ? "chat" : "document")
                }
              >
                {stop === "peek" ? "拉开看全部 ⌃" : "收起 ⌄"}
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {chatView({ dense: stop === "peek" })}
          </div>
        </div>
        )}

        {/* 底部：一张手绘桌子，书（故事）、杯（聊聊）、人（我）都摆在上面 */}
        <MobileTableBar
          element={element}
          onOpenStories={onOpenStories ?? (() => {})}
          onOpenAccount={onOpenAccount}
        />

        {/*
          浮层（故事菜单、每日来信、「我」、正文未保存裁决）挂在这里。

          原来它们是当 children 传进来的，而上面那行是 `documentView ?? children`
          ——documentView 一有值 children 就整个不渲染。于是这些对话框**一次都
          没有出现过**：点「聊点其他的」没反应、每日来信从不自动弹、「我」打不开，
          看起来像三个互不相干的 bug，其实是同一个。

          所以把两种角色拆开：children 只当内容兜底，浮层走 overlays，永远渲染。
        */}
        {overlays}
      </div>
    </div>
  );
}


/**
 * 底部那张手绘桌子：书（故事）、杯子小人（聊聊）、人（我）都摆在同一张桌面上。
 * 桌沿是画出来的曲线加两条桌腿，不是 1px 的 border —— 设计上刻意不要那根直线。
 */
function MobileTableBar({
  element,
  onOpenStories,
  onOpenAccount,
}: {
  element: NayinElement;
  onOpenStories: () => void;
  /** 没传就不画「我」——外壳不直接碰 useAuth，保持可独立测试 */
  onOpenAccount?: () => void;
}) {
  return (
    <>
      <nav
        aria-label="手机工作区"
        className="relative z-40 grid h-16 shrink-0 grid-cols-[1fr_96px_1fr] items-center bg-background"
      >
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-16 w-full text-border"
          fill="none"
          preserveAspectRatio="none"
          stroke="currentColor"
          strokeLinecap="round"
          viewBox="0 0 375 64"
        >
          <path d="M14,30.5 q92,-2.2 184,-.8 q90,1.4 163,2.6" strokeWidth="1.7" vectorEffect="non-scaling-stroke" />
          <path d="M17,34.2 q92,-2.2 184,-.8 q88,1.4 158,2.4" strokeWidth="1.1" opacity=".5" vectorEffect="non-scaling-stroke" />
          <path d="M31,36 q-1.6,10 -2.6,17" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
          <path d="M345,36.5 q1.6,10 2.6,17" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        </svg>

        <button
          type="button"
          className="relative z-10 flex h-full flex-col items-center justify-center gap-1 text-[10px] text-muted-foreground"
          onClick={onOpenStories}
        >
          <BookOpenText aria-hidden="true" className="size-5" />
          故事
        </button>

        {/*
          中间这颗**永远**打开故事菜单（开启新故事 / 回到以前的故事）。
          
          先前做成了「正文页开聊天、聊天页才出菜单」，是我把需求读窄了：
          聊天本来就不需要这颗按钮——常驻输入条一直在，打字即可开聊，
          要看历史就拖那张面板或点「拉开看全部」。这颗按钮唯一不可替代的
          用途是换一个故事，所以它就该只干这件事。
          原来顶栏那个故事下拉因此撤掉，切故事只剩这一个入口。
        */}
        <button
          type="button"
          aria-label="聊点其他的"
          className="relative z-10 flex h-full flex-col items-center justify-end gap-0.5 pb-1.5"
          onClick={onOpenStories}
        >
          <span className="absolute -top-6 left-1/2 -ml-7">
            <EmotiveWuxingIcon element={element} size={56} animated={false} />
          </span>
          <span className="font-chat-brand text-[15px] leading-none text-primary">
            聊点其他的
          </span>
        </button>

        {onOpenAccount ? (
          <button
            type="button"
            className="relative z-10 flex h-full flex-col items-center justify-center gap-1 text-[10px] text-muted-foreground"
            onClick={onOpenAccount}
          >
            <UserRound aria-hidden="true" className="size-5" />
            我
          </button>
        ) : (
          <span />
        )}
      </nav>

    </>
  );
}

export function MobileEmptyState({
  onCreateStory,
  creating = false,
  error = null,
}: {
  onCreateStory?: () => void;
  creating?: boolean;
  error?: string | null;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-7 text-center">
      <BookOpenText aria-hidden="true" className="size-9 text-primary" />
      <h1 className="mt-4 text-lg font-semibold">还没有故事</h1>
      <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
        新建一个，就从这里开始聊。电脑上也能接着写同一个故事。
      </p>
      {onCreateStory ? (
        <Button
          type="button"
          className="mt-5 min-h-11 rounded-xl px-6"
          disabled={creating}
          onClick={onCreateStory}
        >
          {creating ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : null}
          {creating ? "正在新建…" : "新建一个故事"}
        </Button>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function MobileStoryListError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-7 text-center">
      <h1 className="text-lg font-semibold">Story 暂时无法读取</h1>
      <p className="mt-2 max-w-sm text-sm leading-6 text-destructive">
        {message}
      </p>
      <Button type="button" variant="outline" className="mt-4" onClick={onRetry}>
        <RefreshCw aria-hidden="true" />
        重试 Story 列表
      </Button>
    </div>
  );
}

function MobileWorkspaceLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 aria-hidden="true" className="size-4 animate-spin" />
      {label}
    </div>
  );
}

function MobileSelectedStoryWorkspace({
  userId,
  activeStoryId,
  stories,
  activeView,
  onViewChange,
  onStoryChange,
  onCreateStory,
  creatingStory = false,
}: {
  userId: number;
  activeStoryId: number;
  stories: readonly MobileStorySummary[];
  activeView: MobileWorkspaceView;
  onViewChange: (view: MobileWorkspaceView) => void;
  onStoryChange: (storyId: number) => void;
  onCreateStory?: () => void;
  creatingStory?: boolean;
}) {
  const story = stories.find(candidate => candidate.id === activeStoryId);
  const { element } = useNayin();
  const { user, logout } = useAuth();
  const [accountOpen, setAccountOpen] = useState(false);
  const [letterOpen, setLetterOpen] = useState(false);
  const conversation = useMobileConversation({ userId, storyId: activeStoryId });
  const document = useMobileDocument({ userId, storyId: activeStoryId });
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [storyPanelOpen, setStoryPanelOpen] = useState(false);
  const [pendingStoryId, setPendingStoryId] = useState<number | null>(null);
  const [resolvingSwitch, setResolvingSwitch] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  if (!story) return null;

  const requestStoryChange = (storyId: number) => {
    if (storyId === activeStoryId) return;
    if (!document.hasUnsavedChanges) {
      onStoryChange(storyId);
      return;
    }
    setPendingStoryId(storyId);
  };

  const finishSwitch = async (action: DirtyStorySwitchAction) => {
    if (resolvingSwitch) return;
    if (action === "cancel") {
      setPendingStoryId(null);
      setAnnouncement("已取消切换 Story");
      return;
    }
    setResolvingSwitch(true);
    const outcome = await resolveMobileDirtyStorySwitch(action, document);
    setResolvingSwitch(false);
    if (outcome === "switch" && pendingStoryId !== null) {
      const nextStoryId = pendingStoryId;
      setPendingStoryId(null);
      setAnnouncement(
        action === "save" ? "正文已保存，正在切换 Story" : "修改已放弃，正在切换 Story"
      );
      onStoryChange(nextStoryId);
      return;
    }
    setPendingStoryId(null);
    setAnnouncement("正文未能安全保存，已留在当前 Story");
  };

  return (
    <MobileWorkspaceFrame
      activeView={activeView}
      onViewChange={onViewChange}
      storyTitle={story.title}
      balanceSlot={
        <ComputeBalanceBadge
          compact
          className="shrink-0"
          enabled={Boolean(user?.id)}
        />
      }
      element={element}
      onOpenStories={() => setStoryPanelOpen(true)}
      onOpenAccount={() => setAccountOpen(true)}
      documentView={
        <MobileDocumentView
          controller={document}
          storyTitle={story.title}
          suppressConflictDialog={pendingStoryId !== null}
        />
      }
      waitingForReply={
        conversation.isSubmitting ||
        conversation.recoveryTurns.some(turn => turn.status === "replying")
      }
      chatView={({ dense }) => (
        <MobileChatView
          controller={conversation}
          element={element}
          storyTitle={story.title}
          dense={dense}
        />
      )}
      overlays={
        <>
          <MobileDailyLetter
            autoOpen
            open={letterOpen}
            stories={stories}
            onOpenChange={setLetterOpen}
            onOpenStory={requestStoryChange}
          />

          <MobileStoryPanel
            activeStoryId={activeStoryId}
            creating={creatingStory}
            open={storyPanelOpen}
            stories={stories}
            onCreateStory={
              onCreateStory
                ? () => {
                    setStoryPanelOpen(false);
                    onCreateStory();
                  }
                : undefined
            }
            onOpenChange={setStoryPanelOpen}
            onSelectStory={storyId => {
              setStoryPanelOpen(false);
              // 有未保存的正文时 requestStoryChange 会先弹「保存/放弃/取消」，
              // 那张对话框得在面板关掉之后才看得见，所以顺序不能反。
              requestStoryChange(storyId);
            }}
          />

          <Dialog open={accountOpen} onOpenChange={setAccountOpen}>
            <DialogContent className="max-w-[calc(100%-1.5rem)] p-5 sm:max-w-sm">
              <DialogHeader className="text-left">
                <DialogTitle>我</DialogTitle>
                <DialogDescription>{user?.email ?? "未登录"}</DialogDescription>
              </DialogHeader>
              <ComputeBalanceBadge enabled={Boolean(user?.id)} />
              <p className="text-sm leading-6 text-muted-foreground">
                手机上负责聊和改字。新建 Story、素材、分镜和成片留在电脑上。
              </p>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 w-full justify-start"
                onClick={() => {
                  setAccountOpen(false);
                  setLetterOpen(true);
                }}
              >
                <MailOpen aria-hidden="true" />
                今天的来信
              </Button>
              <DialogFooter className="flex-row justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAccountOpen(false)}
                >
                  返回
                </Button>
                <Button type="button" variant="ghost" onClick={() => void logout()}>
                  退出登录
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={pendingStoryId !== null}
            onOpenChange={open => {
              if (!open && !resolvingSwitch) void finishSwitch("cancel");
            }}
          >
            <DialogContent
              showCloseButton={false}
              className="max-w-[calc(100%-1.5rem)] p-5 sm:max-w-md"
              onOpenAutoFocus={event => {
                event.preventDefault();
                cancelRef.current?.focus();
              }}
            >
              <DialogHeader className="text-left">
                <DialogTitle>切换 Story 前处理正文</DialogTitle>
                <DialogDescription>
                  当前正文还有未保存的修改。请选择保存、放弃修改，或留在这里继续编辑。
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2 sm:grid sm:grid-cols-3">
                <Button
                  ref={cancelRef}
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={resolvingSwitch}
                  onClick={() => void finishSwitch("cancel")}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="min-h-11"
                  disabled={resolvingSwitch}
                  onClick={() => void finishSwitch("discard")}
                >
                  放弃修改
                </Button>
                <Button
                  type="button"
                  className="min-h-11"
                  disabled={resolvingSwitch || !document.canSave}
                  onClick={() => void finishSwitch("save")}
                >
                  {resolvingSwitch ? (
                    <Loader2 aria-hidden="true" className="animate-spin" />
                  ) : null}
                  保存正文
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <p className="sr-only" role="status" aria-live="polite">
            {announcement}
          </p>
        </>
      }
    />
  );
}

export function MobileWorkspace({ userId }: { userId: number }) {
  const storyListQuery = trpc.storyAgent.storyList.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [activeStoryId, setActiveStoryId] = useState<number | null>(null);
  const [activeView, setActiveView] = useState<MobileWorkspaceView>("document");
  const coldEntryResolvedRef = useRef(false);
  const stories = (storyListQuery.data?.stories ?? []) as MobileStorySummary[];

  useEffect(() => {
    if (!storyListQuery.data || coldEntryResolvedRef.current) return;
    coldEntryResolvedRef.current = true;
    setActiveStoryId(resolveMobileInitialStoryId(storyListQuery.data.stories));
  }, [storyListQuery.data]);

  /**
   * 手机上直接新建故事。
   * storyAgent.storyUpsert 不带 id 就是插入，本来就是 protectedProcedure，
   * 不需要为手机端另开端点 —— 建完把列表拉一次，再把新故事设为当前。
   */
  const storyUpsert = trpc.storyAgent.storyUpsert.useMutation();
  const [createError, setCreateError] = useState<string | null>(null);

  const createStory = async () => {
    if (storyUpsert.isPending) return;
    setCreateError(null);
    try {
      const created = await storyUpsert.mutateAsync({ title: "新的故事" });
      const newId = created?.id ?? null;
      await storyListQuery.refetch();
      if (newId !== null) setActiveStoryId(newId);
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "新建失败，请重试"
      );
    }
  };

  if (storyListQuery.isError) {
    return (
      <MobileWorkspaceFrame
        activeView={activeView}
        onViewChange={setActiveView}
      >
        <MobileStoryListError
          message={storyListQuery.error.message || "请检查网络后重试"}
          onRetry={() => void storyListQuery.refetch()}
        />
      </MobileWorkspaceFrame>
    );
  }

  if (!storyListQuery.data) {
    return (
      <MobileWorkspaceFrame
        activeView={activeView}
        onViewChange={setActiveView}
      >
        <MobileWorkspaceLoading label="正在读取 Story…" />
      </MobileWorkspaceFrame>
    );
  }

  if (stories.length === 0) {
    return (
      <MobileWorkspaceFrame
        activeView={activeView}
        onViewChange={setActiveView}
      >
        <MobileEmptyState
          creating={storyUpsert.isPending}
          error={createError}
          onCreateStory={() => void createStory()}
        />
      </MobileWorkspaceFrame>
    );
  }

  if (activeStoryId === null) {
    return (
      <MobileWorkspaceFrame
        activeView={activeView}
        onViewChange={setActiveView}
      >
        <MobileWorkspaceLoading label="正在打开最近的 Story…" />
      </MobileWorkspaceFrame>
    );
  }

  return (
    <MobileSelectedStoryWorkspace
      key={`${userId}:${activeStoryId}`}
      activeStoryId={activeStoryId}
      activeView={activeView}
      stories={stories}
      userId={userId}
      onCreateStory={() => void createStory()}
      creatingStory={storyUpsert.isPending}
      onStoryChange={setActiveStoryId}
      onViewChange={setActiveView}
    />
  );
}
