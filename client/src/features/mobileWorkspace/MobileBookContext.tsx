import { useContext, useEffect } from "react";
import { useDesktopWritingSession } from "@/features/writingCompanion/desktopWritingSession";
import { layoutModuleDescription, layoutModuleLabel } from "@shared/layoutModuleContext";
import { MobileMemoryFollowup, type MemoryFollowupSource } from "./mobileMemoryFollowup";
import type { DesktopWritingSession } from "@/features/writingCompanion/desktopWritingSession";

export function mobileBookSource(session: DesktopWritingSession | null, userId: number, storyId: number): MemoryFollowupSource | null {
  const module = session?.snapshot.module;
  if (!session || session.storyId !== storyId || !module || module.storyId !== storyId || !module.scope.startsWith(`${userId}:${storyId}:chapter:`)) return null;
  return { storyId, id: `book:${module.scope}:${module.moduleId}`, kind: "layout", origin: "note", title: layoutModuleLabel(module), content: layoutModuleDescription(module), module };
}

/** Selection follows the shared book editor; it never writes or generates content. */
export function MobileBookContext({ userId, storyId }: { userId: number; storyId: number }) {
  const session = useDesktopWritingSession(state => state.session);
  const { selectModule } = useContext(MobileMemoryFollowup);
  useEffect(() => {
    selectModule?.(mobileBookSource(session, userId, storyId));
    return () => selectModule?.(null);
  }, [session, userId, storyId, selectModule]);
  return null;
}
