import { useUiLanguage, useUiText } from "@/features/uiLanguage/UiLanguage";
import React, { useState, useContext, useEffect } from "react";
import { MobileCompanionActivity } from "./mobileCompanionActivity";
import {
  MobileContentLibrary,
  type MobileLibraryStage,
} from "./MobileContentLibrary";
import {
  openMobileCompanion,
  storyFollowupSource,
} from "./mobileMemoryFollowup";
import type { MobileStoryStage } from "./MobileStoryWorkspace";
import { MobileNavBar } from "./MobileNavBar";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { mobileStoryMeta, type MobileStorySummary } from "./MobileStoryPanel";
import type { ShareBackNotice } from "@shared/shareBackInbox";
import { shareBackLabel } from "@/features/sharing/useShareBackNotices";

function storyExcerpt(story: MobileStorySummary): string {
  const text = story.logline?.trim() || story.summary?.trim() || "";
  return text;
}

export function MobileStoriesPage({
  stories,
  activeStoryId,
  onOpenMe,
  onSelectStory,
  onOpenStage,
  visualTheme = "shiguang",
  shareBacks = [],
  unreadShareBackIds,
  onShareBacksSeen,
}: {
  visualTheme?: "shiguang" | "nayin";
  /** 朋友分享回来、还没采用/忽略的版本。 */
  shareBacks?: readonly ShareBackNotice[];
  unreadShareBackIds?: ReadonlySet<string>;
  /** 卡片出现在屏幕上就记成已看过。 */
  onShareBacksSeen?: () => void;
  stories: readonly MobileStorySummary[];
  activeStoryId: number | null;
  onOpenMe: () => void;
  onSelectStory: (storyId: number, stage?: MobileStoryStage) => void;
  onOpenStage: (stage: MobileStoryStage) => void;
}) {
  const t = useUiText();
  const { language } = useUiLanguage();

  const [library, setLibrary] = useState<MobileLibraryStage | null>(null);
  const setCompanionActive = useContext(MobileCompanionActivity);
  useEffect(() => {
    setCompanionActive(library === null);
    return () => setCompanionActive(false);
  }, [library, setCompanionActive]);
  const unreadCount = unreadShareBackIds?.size ?? 0;
  useEffect(() => {
    if (!library && unreadCount > 0) onShareBacksSeen?.();
  }, [library, unreadCount, onShareBacksSeen]);
  if (library)
    return (
      <MobileContentLibrary
        key={library}
        stage={library}
        stories={stories}
        onBack={() => setLibrary(null)}
        onOpenStory={id =>
          onSelectStory(id, library === "memory" ? "text" : library)
        }
      />
    );
  const current = stories.find(story => story.id === activeStoryId) ?? null;
  const others = stories.filter(story => story.id !== activeStoryId);

  return (
    <section
      aria-label={t("故事")}
      className="h-full overflow-y-auto px-5 pb-6 pt-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h1
          className={cn(
            "mobile-brand-logo font-chat-brand leading-none text-primary transition-colors duration-300 motion-reduce:transition-none",
            visualTheme === "shiguang" ? "pt-1.5 text-[62px]" : "text-[42px]"
          )}
        >
          {visualTheme === "shiguang" ? "拾光" : "Drinking Time"}
        </h1>
        <MobileNavBar current="stories" onNavigate={onOpenMe} />
      </div>
      <nav
        aria-label={t("全部内容")}
        className="mt-1 flex justify-between gap-2"
      >
        {(
          [
            ["memory", t("回忆")],
            ["text", t("文字")],
            ["image", t("图片")],
            ["video", t("视频")],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="min-h-11 font-chat-brand text-lg text-muted-foreground transition-colors hover:text-primary"
            onClick={() => setLibrary(id)}
          >
            {label}
            <span aria-hidden="true" className="ml-1 text-xs">
              ↗
            </span>
          </button>
        ))}
      </nav>

      {shareBacks.length > 0 ? (
        <section
          aria-label={t("朋友分享回来的")}
          className="mt-5 rounded-2xl border border-primary/30 bg-primary/5 p-4"
        >
          <div className="text-[11px] tracking-[0.07em] text-muted-foreground">
            {t("朋友分享回来的")}
          </div>
          <ul className="mt-1">
            {shareBacks.slice(0, 3).map(notice => (
              <li key={notice.id}>
                <button
                  type="button"
                  className="flex min-h-12 w-full items-center justify-between gap-3 py-2 text-left"
                  onClick={() => onSelectStory(notice.storyId)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-[15px] text-foreground">
                      {unreadShareBackIds?.has(notice.id) ? (
                        <span
                          data-share-back-unread
                          role="img"
                          aria-label={t("新")}
                          className="h-2 w-2 shrink-0 rounded-full bg-[#d9534f]"
                        />
                      ) : null}
                      {shareBackLabel(notice)}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {notice.storyTitle} · {t("打开看看，采用或忽略")}
                    </span>
                  </span>
                  <span aria-hidden="true" className="text-muted-foreground">
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {current ? (
        <article className="mt-5 rounded-2xl border border-border/70 bg-background/70 p-5">
          <div className="text-[11px] tracking-[0.07em] text-muted-foreground">
            {t("正在继续")}
          </div>
          <h2 className="mt-2 font-chat-brand text-[24px] leading-tight text-foreground">
            {current.title}
          </h2>
          <p className="mt-3 text-sm leading-7 text-foreground/90">
            {storyExcerpt(current) || t("还没有摘要。")}
          </p>
          <div className="mt-3 text-xs text-muted-foreground">
            {mobileStoryMeta(current, language)}
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <Button
              type="button"
              className="min-h-11 rounded-xl"
              onClick={() =>
                openMobileCompanion(
                  storyFollowupSource(current.id, current.title)
                )
              }
            >
              {t("继续对话 →")}
            </Button>
            <button
              type="button"
              className="min-h-11 px-1 text-sm text-muted-foreground"
              onClick={() => onOpenStage("text")}
            >
              {t("查看文字稿 ›")}
            </button>
          </div>
        </article>
      ) : (
        <p className="mt-6 text-sm leading-7 text-muted-foreground">
          {t("还没有正在继续的故事。")}
        </p>
      )}

      <div className="mt-7 text-[11px] tracking-[0.07em] text-muted-foreground">
        {t("以前的故事")}
      </div>
      {others.length === 0 ? (
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          {t("以前的故事会出现在这里。")}
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
                    {storyExcerpt(story) || t("还没有摘要。")}
                  </span>
                  <span className="block text-xs leading-6 text-muted-foreground">
                    {mobileStoryMeta(story, language)}
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
