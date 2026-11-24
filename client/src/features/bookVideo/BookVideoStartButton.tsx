import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUiText as useDesktopUiText } from "@/features/uiLanguage/UiLanguage";
import { Clapperboard } from "lucide-react";
import { useLocation } from "wouter";
import { requestNewVersion } from "@/features/publishingDraft/newVersionRequest";
import { STUDIO_CREATE_EVENT, type StudioCreateRequest } from "@/features/publishingDraft/StudioCreateMenu";
import { useDesktopWritingSession } from "@/features/writingCompanion/desktopWritingSession";

/** Review an existing storyboard, or start a new adaptation from the manuscript. */
export function BookVideoStartButton({ storyId, disabled = false }: { storyId: number | null; disabled?: boolean }) {
  const _ui = useDesktopUiText();
  const [location] = useLocation();
  const [reviewStory, setReviewStory] = useState<number | null>(null);
  const lookup = trpc.chapters.list.useQuery({ storyId: storyId ?? 0, kind: "storyboard" }, {
    enabled: Boolean(storyId && storyId > 0 && reviewStory === storyId),
  });
  const storyboard = lookup.data?.find(chapter => chapter.blocks.body.trim());
  const openReview = (id: number, chapterId: number) => {
    setReviewStory(null);
    window.dispatchEvent(new CustomEvent<StudioCreateRequest>(STUDIO_CREATE_EVENT, { detail: {
      id: crypto.randomUUID(), storyId: id, kind: "video", instruction: "", storyboardChapterId: chapterId,
    } }));
  };
  // This entry is handled by EditingStudioPage; the mobile workspace owns its own chat flow.
  if (location === "/m" || location.startsWith("/m/")) return null;
  return <><button type="button" disabled={disabled || !storyId || storyId <= 0}
    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[var(--nayin-accent)] px-5 py-2 text-sm font-semibold text-[var(--background)] shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)] focus-visible:ring-offset-2 disabled:opacity-40"
    onClick={() => {
      if (!storyId || storyId <= 0) return;
      const session = useDesktopWritingSession.getState().session;
      const snapshot = session?.storyId === storyId ? session.getSnapshot() : undefined;
      const chapterId = Number(snapshot?.scope?.match(/:chapter:(\d+)/)?.[1]);
      if (snapshot?.manuscriptKind === "storyboard" && chapterId) {
        openReview(storyId, chapterId);
        return;
      }
      setReviewStory(storyId);
    }}>
    <Clapperboard className="h-4 w-4" aria-hidden="true" />{_ui("把书做成视频")}</button>
    <Dialog open={Boolean(storyId && reviewStory === storyId)} onOpenChange={open => { if (!open) setReviewStory(null); }}>
      <DialogContent><DialogHeader><DialogTitle>{_ui("从书稿开始做视频")}</DialogTitle>
        <DialogDescription>{_ui("分镜决定每一镜拍什么、放多久。图片、台词和音乐会在放入视频前列出来，请你确认。")}</DialogDescription></DialogHeader>
        {lookup.isLoading ? <p role="status">{_ui("正在查看这本书的分镜…")}</p> : <>
          {lookup.isError ? <div>
            <p role="status">{_ui("暂时无法读取已有分镜，可以重试或从当前文字开始。")}</p>
            <button className="rounded border p-2" onClick={() => void lookup.refetch()}>{_ui("重新读取分镜")}</button>
          </div> : storyboard && <button className="rounded border p-2" onClick={() => {
            if (storyId) openReview(storyId, storyboard.id);
          }}>{_ui("沿用已有分镜，先看素材")}</button>}
          <button className="rounded border p-2" onClick={() => {
            if (!storyId) return;
            setReviewStory(null);
            requestNewVersion({ storyId, presentation: "film" });
          }}>{_ui("按当前文字准备新分镜")}</button>
        </>}
      </DialogContent>
    </Dialog></>;
}
