import { useEffect } from "react";
import { storySpineStore } from "./spine/storySpine";

/** Close an active editor when its story is moved to trash from another surface. */
export function useStoryTrashEvents(
  clearCurrentStory: () => void,
  setActiveStoryId: (id: number | null) => void,
  refreshStoryList: () => Promise<unknown>
) {
  useEffect(() => {
    const onStoryTrashed = (event: Event) => {
      const id = (event as CustomEvent<{ storyId: number }>).detail?.storyId;
      if (storySpineStore.getState().activeStoryId === id) {
        storySpineStore.getState().beginStoryLoad();
        clearCurrentStory();
        setActiveStoryId(null);
      }
      void refreshStoryList();
    };
    const onStoryRestored = () => { void refreshStoryList(); };
    window.addEventListener("dt:story-trashed", onStoryTrashed);
    window.addEventListener("dt:story-restored", onStoryRestored);
    return () => {
      window.removeEventListener("dt:story-trashed", onStoryTrashed);
      window.removeEventListener("dt:story-restored", onStoryRestored);
    };
  }, [clearCurrentStory, refreshStoryList, setActiveStoryId]);
}
