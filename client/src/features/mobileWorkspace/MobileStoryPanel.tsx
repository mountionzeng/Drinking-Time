/**
 * MobileStoryPanel — 手机上的故事面板，顶掉原来 header 里那个 <select>。
 *
 * 结构照搬电脑端 StoryLogoMenu 的信息层级（那套已经用熟了，不另发明一种）：
 * 「开启新故事」在上，是这里唯一的动作；分隔线；然后「回到以前的故事」，
 * 它只是个标题，不可点。
 *
 * 和电脑端的两处不同，都是被手机的处境逼出来的：
 *
 * 1. 电脑端只列最近三条，底部留一个「查看全部故事 →」跳去完整列表。手机端
 *    没有那个「完整列表」页可跳，所以这里直接把全部故事列出来、面板自己滚。
 *    留一个跳不到任何地方的入口比不留更糟。
 * 2. 电脑端用 hover 展开，行高 44px 就够；这里全部按触摸目标给到 56px 起。
 *
 * 为什么不复用 StoryLogoMenu 本体：它的展开/收起绑在那颗 Logo 的 hover 与
 * 指针能力分流上，而这里的触发点是底部 tab 栏，两者的生命周期完全不同。
 * 共用的是信息结构，不是那段交互。
 */
import { Plus } from "lucide-react";
import React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatStoryTimestamp } from "@/features/storyAgent/storyTimestamp";
import { cn } from "@/lib/utils";

export type MobileStorySummary = {
  id: number;
  title: string;
  logline?: string | null;
  summary?: string | null;
  updatedAt?: string | Date | null;
  createdAt?: string | Date | null;
  shotCount?: number;
  cardCount?: number;
  /** 这个故事在哪些日子被动过。每日来信靠它挑出「那天也聊过的故事」。 */
  activityDates?: string[];
};

/** 「2 小时前 · 0 个镜头」。卡片数常年是 0，只会占位，所以不放。 */
export function mobileStoryMeta(story: MobileStorySummary): string {
  const when = formatStoryTimestamp(story.updatedAt ?? story.createdAt);
  const shots =
    typeof story.shotCount === "number" ? `${story.shotCount} 个镜头` : "";
  return [when, shots].filter(Boolean).join(" · ");
}

export function MobileStoryPanel({
  open,
  onOpenChange,
  stories,
  activeStoryId,
  creating = false,
  error = null,
  onCreateStory,
  onSelectStory,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stories: readonly MobileStorySummary[];
  activeStoryId: number | null;
  creating?: boolean;
  error?: string | null;
  onCreateStory?: () => void;
  onSelectStory: (storyId: number) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-1.5rem)] gap-0 p-0 sm:max-w-sm">
        <DialogHeader className="sr-only">
          <DialogTitle>故事</DialogTitle>
          <DialogDescription>开启新故事，或回到以前的故事</DialogDescription>
        </DialogHeader>

        {onCreateStory ? (
          <button
            type="button"
            className="flex h-14 w-full items-center gap-2.5 px-4 text-left text-[15px] font-medium text-foreground transition-colors hover:bg-muted/60 disabled:opacity-60"
            disabled={creating}
            onClick={() => onCreateStory()}
          >
            <span
              aria-hidden="true"
              className="grid size-[22px] shrink-0 place-items-center rounded-full border-[1.5px] border-primary text-primary"
            >
              <Plus className="size-3.5" />
            </span>
            {creating ? "正在新建…" : "开启新故事"}
          </button>
        ) : null}

        {error ? (
          <p className="px-4 pb-2 text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mx-1 h-px bg-border" />

        <div className="px-4 pb-1.5 pt-2.5 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
          回到以前的故事
        </div>

        {stories.length === 0 ? (
          <p className="px-4 pb-4 pt-1 text-xs text-muted-foreground">
            还没有故事，先开一个吧
          </p>
        ) : (
          <ul className="max-h-[52vh] overflow-y-auto overscroll-contain pb-2">
            {stories.map(story => {
              const excerpt = story.logline?.trim() || story.summary?.trim();
              const current = story.id === activeStoryId;
              return (
                <li key={story.id}>
                  <button
                    type="button"
                    aria-current={current ? "true" : undefined}
                    className={cn(
                      "flex min-h-14 w-full flex-col gap-[3px] px-4 py-2.5 text-left transition-colors hover:bg-muted/60",
                      current && "bg-muted/40"
                    )}
                    onClick={() => onSelectStory(story.id)}
                  >
                    <span className="text-[15px] font-medium leading-[1.35] text-foreground">
                      {story.title?.trim() || "未命名故事"}
                    </span>
                    {excerpt ? (
                      <span className="w-full truncate text-xs leading-[1.4] text-muted-foreground">
                        {excerpt}
                      </span>
                    ) : null}
                    <span className="font-mono text-[11px] text-muted-foreground/80">
                      {mobileStoryMeta(story) || "还没动过"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
