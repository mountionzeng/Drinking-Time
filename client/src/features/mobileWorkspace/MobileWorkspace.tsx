import { BookOpenText, Loader2, MessageCircle, RefreshCw } from "lucide-react";
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
import { resolveRecentStoryEntry } from "@/features/storyAgent/recentStoryEntry";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { MobileChatView } from "./MobileChatView";
import { MobileDocumentView } from "./MobileDocumentView";
import {
  MobileStoryPicker,
  type MobileStorySummary,
} from "./MobileStoryPicker";
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

export function MobileWorkspaceFrame({
  activeView,
  onViewChange,
  storyPicker,
  children,
}: {
  activeView: MobileWorkspaceView;
  onViewChange: (view: MobileWorkspaceView) => void;
  storyPicker: ReactNode;
  children: ReactNode;
}) {
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const updateHeight = () => {
      shellRef.current?.style.setProperty(
        "--mobile-viewport-height",
        `${viewport.height}px`
      );
    };
    updateHeight();
    viewport.addEventListener("resize", updateHeight);
    viewport.addEventListener("scroll", updateHeight);
    return () => {
      viewport.removeEventListener("resize", updateHeight);
      viewport.removeEventListener("scroll", updateHeight);
    };
  }, []);

  return (
    <div
      ref={shellRef}
      className="mobile-workspace-page"
      style={{ "--mobile-viewport-height": "100dvh" } as CSSProperties}
    >
      <div className="mx-auto grid h-full w-full max-w-3xl grid-rows-[auto_auto_minmax(0,1fr)] bg-background/75 shadow-[0_0_44px_-32px_rgba(0,0,0,0.5)] backdrop-blur-sm">
        <header className="flex min-w-0 items-center gap-3 border-b border-border/65 px-3 py-2.5">
          <span
            aria-label="拾光 AI 手机工作区"
            className="font-chat-brand shrink-0 text-xl leading-none text-foreground"
          >
            拾光
          </span>
          {storyPicker}
        </header>

        <nav
          aria-label="手机工作区"
          className="grid grid-cols-2 border-b border-border/65 bg-background/78 px-3"
          role="tablist"
        >
          <button
            id="mobile-workspace-tab-chat"
            type="button"
            role="tab"
            aria-controls="mobile-workspace-panel"
            aria-selected={activeView === "chat"}
            className={cn(
              "relative flex min-h-12 items-center justify-center gap-2 px-3 text-sm font-semibold outline-none transition focus-visible:z-10 focus-visible:ring-3 focus-visible:ring-ring/30",
              activeView === "chat"
                ? "text-foreground after:absolute after:inset-x-5 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => onViewChange("chat")}
          >
            <MessageCircle aria-hidden="true" className="size-4" />
            聊聊
          </button>
          <button
            id="mobile-workspace-tab-document"
            type="button"
            role="tab"
            aria-controls="mobile-workspace-panel"
            aria-selected={activeView === "document"}
            className={cn(
              "relative flex min-h-12 items-center justify-center gap-2 px-3 text-sm font-semibold outline-none transition focus-visible:z-10 focus-visible:ring-3 focus-visible:ring-ring/30",
              activeView === "document"
                ? "text-foreground after:absolute after:inset-x-5 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => onViewChange("document")}
          >
            <BookOpenText aria-hidden="true" className="size-4" />
            正文
          </button>
        </nav>

        <main
          id="mobile-workspace-panel"
          role="tabpanel"
          aria-labelledby={
            activeView === "chat"
              ? "mobile-workspace-tab-chat"
              : "mobile-workspace-tab-document"
          }
          className="min-h-0 overflow-hidden"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

export function MobileEmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-7 text-center">
      <BookOpenText aria-hidden="true" className="size-9 text-primary" />
      <h1 className="mt-4 text-lg font-semibold">请先在电脑上创建 Story</h1>
      <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
        手机端会打开你已有的 Story。创建完成后，回到这里刷新即可继续聊天和正文。
      </p>
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
}: {
  userId: number;
  activeStoryId: number;
  stories: readonly MobileStorySummary[];
  activeView: MobileWorkspaceView;
  onViewChange: (view: MobileWorkspaceView) => void;
  onStoryChange: (storyId: number) => void;
}) {
  const story = stories.find(candidate => candidate.id === activeStoryId);
  const conversation = useMobileConversation({ userId, storyId: activeStoryId });
  const document = useMobileDocument({ userId, storyId: activeStoryId });
  const pickerRef = useRef<HTMLSelectElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
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

  const picker = (
    <MobileStoryPicker
      ref={pickerRef}
      activeStoryId={activeStoryId}
      disabled={resolvingSwitch}
      stories={stories}
      onRequestStoryChange={requestStoryChange}
    />
  );

  return (
    <MobileWorkspaceFrame
      activeView={activeView}
      onViewChange={onViewChange}
      storyPicker={picker}
    >
      {activeView === "chat" ? (
        <MobileChatView controller={conversation} storyTitle={story.title} />
      ) : (
        <MobileDocumentView
          controller={document}
          storyTitle={story.title}
          suppressConflictDialog={pendingStoryId !== null}
        />
      )}

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
          onCloseAutoFocus={event => {
            event.preventDefault();
            pickerRef.current?.focus();
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
    </MobileWorkspaceFrame>
  );
}

export function MobileWorkspace({ userId }: { userId: number }) {
  const storyListQuery = trpc.storyAgent.storyList.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [activeStoryId, setActiveStoryId] = useState<number | null>(null);
  const [activeView, setActiveView] = useState<MobileWorkspaceView>("chat");
  const coldEntryResolvedRef = useRef(false);
  const stories = (storyListQuery.data?.stories ?? []) as MobileStorySummary[];

  useEffect(() => {
    if (!storyListQuery.data || coldEntryResolvedRef.current) return;
    coldEntryResolvedRef.current = true;
    setActiveStoryId(resolveMobileInitialStoryId(storyListQuery.data.stories));
  }, [storyListQuery.data]);

  const emptyPicker = <div aria-hidden="true" className="h-11 min-w-0 flex-1" />;

  if (storyListQuery.isError) {
    return (
      <MobileWorkspaceFrame
        activeView={activeView}
        onViewChange={setActiveView}
        storyPicker={emptyPicker}
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
        storyPicker={emptyPicker}
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
        storyPicker={emptyPicker}
      >
        <MobileEmptyState />
      </MobileWorkspaceFrame>
    );
  }

  if (activeStoryId === null) {
    return (
      <MobileWorkspaceFrame
        activeView={activeView}
        onViewChange={setActiveView}
        storyPicker={emptyPicker}
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
      onStoryChange={setActiveStoryId}
      onViewChange={setActiveView}
    />
  );
}
