import { useUiText as useDesktopUiText } from "@/features/uiLanguage/UiLanguage";
import { Clapperboard } from "lucide-react";
import { useLocation } from "wouter";
import { requestNewVersion } from "@/features/publishingDraft/newVersionRequest";
import { STUDIO_CREATE_EVENT, type StudioCreateRequest } from "@/features/publishingDraft/StudioCreateMenu";
import { useDesktopWritingSession } from "@/features/writingCompanion/desktopWritingSession";

/** Current storyboards go straight to the table; text manuscripts first open adaptation. */
export function BookVideoStartButton({ storyId, disabled = false }: { storyId: number | null; disabled?: boolean }) {
  const _ui = useDesktopUiText();
  const [location] = useLocation();
  // This entry is handled by EditingStudioPage; the mobile workspace owns its own chat flow.
  if (location === "/m" || location.startsWith("/m/")) return null;
  return <button type="button" disabled={disabled || !storyId || storyId <= 0}
    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[var(--nayin-accent)] px-5 py-2 text-sm font-semibold text-[var(--background)] shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)] focus-visible:ring-offset-2 disabled:opacity-40"
    onClick={() => {
      if (!storyId || storyId <= 0) return;
      const session = useDesktopWritingSession.getState().session;
      const snapshot = session?.storyId === storyId ? session.getSnapshot() : undefined;
      const chapterId = Number(snapshot?.scope?.match(/:chapter:(\d+)/)?.[1]);
      if (snapshot?.manuscriptKind === "storyboard" && chapterId) {
        window.dispatchEvent(new CustomEvent<StudioCreateRequest>(STUDIO_CREATE_EVENT, { detail: {
          id: crypto.randomUUID(), storyId, kind: "video", instruction: "", storyboardChapterId: chapterId,
        } }));
        return;
      }
      requestNewVersion({ storyId, presentation: "film" });
    }}>
    <Clapperboard className="h-4 w-4" aria-hidden="true" />{_ui("把书做成视频")}</button>;
}
