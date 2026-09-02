import { ChevronDown } from "lucide-react";
import React, { forwardRef } from "react";

export type MobileStorySummary = {
  id: number;
  title: string;
  shotCount?: number;
};

type MobileStoryPickerProps = {
  stories: readonly MobileStorySummary[];
  activeStoryId: number;
  disabled: boolean;
  onRequestStoryChange: (storyId: number) => void;
};

export const MobileStoryPicker = forwardRef<
  HTMLSelectElement,
  MobileStoryPickerProps
>(function MobileStoryPicker(
  { stories, activeStoryId, disabled, onRequestStoryChange },
  ref
) {
  return (
    <div className="relative min-w-0 flex-1">
      <select
        ref={ref}
        aria-label="选择 Story"
        className="h-11 w-full appearance-none truncate rounded-xl border border-border/80 bg-background/85 py-2 pr-10 pl-3 text-[15px] font-semibold text-foreground shadow-sm outline-none transition focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-wait disabled:opacity-60"
        disabled={disabled}
        value={activeStoryId}
        onChange={event => onRequestStoryChange(Number(event.target.value))}
      >
        {stories.map(story => (
          <option key={story.id} value={story.id}>
            {story.title.trim() || `Story ${story.id}`}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
});
