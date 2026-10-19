import { createContext } from "react";
import type { StoryLogoMenuProps } from "./StoryLogoMenu";

/** Reuse the studio's story routing and unsaved-work safeguards in the composer. */
export const DesktopStoryMenuContext = createContext<Pick<StoryLogoMenuProps,
  "stories" | "onNewStory" | "onOpenStory" | "onBrowseAll"
> | null>(null);
