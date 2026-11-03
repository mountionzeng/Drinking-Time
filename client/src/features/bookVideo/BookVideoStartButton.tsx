import { useUiText as useDesktopUiText } from "@/features/uiLanguage/UiLanguage";
import { Clapperboard } from "lucide-react";
import { useLocation } from "wouter";
import { STUDIO_CREATE_EVENT, type StudioCreateRequest } from "@/features/publishingDraft/StudioCreateMenu";

/** Both workspaces open the existing book-video conversation, without submitting a render. */
export function BookVideoStartButton({ storyId, disabled = false }: { storyId: number | null; disabled?: boolean }) {
  const _ui = useDesktopUiText();
  const [location] = useLocation();
  // This entry is handled by EditingStudioPage; the mobile workspace owns its own chat flow.
  if (location === "/m" || location.startsWith("/m/")) return null;
  return <button type="button" disabled={disabled || !storyId || storyId <= 0}
    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[var(--nayin-accent)] px-5 py-2 text-sm font-semibold text-[var(--background)] shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)] focus-visible:ring-offset-2 disabled:opacity-40"
    onClick={() => {
      if (!storyId || storyId <= 0) return;
      window.dispatchEvent(new CustomEvent<StudioCreateRequest>(STUDIO_CREATE_EVENT, {
        detail: { id: crypto.randomUUID(), storyId, kind: "video", instruction: "" },
      }));
    }}>
    <Clapperboard className="h-4 w-4" aria-hidden="true" />{_ui("把书做成视频")}</button>;
}
