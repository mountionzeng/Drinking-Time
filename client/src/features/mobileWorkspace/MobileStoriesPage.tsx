import { Plus } from "lucide-react";
import React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { mobileStoryMeta, type MobileStorySummary } from "./MobileStoryPanel";

function storyExcerpt(story: MobileStorySummary): string {
  const text = story.logline?.trim() || story.summary?.trim() || "";
  return text || "还没有摘要。";
}

export function MobileStoriesPage({
  stories,
  activeStoryId,
  creating = false,
  onCreateStory,
  onSelectStory,
  onOpenStage,
}: {
  stories: readonly MobileStorySummary[];
  activeStoryId: number | null;
  creating?: boolean;
  onCreateStory?: () => void;
  onSelectStory: (storyId: number) => void;
  onOpenStage: (stage: "memory" | "text") => void;
}) {
  const current = stories.find(story => story.id === activeStoryId) ?? null;
  const others = stories.filter(story => story.id !== activeStoryId);

  return (
    <section
      aria-label="故事"
      className="h-full overflow-y-auto px-5 pb-6 pt-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-chat-brand text-[28px] leading-none text-foreground">
          故事
        </h1>
        {onCreateStory ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-11 rounded-xl"
            disabled={creating}
            onClick={onCreateStory}
          >
            <Plus aria-hidden="true" />
            {creating ? "正在新建…" : "新故事"}
          </Button>
        ) : null}
      </div>
      <p className="mt-2 text-sm leading-7 text-muted-foreground">
        把聊过的，慢慢写成故事。
      </p>

      {current ? (
        <article className="mt-5 rounded-2xl border border-border/70 bg-background/70 p-5">
          <div className="text-[11px] tracking-[0.07em] text-muted-foreground">
            正在继续
          </div>
          <h2 className="mt-2 font-chat-brand text-[24px] leading-tight text-foreground">
            {current.title}
          </h2>
          <p className="mt-3 text-sm leading-7 text-foreground/90">
            {storyExcerpt(current)}
          </p>
          <div className="mt-3 text-xs text-muted-foreground">
            {mobileStoryMeta(current)}
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <Button
              type="button"
              className="min-h-11 rounded-xl"
              onClick={() => onOpenStage("memory")}
            >
              查看记忆 →
            </Button>
            <button
              type="button"
              className="min-h-11 px-1 text-sm text-muted-foreground"
              onClick={() => onOpenStage("text")}
            >
              查看文字稿 ›
            </button>
          </div>
        </article>
      ) : (
        <p className="mt-6 text-sm leading-7 text-muted-foreground">
          还没有正在继续的故事。
        </p>
      )}

      <div className="mt-7 text-[11px] tracking-[0.07em] text-muted-foreground">
        以前的故事
      </div>
      {others.length === 0 ? (
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          以前的故事会出现在这里。
        </p>
      ) : (
        <ul className="mt-1">
          {others.map(story => (
            <li key={story.id}>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center justify-between gap-4 border-b border-border/70 py-4 text-left",
                  "min-h-14"
                )}
                onClick={() => onSelectStory(story.id)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-chat-brand text-[17px] text-foreground">
                    {story.title}
                  </span>
                  <span className="mt-1.5 block truncate text-xs leading-6 text-muted-foreground">
                    {storyExcerpt(story)}
                  </span>
                  <span className="block text-xs leading-6 text-muted-foreground">
                    {mobileStoryMeta(story)}
                  </span>
                </span>
                <span aria-hidden="true" className="text-muted-foreground">
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
