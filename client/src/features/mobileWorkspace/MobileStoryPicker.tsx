import { ChevronDown } from "lucide-react";
import React, { forwardRef } from "react";

export type MobileStorySummary = {
  id: number;
  title: string;
  shotCount?: number;
};

/** 「新建故事」那一项的哨兵值。数字 id 永远不会等于它。 */
export const MOBILE_NEW_STORY_VALUE = "new";

type MobileStoryPickerProps = {
  stories: readonly MobileStorySummary[];
  activeStoryId: number;
  disabled: boolean;
  onRequestStoryChange: (storyId: number) => void;
  /** 给了才显示「新建故事」这一项。 */
  onCreateStory?: () => void;
};

export const MobileStoryPicker = forwardRef<
  HTMLSelectElement,
  MobileStoryPickerProps
>(function MobileStoryPicker(
  { stories, activeStoryId, disabled, onRequestStoryChange, onCreateStory },
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
        onChange={event => {
          if (event.target.value === MOBILE_NEW_STORY_VALUE) {
            // 先把选中项拨回当前 Story：新建是个动作，不是一个可停留的选项。
            event.target.value = String(activeStoryId);
            onCreateStory?.();
            return;
          }
          onRequestStoryChange(Number(event.target.value));
        }}
      >
        {stories.map(story => (
          <option key={story.id} value={story.id}>
            {story.title.trim() || `Story ${story.id}`}
          </option>
        ))}
        {onCreateStory ? (
          <option value={MOBILE_NEW_STORY_VALUE}>＋ 新建故事</option>
        ) : null}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
});
