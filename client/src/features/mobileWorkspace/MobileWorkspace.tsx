import { StoryActivityTracker } from "@/features/memorySpace/StoryActivityTracker";
import {
  UiLanguageProvider,
  useUiText,
} from "@/features/uiLanguage/UiLanguage";
import { BookOpenText, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  type CSSProperties,
  type ReactNode,
  default as React,
  useEffect,
  useContext,
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
import type { VisualThemeMode } from "@/features/nayin/visualTheme";
import { resolveRecentStoryEntry } from "@/features/storyAgent/recentStoryEntry";
import { trpc } from "@/lib/trpc";
import { useShareBackNotices } from "@/features/sharing/useShareBackNotices";
import { cn } from "@/lib/utils";
import { ComputeBalanceBadge } from "@/features/computeAccount/ComputeBalanceBadge";
import { LiaoliaoMascot, LiaoliaoThinkingDots } from "./LiaoliaoMascot";
import { MobileArchiveSheet } from "./MobileArchiveSheet";
import { MobileMePage } from "./MobileMePage";
import { MobileStoriesPage } from "./MobileStoriesPage";
import { MobileContentLibrary } from "./MobileContentLibrary";
import {
  MobileStoryWorkspace,
  type MobileStoryStage,
} from "./MobileStoryWorkspace";
import { type MobilePage } from "./liaoliaoForms";
import { MobileChatView, mobileChatPeekReply } from "./MobileChatView";
import { MobileDailyLetter } from "./MobileDailyLetter";
import { type MobileStorySummary } from "./MobileStoryPanel";
import { useMobileConversation } from "./useMobileConversation";
import { useMobileDocument } from "./useMobileDocument";
import {
  MobileMemoryFollowup,
  storyFollowupSource,
  type MemoryFollowupSource,
} from "./mobileMemoryFollowup";
import { MobileCompanionActivity } from "./mobileCompanionActivity";
import { MobileNewStoryCompanion } from "./MobileNewStoryCompanion";

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

const SHEET_PEEK_PX = 140;

/**
 * 正在写正文时，聊天面板缩到只剩抬头这一条。
 *
 * 真机上（安卓 + 微信内置浏览器）键盘一起来，常驻输入条加话语框把正文压掉
 * 200 多像素——连正文自己的「保存正文」状态条都被盖住。写字的时候正文最大。
 *
 * 但不是整块藏掉：小杯子留在这条上，还看得见、还能点，点一下就回到聊天。
 */
const SHEET_HANDLE_PX = 66;

/**
 * 折叠档露出一条回信时先留的高度（还没量到真实高度时的起步值）。
 *
 * 128px 只够「抬头 + 输入条」。把回信也塞进去而不加高，输入框就会被顶出
 * 屏幕——真机上就是这样：能看到回信，却没法打字了。
 *
 * 72 = 两行正文（约 52px）+ 上下内距和外距。话语框量出真实高度后，
 * 这个值会被 peekReplyHeight 顶掉。
 */
const SHEET_REPLY_PEEK_PX = 72;

/**
 * 话语框最多占多高。
 *
 * 长回答要在收起档读完（不能逼用户展开整个聊天），但收起档还得让正文露着，
 * 否则「收起」就名不副实。所以给一个上限，超出的部分在框内滚。
 * 0.32 是提案值，等真机体验确认。
 */
export function peekReplyCap(shellHeight: number): number {
  return Math.min(260, Math.max(120, Math.round(shellHeight * 0.32)));
}

function sheetStopHeight(stop: SheetStop, shellHeight: number): number {
  if (stop === "peek") return SHEET_PEEK_PX;
  return Math.round(shellHeight * (stop === "half" ? 0.5 : 0.88));
}

export function MobileWorkspaceFrame({
  activeView,
  onViewChange,
  balanceSlot,
  documentView,
  chatView,
  /** 正在等回信——抬头那只小人会动起来并冒出三个点。 */
  waitingForReply = false,
  /** 折叠档正在露一条回信——面板要相应留高，否则输入框会被挤出屏幕。 */
  hasPeekReply = false,
  documentEditing = false,
  children,
  overlays,
  page = "chat",
  pageView,
  element = "metal",
  visualTheme = "shiguang",
  chatOnly = false,
  storyTitle,
}: {
  activeView: MobileWorkspaceView;
  onViewChange: (view: MobileWorkspaceView) => void;
  /** 顶栏右侧的算力余额。由调用方传，外壳不碰 tRPC。 */
  balanceSlot?: ReactNode;
  /** 正文常驻区；加载／空／错误态用 children 兜底 */
  documentView?: ReactNode;
  /** 有对话时才挂聊聊面板；空 Story 或读取失败时不挂 */
  /** 收到 stop 决定要不要紧凑显示，所以用函数而不是现成节点 */
  chatView?: (options: {
    dense: boolean;
    replyMaxHeight: number;
    onReplyHeightChange: (height: number) => void;
  }) => ReactNode;
  waitingForReply?: boolean;
  hasPeekReply?: boolean;
  /** 正文正在被编辑：聊天面板让位，缩到只剩小杯子那条抬头。 */
  documentEditing?: boolean;
  /** 没有 documentView 时的兜底内容（加载／空／错误态）。 */
  children?: ReactNode;
  /** 浮层：对话框、面板。永远渲染，不受 documentView 影响。 */
  overlays?: ReactNode;
  /** 当前在哪一页。只有 chat 页画正文和聊聊面板。 */
  page?: MobilePage;
  /** 非 chat 页的内容（故事页 / 我页）。 */
  pageView?: ReactNode;
  /** 当天的纳音五行。由调用方从 useNayin() 取好传进来，
      外壳本身不碰 context，才能脱离 NayinProvider 单测。 */
  element?: NayinElement;
  visualTheme?: VisualThemeMode;
  chatOnly?: boolean;
  storyTitle?: string;
}) {
  const t = useUiText();

  const shellRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ y: number; h: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  // 外壳高度必须存进 state：render 期间读 ref 首帧拿到 0，
  // 半屏/全屏会被算成 0 再回退到常驻档的高度。
  const [shellH, setShellH] = useState(0);
  // 话语框量出来的真实高度。0 = 还没量到，先用 SHEET_REPLY_PEEK_PX 起步。
  const [peekReplyH, setPeekReplyH] = useState(0);

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

  // 写正文时让位，只在折叠档发生——聊天本来就展开着的时候不算「在写正文」。
  const yieldingToDocument = documentEditing && stop === "peek";
  const replyCap = peekReplyCap(shellHeight());
  const reservedReply =
    hasPeekReply && !yieldingToDocument
      ? Math.min(peekReplyH || SHEET_REPLY_PEEK_PX, replyCap)
      : 0;
  const peekHeight = yieldingToDocument
    ? SHEET_HANDLE_PX
    : SHEET_PEEK_PX + reservedReply;
  const sheetHeight =
    dragHeight ??
    (stop === "peek"
      ? peekHeight
      : sheetStopHeight(stop, shellHeight()) || peekHeight);

  return (
    <div
      ref={shellRef}
      className="mobile-workspace-page"
      data-nav-style={visualTheme}
      style={{ "--mobile-viewport-height": "100dvh" } as CSSProperties}
    >
      <div className="relative mx-auto flex h-full w-full max-w-3xl flex-col overflow-hidden bg-background">
        {/* 聊聊拉开时把这行收掉，正文多露一截；收起面板它自己回来 */}
        {!chatOnly && (
          <header
            aria-hidden={page !== "chat" || activeView === "chat"}
            className={cn(
              "flex min-w-0 items-center gap-3 overflow-hidden px-4",
              "transition-[max-height,opacity,padding] duration-200 ease-out",
              page !== "chat" || activeView === "chat"
                ? "pointer-events-none max-h-0 pt-0 pb-0 opacity-0"
                : "max-h-16 pt-3 pb-1 opacity-100"
            )}
          >
            {/*
            品牌名和故事名都撤了：微信顶栏已经写着来处，故事名在「聊点其他的」
            那张菜单里看得到，正文页最该留给正文本身。顶栏只剩余额。
          */}
            <span className="min-w-0 flex-1" />
            {/* 钱在两块屏幕上都得一直看得见。由调用方传进来——外壳自己不碰
              tRPC，否则脱离 Provider 单渲（本文件的测试就是）会当场抛错，
              和 element 那个 prop 是同一个道理。 */}
            {balanceSlot}
          </header>
        )}

        {/* chat 页正文常驻；故事页和我页换成整页内容。 */}
        <div className="mobile-workspace-content min-h-0 flex-1 overflow-hidden pb-12">
          {page === "chat" ? (
            chatOnly && chatView ? (
              <section
                className="flex h-full min-h-0 flex-col"
                aria-label={t("聊天工作区")}
              >
                <header className="flex shrink-0 items-center gap-3 border-b border-border/50 px-4 py-2">
                  <LiaoliaoMascot
                    element={element}
                    visualTheme={visualTheme}
                    size={40}
                    thinking={waitingForReply}
                  />
                  <div className="min-w-0 flex-1">
                    <h1 className="truncate font-chat-brand text-lg">
                      {storyTitle || t("聊聊")}
                    </h1>
                    {waitingForReply && (
                      <span className="text-xs text-muted-foreground">
                        {t("正在想…")}
                      </span>
                    )}
                  </div>
                  {waitingForReply && <LiaoliaoThinkingDots />}
                </header>
                <div className="min-h-0 flex-1">
                  {chatView({
                    dense: false,
                    replyMaxHeight: replyCap,
                    onReplyHeightChange: setPeekReplyH,
                  })}
                </div>
              </section>
            ) : (
              (documentView ?? children)
            )
          ) : (
            pageView
          )}
        </div>

        {/* 聊聊：常驻输入条 / 半屏 / 全屏 */}
        {!chatOnly && chatView && page === "chat" && activeView === "chat" && (
          <button
            type="button"
            aria-label={t("收起聊聊")}
            // 不压暗：拉开面板正是为了同时读正文，压暗等于把要读的东西盖住。
            // 这层只用来「点空白处收起」。
            className="absolute inset-0 z-20"
            onClick={() => onViewChange("document")}
          />
        )}
        {!chatOnly && chatView && page === "chat" && (
          <div
            ref={sheetRef}
            className={cn(
              "absolute inset-x-0 z-30 flex flex-col rounded-t-[20px] bg-background",
              "shadow-[0_-10px_30px_-12px_rgba(76,60,20,0.3)]",
              dragRef.current ? "" : "transition-[height] duration-200 ease-out"
            )}
            style={{
              height: sheetHeight,
              bottom: "var(--mobile-nav-height)",
              maxHeight: "calc(100% - var(--mobile-nav-height))",
            }}
          >
            <div
              className="shrink-0 cursor-grab touch-none px-4 pt-2"
              onPointerDown={event => {
                if (
                  (event.target as HTMLElement).closest("[data-sheet-action]")
                )
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
                  sheetRef.current?.getBoundingClientRect().height ??
                    SHEET_PEEK_PX
                );
              }}
              onPointerCancel={() => {
                dragRef.current = null;
                setDragHeight(null);
              }}
            >
              <span className="mx-auto mb-1.5 block h-1 w-9 rounded-full bg-border" />
              <div className="flex min-h-11 items-center gap-2.5">
                {/*
                抬头这只就是「聊聊」本人，用的是用户认可的那版造型。
                等回信时让**它**动起来，而不是在下面另画一只——两只一模一样的
                上下排着，看起来像复制粘贴，也说不清楚哪只才是在等。
              */}
                <button
                  type="button"
                  data-sheet-action="character"
                  aria-label={
                    activeView === "document" ? t("展开聊天") : t("收起聊天")
                  }
                  className="-m-1 shrink-0 rounded-full p-1"
                  // 写正文时按下去不能夺走正文的焦点：一失焦面板就长回来，
                  // 抬头随之下移，手指落下时点到的已经不是杯子了。
                  onPointerDown={event => event.preventDefault()}
                  onClick={() =>
                    onViewChange(
                      activeView === "document" ? "chat" : "document"
                    )
                  }
                >
                  {/*
                  这版造型只有「安静」一个静态形象，没有「想着呢」那张脸，
                  所以思考反馈是身体的轻微起伏加旁边的三点，两者都跟着
                  waitingForReply 走——回答到达、失败或中断都会自己停。
                  缺的表情素材与补齐方案见交接文档。
                */}
                  <LiaoliaoMascot
                    element={element}
                    visualTheme={visualTheme}
                    size={44}
                    thinking={waitingForReply}
                  />
                </button>
                {/* 名字**始终**露着，不再只在展开档才出现 */}
                <span className="min-w-0">
                  <span className="block font-chat-brand text-[17px] leading-none text-primary">
                    {t("聊聊")}
                  </span>
                  <span className="mt-1 block text-[11px] leading-none text-muted-foreground">
                    {waitingForReply ? t("正在想…") : t("在这儿")}
                  </span>
                </span>
                {waitingForReply ? <LiaoliaoThinkingDots /> : null}
                <button
                  type="button"
                  data-sheet-action="toggle"
                  className="ml-auto min-h-11 shrink-0 px-1.5 text-xs text-muted-foreground"
                  onClick={() =>
                    onViewChange(
                      activeView === "document" ? "chat" : "document"
                    )
                  }
                >
                  {stop === "peek" ? t("展开聊天") : t("收起")}
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {yieldingToDocument
                ? null
                : chatView({
                    dense: stop === "peek",
                    replyMaxHeight: replyCap,
                    onReplyHeightChange: setPeekReplyH,
                  })}
            </div>
          </div>
        )}

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

export function MobileEmptyState({
  onCreateStory,
  onOpenImages,
  creating = false,
  error = null,
}: {
  onCreateStory?: () => void;
  onOpenImages?: () => void;
  creating?: boolean;
  error?: string | null;
}) {
  const t = useUiText();

  return (
    <div className="flex h-full flex-col items-center justify-center px-7 text-center">
      <BookOpenText aria-hidden="true" className="size-9 text-primary" />
      <h1 className="mt-4 text-lg font-semibold">{t("还没有故事")}</h1>
      <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
        {t("新建一个，就从这里开始聊。电脑上也能接着写同一个故事。")}
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
          {creating ? t("正在新建…") : t("新建一个故事")}
        </Button>
      ) : null}
      {onOpenImages && (
        <button
          className="mt-3 min-h-11 text-sm text-primary"
          onClick={onOpenImages}
        >
          {t("查看全部图片")}
        </button>
      )}
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
  const t = useUiText();

  return (
    <div className="flex h-full flex-col items-center justify-center px-7 text-center">
      <h1 className="text-lg font-semibold">{t("Story 暂时无法读取")}</h1>
      <p className="mt-2 max-w-sm text-sm leading-6 text-destructive">
        {message}
      </p>
      <Button
        type="button"
        variant="outline"
        className="mt-4"
        onClick={onRetry}
      >
        <RefreshCw aria-hidden="true" />
        {t("重试 Story 列表")}
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
  page,
  onNavigate,
  storyOpen,
  onStoryOpenChange,
  stage,
  onStageChange,
}: {
  userId: number;
  activeStoryId: number;
  stories: readonly MobileStorySummary[];
  activeView: MobileWorkspaceView;
  onViewChange: (view: MobileWorkspaceView) => void;
  onStoryChange: (storyId: number, stage?: MobileStoryStage) => void;
  onCreateStory?: () => void;
  page: MobilePage;
  onNavigate: (page: MobilePage) => void;
  storyOpen: boolean;
  onStoryOpenChange: (open: boolean) => void;
  stage: MobileStoryStage;
  onStageChange: (stage: MobileStoryStage) => void;
}) {
  const t = useUiText();

  const story = stories.find(candidate => candidate.id === activeStoryId);
  const { selectStory } = useContext(MobileMemoryFollowup);
  useEffect(() => {
    if (page !== "stories" || !storyOpen || !story) return;
    selectStory?.(storyFollowupSource(story.id, story.title));
    return () => selectStory?.(null);
  }, [selectStory, page, storyOpen, story?.id, story?.title]);
  const { element, visualTheme } = useNayin();
  const { user } = useAuth();
  const [letterOpen, setLetterOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const conversation = useMobileConversation({
    userId,
    storyId: activeStoryId,
  });
  const document = useMobileDocument({ userId, storyId: activeStoryId });
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [pendingStoryId, setPendingStoryId] = useState<number | null>(null);
  const [pendingStage, setPendingStage] = useState<MobileStoryStage>();
  const [resolvingSwitch, setResolvingSwitch] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const shareBackNotices = useShareBackNotices(userId);
  // 首次渲染时记下哪些是新的，这样小红点在本次浏览里一直可见。
  const [unreadShareBackIds, setUnreadShareBackIds] = useState<Set<string>>(
    () => new Set()
  );
  useEffect(() => {
    if (shareBackNotices.unread.length === 0) return;
    setUnreadShareBackIds(current => {
      const next = new Set(current);
      for (const notice of shareBackNotices.unread) next.add(notice.id);
      return next;
    });
  }, [shareBackNotices.unread]);

  if (!story) return null;

  const requestStoryChange = (
    storyId: number,
    targetStage?: MobileStoryStage
  ) => {
    if (storyId === activeStoryId) {
      if (targetStage) onStageChange(targetStage);
      onStoryOpenChange(true);
      onNavigate("stories");
      return;
    }
    if (!document.hasUnsavedChanges) {
      onStoryChange(storyId, targetStage);
      return;
    }
    setPendingStoryId(storyId);
    setPendingStage(targetStage);
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
        action === "save"
          ? "正文已保存，正在切换 Story"
          : "修改已放弃，正在切换 Story"
      );
      if (nextStoryId === -1) onCreateStory?.();
      else onStoryChange(nextStoryId, pendingStage);
      return;
    }
    setPendingStoryId(null);
    onStageChange("text");
    onStoryOpenChange(true);
    onNavigate("stories");
    setAnnouncement("正文未能安全保存，已留在当前 Story");
  };

  return (
    <div style={{ display: "contents" }} data-story-activity={activeStoryId}>
    <StoryActivityTracker storyId={activeStoryId} userId={userId} enabled={page === "chat" || (page === "stories" && storyOpen)} />
    <MobileWorkspaceFrame
      chatOnly
      storyTitle={story.title}
      activeView={activeView}
      onViewChange={onViewChange}
      balanceSlot={
        <ComputeBalanceBadge
          compact
          className="shrink-0"
          enabled={Boolean(user?.id)}
        />
      }
      element={element}
      visualTheme={visualTheme}
      page={page}
      pageView={
        page === "stories" ? (
          storyOpen ? (
            <MobileStoryWorkspace
              userId={userId}
              storyId={activeStoryId}
              title={story.title}
              stage={stage}
              motionStyle={visualTheme === "shiguang" ? "shiguang" : element}
              onStageChange={onStageChange}
              onBack={() => onStoryOpenChange(false)}
              document={document}
              conversation={conversation}
            />
          ) : (
            <MobileStoriesPage
              visualTheme={visualTheme}
              activeStoryId={activeStoryId}
              stories={stories}
              onOpenStage={stage => {
                onStageChange(stage);
                onStoryOpenChange(true);
              }}
              onOpenMe={() => onNavigate("me")}
              onSelectStory={(storyId, targetStage) => {
                requestStoryChange(storyId, targetStage);
              }}
              shareBacks={shareBackNotices.notices}
              unreadShareBackIds={unreadShareBackIds}
              onShareBacksSeen={shareBackNotices.markSeen}
            />
          )
        ) : page === "me" ? (
          <MobileMePage
            onBack={() => {
              onStoryOpenChange(false);
              onNavigate("stories");
            }}
            onOpenLetter={() => {
              setLetterOpen(true);
            }}
          />
        ) : null
      }
      waitingForReply={
        conversation.isSubmitting ||
        conversation.recoveryTurns.some(turn => turn.status === "replying")
      }
      hasPeekReply={mobileChatPeekReply(conversation) !== null}
      chatView={({ dense, replyMaxHeight, onReplyHeightChange }) => (
        <MobileChatView
          controller={conversation}
          draftValue={chatDraft}
          onDraftChange={setChatDraft}
          storyTitle={story.title}
          dense={dense}
          replyMaxHeight={replyMaxHeight}
          onArchive={() => setArchiveOpen(true)}
          onReplyHeightChange={onReplyHeightChange}
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

          <MobileArchiveSheet
            activeStoryId={activeStoryId}
            open={archiveOpen}
            sourceBody={document.state?.body ?? null}
            stories={stories}
            onOpenChange={setArchiveOpen}
          />

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
                <DialogTitle>{t("切换 Story 前处理正文")}</DialogTitle>
                <DialogDescription>
                  {t(
                    "当前正文还有未保存的修改。请选择保存、放弃修改，或留在这里继续编辑。"
                  )}
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
                  {t("取消")}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="min-h-11"
                  disabled={resolvingSwitch}
                  onClick={() => void finishSwitch("discard")}
                >
                  {t("放弃修改")}
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
                  {t("保存正文")}
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
    </div>
  );
}

export function MobileWorkspace({ userId }: { userId: number }) {
  return (
    <UiLanguageProvider>
      <MobileWorkspaceScoped key={userId} userId={userId} />
    </UiLanguageProvider>
  );
}
function MobileWorkspaceScoped({ userId }: { userId: number }) {
  const [idleAnimations, setIdleAnimations] = useState(false);
  const [memorySource, setMemorySource] = useState<MemoryFollowupSource | null>(
    null
  );
  const [moduleSource, setModuleSource] = useState<MemoryFollowupSource | null>(
    null
  );
  const [storySource, setStorySource] = useState<MemoryFollowupSource | null>(
    null
  );
  return (
    <MobileMemoryFollowup.Provider
      value={{
        source: memorySource,
        select: setMemorySource,
        moduleSource,
        selectModule: setModuleSource,
        storySource,
        selectStory: setStorySource,
      }}
    >
      <MobileCompanionActivity.Provider value={setIdleAnimations}>
        <MobileWorkspaceContent userId={userId} />
        <MobileNewStoryCompanion
          key={userId}
          userId={userId}
          idleAnimations={idleAnimations}
        />
      </MobileCompanionActivity.Provider>
    </MobileMemoryFollowup.Provider>
  );
}

function MobileWorkspaceContent({ userId }: { userId: number }) {
  const t = useUiText();

  const storyListQuery = trpc.storyAgent.storyList.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [activeStoryId, setActiveStoryId] = useState<number | null>(null);
  const [activeView, setActiveView] = useState<MobileWorkspaceView>("document");
  const [page, setPage] = useState<MobilePage>("stories");
  const [storyOpen, setStoryOpen] = useState(false);
  const [emptyImagesOpen, setEmptyImagesOpen] = useState(false);
  const [stages, setStages] = useState<Record<number, MobileStoryStage>>({});
  const coldEntryResolvedRef = useRef(false);
  const stories = (storyListQuery.data?.stories ?? []) as MobileStorySummary[];

  async function openStory(storyId: number, targetStage?: MobileStoryStage) {
    // 图库可能已读到另一台设备新建的故事，而首页列表仍是旧缓存。
    if (!stories.some(story => story.id === storyId)) {
      const fresh = await storyListQuery.refetch();
      if (!fresh.data?.stories.some(story => story.id === storyId)) {
        toast.error(t("暂时无法打开这个故事，请刷新后重试。"));
        return;
      }
    }
    if (targetStage)
      setStages(current => ({ ...current, [storyId]: targetStage }));
    setActiveStoryId(storyId);
    setStoryOpen(true);
    setPage("stories");
  }

  useEffect(() => {
    if (!storyListQuery.data || coldEntryResolvedRef.current) return;
    coldEntryResolvedRef.current = true;
    const requested = Number(
      new URLSearchParams(window.location.search).get("storyId")
    );
    if (
      Number.isSafeInteger(requested) &&
      requested > 0 &&
      storyListQuery.data.stories.some(story => story.id === requested)
    ) {
      setActiveStoryId(requested);
      setStoryOpen(true);
      setStages(current => ({ ...current, [requested]: "text" }));
    } else
      setActiveStoryId(
        resolveMobileInitialStoryId(storyListQuery.data.stories)
      );
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
      if (newId !== null) {
        setActiveStoryId(newId);
        setStoryOpen(true);
        setPage("stories");
      }
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
          message={storyListQuery.error.message || t("请检查网络后重试")}
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
        <MobileWorkspaceLoading label={t("正在读取 Story…")} />
      </MobileWorkspaceFrame>
    );
  }

  if (stories.length === 0) {
    return (
      <MobileWorkspaceFrame
        activeView={activeView}
        onViewChange={setActiveView}
      >
        {emptyImagesOpen ? (
          <MobileContentLibrary
            stage="image"
            stories={[]}
            onBack={() => setEmptyImagesOpen(false)}
            onOpenStory={storyId => void openStory(storyId, "image")}
          />
        ) : (
          <MobileEmptyState
            creating={storyUpsert.isPending}
            error={createError}
            onCreateStory={() => void createStory()}
            onOpenImages={() => setEmptyImagesOpen(true)}
          />
        )}
      </MobileWorkspaceFrame>
    );
  }

  if (activeStoryId === null) {
    return (
      <MobileWorkspaceFrame
        activeView={activeView}
        onViewChange={setActiveView}
      >
        <MobileWorkspaceLoading label={t("正在打开最近的 Story…")} />
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
      page={page}
      storyOpen={storyOpen}
      onStoryOpenChange={setStoryOpen}
      stage={stages[activeStoryId] ?? "text"}
      onStageChange={stage =>
        setStages(current => ({ ...current, [activeStoryId]: stage }))
      }
      onNavigate={setPage}
      onStoryChange={(storyId, targetStage) =>
        void openStory(storyId, targetStage)
      }
      onViewChange={setActiveView}
    />
  );
}
