import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { useCreationEditor } from "@/features/creationEditor/CreationEditorContext";
import { browserStoryViewStorage, readStoryView, saveStoryView, type VideoView } from "@/pages/storyWorkspacePreference";

type VideoWorkspace = {
  host: HTMLDivElement | null;
  setHost: (host: HTMLDivElement | null) => void;
  view: VideoView;
  setView: (view: VideoView) => void;
  reviewRequested: boolean;
  openReview: () => void;
  showEditing: () => void;
  discuss: () => void;
};

const Context = createContext<VideoWorkspace | null>(null);
export const useBookVideoWorkspace = () => useContext(Context);

/** Only the presentation moves. BookVideoChat remains the single owner of the review draft. */
export function BookVideoWorkspaceProvider({
  storyId,
  userId,
  onOpen,
  onDiscuss,
  children,
}: {
  storyId: number | null;
  userId?: number | null;
  onOpen: () => void;
  onDiscuss: () => void;
  children: ReactNode;
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [view, updateView] = useState<VideoView>(readStoryView(browserStoryViewStorage(), userId, storyId, "video") ?? "plan");
  const [reviewRequested, setReviewRequested] = useState(false);
  const setView = useCallback((next: VideoView) => {
    setReviewRequested(false);
    updateView(next);
    saveStoryView(browserStoryViewStorage(), userId, storyId, "video", next);
  }, [userId, storyId]);
  const openReview = useCallback(() => {
    setReviewRequested(true);
    updateView("plan");
    saveStoryView(browserStoryViewStorage(), userId, storyId, "video", "plan");
    onOpen();
  }, [onOpen, userId, storyId]);
  const showEditing = useCallback(() => {
    setView("editing");
    onOpen();
  }, [onOpen, setView]);
  useEffect(() => {
    const focus = (event: Event) => {
      const detail = (event as CustomEvent<{ storyId: number; target: string }>)
        .detail;
      if (detail?.storyId === storyId && detail.target === "editing")
        setView("editing");
    };
    window.addEventListener("dt:creation-flow-focus", focus);
    return () => window.removeEventListener("dt:creation-flow-focus", focus);
  }, [storyId, setView]);
  const value = useMemo(
    () => ({
      host,
      setHost,
      view,
      setView,
      reviewRequested,
      openReview,
      showEditing,
      discuss: onDiscuss,
    }),
    [host, view, setView, reviewRequested, openReview, showEditing, onDiscuss]
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function BookVideoWorkspace({
  active,
  toolbar,
  editor,
  preferEditing = false,
}: {
  active: boolean;
  toolbar: ReactNode;
  editor: (
    presentation: "manuscript" | "editing",
    suspended: boolean
  ) => ReactNode;
  preferEditing?: boolean;
}) {
  const _ui = useUiText();
  const workspace = useBookVideoWorkspace()!;
  const { shots } = useCreationEditor();
  const showingReview =
    workspace.view === "plan" &&
    (workspace.reviewRequested || shots.length === 0);
  useEffect(() => {
    if (preferEditing) workspace.setView("editing");
  }, [preferEditing, workspace.setView]);
  return (
    <div
      hidden={!active}
      className="h-full"
      id="editing-nle-workspace"
      data-story-panel="editing-nle"
      aria-label={_ui("视频")}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-2">
          <div
            className="inline-flex shrink-0 gap-1 rounded-md bg-muted/40 p-0.5"
            aria-label={_ui("视频工作区视图")}
          >
            {(
              [
                ["plan", "分镜稿"],
                ["editing", "剪辑与预览"],
              ] as const
            ).map(([view, label]) => (
              <button
                key={view}
                type="button"
                aria-pressed={workspace.view === view}
                onClick={() => workspace.setView(view)}
                className={`rounded px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)] ${workspace.view === view ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                {_ui(label)}
              </button>
            ))}
            {showingReview && (
              <span className="self-center px-2 text-xs text-muted-foreground">
                {_ui("待核对方案")}
              </span>
            )}
          </div>
          <div
            className="flex min-w-0 flex-wrap items-start justify-end gap-3"
            aria-label={_ui("视频导出操作")}
          >
            {toolbar}
          </div>
        </div>
        {/* Keep this target mounted while reading the book or editing: unsaved review text stays in one session. */}
        <div hidden={!showingReview} className="min-h-0 flex-1 overflow-hidden">
          <div
            ref={workspace.setHost}
            className="h-full min-h-0"
            data-testid="video-storyboard-manuscript"
          />
        </div>
        {active && (
          <div
            hidden={showingReview}
            className="relative min-h-0 flex-1 overflow-hidden"
          >
            {editor(
              workspace.view === "plan" ? "manuscript" : "editing",
              showingReview
            )}
          </div>
        )}
      </div>
    </div>
  );
}
