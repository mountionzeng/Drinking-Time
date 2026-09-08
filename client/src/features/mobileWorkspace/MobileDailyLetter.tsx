/**
 * MobileDailyLetter — 每日来信的手机版。
 *
 * 电脑端那份（DailyLetterWelcome，1000 多行）里，一大半是「还没建档」「访客
 * 试用」「把访客档案导入账号」这三条入口流程。手机工作区在登录之后才存在，
 * 访客那两条根本走不到；建档是一次性动作，这一版先不搬（见下面 NoProfile）。
 *
 * 所以这里搬的是**信本身**，顺序和电脑端一字不差：
 *   抬头（问候 / 某天的回信） → 翻哪一天 → 当天气息 → 那天你这样说
 *   → 那天也聊过的故事 → 聊会儿的回信 → 再读一遍
 *
 * 顺序不能改：这封信是按「先看见今天，再看见自己说的话，最后才读到回应」
 * 写的，把回信提到前面，它就变成一条推送而不是一封信。
 *
 * 格式化函数从 dailyLetterFormat 共用，不照抄——同一封信在两端的日期写法、
 * 时区和分段必须完全一致。
 */
import { CalendarDays, Check, Loader2, RefreshCw, X } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/_core/hooks/useAuth";
import {
  normalizeEmotionAnalysisProfile,
  normalizeEmotionDailyLetter,
} from "@/features/analysis/emotionAnalysis";
import {
  dailyLetterDateLabel,
  dailyLetterParagraphs,
  dailyLetterTimestampLabel,
} from "@/features/analysis/dailyLetterFormat";
import {
  dailyLetterGreeting,
  dailyLetterSeenKey,
  nextDailyLetterDate,
  shouldShowDailyLetter,
  storiesForDailyLetter,
  type DailyLetterStorySummary,
} from "@/features/analysis/views/DailyLetterWelcome";
import { useDailyAlmanac } from "@/features/nayin/hooks/useDailyAlmanac";
import { useNayin } from "@/features/nayin/NayinContext";
import DailyAtmospherePanel from "@/features/nayin/views/DailyAtmospherePanel";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

function readSeenDate(userId: number): string | null {
  try {
    return window.localStorage.getItem(dailyLetterSeenKey(userId));
  } catch {
    return null;
  }
}

function writeSeenDate(userId: number, date: string): void {
  try {
    window.localStorage.setItem(dailyLetterSeenKey(userId), date);
  } catch {
    // 隐私模式下写不进去：那就每次打开都迎面给一封，比整个功能不可用好。
  }
}

/** 「再读一遍」是有副作用的重算，用一次性 id 防止手抖点两次算两遍。 */
function newActionId(): string {
  return `mobile-reread-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-chat-brand text-lg font-normal text-foreground">
      {children}
    </h2>
  );
}

export function MobileDailyLetter({
  open,
  onOpenChange,
  autoOpen = false,
  stories = [],
  onOpenStory,
}: {
  /** 手动打开（「我」里那个入口）。 */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * 当天第一次进来时自动迎上去，和电脑端同一条规则、同一个 localStorage 键。
   * 每日来信的意义就在这个「迎面」上——退化成一个要自己去点的入口，
   * 它就只是一篇存档了。
   */
  autoOpen?: boolean;
  stories?: readonly DailyLetterStorySummary[];
  onOpenStory?: (storyId: number) => void;
}) {
  const { user } = useAuth();
  const { today } = useNayin();
  const almanacQuery = useDailyAlmanac(today.cstDateStr);
  const utils = trpc.useUtils();

  // 查询的开关必须把 autoOpen 也算进来。
  //
  // 原来写的是 `enabled: open && ...`：而「今天该不该自动迎上去」要先拿到
  // profile 的日期才判断得出来——查询被 open 挡住，profile 永远是空，
  // autoVisible 永远是 false，于是来信一次都不会自己出现。先有鸡还是先有蛋。
  const active = open || autoOpen;
  const profileQuery = trpc.emotionAnalysis.getProfile.useQuery(undefined, {
    enabled: active && Boolean(user?.id),
    retry: false,
  });
  const lettersQuery = trpc.emotionAnalysis.listDailyLetters.useQuery(
    { limit: 90 },
    {
      enabled: active && Boolean(user?.id) && profileQuery.isSuccess,
      retry: false,
    }
  );
  const rewriteMut = trpc.emotionAnalysis.rewriteDailyLetter.useMutation();
  const rereadMut = trpc.emotionAnalysis.rereadDailyLetter.useMutation();

  const [selectedDate, setSelectedDate] = useState("");
  const [editingMessage, setEditingMessage] = useState(false);
  const [messageDraft, setMessageDraft] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [closedDate, setClosedDate] = useState<string | null>(null);
  const lastProfileDateRef = useRef("");
  const rereadActionIdRef = useRef<string | null>(null);

  // 接口给的是原始行，字段类型是 unknown。电脑端一律先过 normalize 再用，
  // 这里照做——绕过去用类型断言只会把问题推到运行时。
  const letters = useMemo(
    () =>
      (lettersQuery.data ?? [])
        .map(normalizeEmotionDailyLetter)
        .filter(item => item !== null),
    [lettersQuery.data]
  );
  const profile = useMemo(
    () => normalizeEmotionAnalysisProfile(profileQuery.data, "server"),
    [profileQuery.data]
  );
  const profileDate = profile?.dailyReference.todayDate ?? "";
  const letterDates = useMemo(
    () =>
      Array.from(
        new Set(
          [profileDate, ...letters.map(item => item.letterDate)].filter(Boolean)
        )
      ).sort((a, b) => b.localeCompare(a)),
    [letters, profileDate]
  );

  // 选中哪一天：默认今天；今天翻篇了就跟着换过去。复用电脑端那条规则函数，
  // 免得两端在「昨天读到一半、今天再打开」这种边角上表现不一样。
  useEffect(() => {
    if (!profileDate) return;
    const previous = lastProfileDateRef.current;
    const next = nextDailyLetterDate(
      selectedDate,
      profileDate,
      previous,
      letterDates
    );
    if (previous !== profileDate) {
      lastProfileDateRef.current = profileDate;
      setEditingMessage(false);
    }
    if (next !== selectedDate) setSelectedDate(next);
  }, [letterDates, profileDate, selectedDate]);

  const selectedLetter =
    letters.find(item => item.letterDate === selectedDate) ?? null;
  const selectedReference =
    selectedLetter?.dailyReference ??
    (selectedDate === profileDate ? profile?.dailyReference : null);
  const selectedMessage =
    selectedLetter?.userMessage ??
    (selectedDate === profileDate
      ? (profile?.analysisSeed?.userMessage ?? "")
      : "");
  const saidAt =
    selectedLetter?.userMessageSaidAt ??
    (selectedMessage && selectedDate === profileDate
      ? (profile?.savedAt ?? null)
      : null);
  const editedAt = selectedLetter?.userMessageEditedAt ?? null;
  const relatedStories = storiesForDailyLetter(stories, selectedDate);
  const isToday = selectedDate === profileDate;

  const beginEditing = () => {
    setMessageDraft(selectedMessage ?? "");
    setActionError(null);
    setEditingMessage(true);
  };

  const saveMessage = async () => {
    if (!selectedDate || !selectedLetter || rewriteMut.isPending) return;
    setActionError(null);
    try {
      await rewriteMut.mutateAsync({
        letterDate: selectedDate,
        userMessage: messageDraft.trim(),
        expectedRevision: selectedLetter.revision,
      });
      await utils.emotionAnalysis.listDailyLetters.invalidate();
      setEditingMessage(false);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "没能记下这句，待会儿再试"
      );
    }
  };

  const rereadLetter = async () => {
    if (!selectedDate || !selectedLetter || rereadMut.isPending) return;
    setActionError(null);
    // 重试沿用同一个 actionId：重算是有代价的，同一次「再读」不该算两遍。
    rereadActionIdRef.current ??= newActionId();
    try {
      await rereadMut.mutateAsync({
        letterDate: selectedDate,
        expectedRevision: selectedLetter.revision,
        actionId: rereadActionIdRef.current,
      });
      rereadActionIdRef.current = null;
      await utils.emotionAnalysis.listDailyLetters.invalidate();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "没能重新读，待会儿再试"
      );
    }
  };

  const seenDate = user?.id ? readSeenDate(user.id) : null;
  const autoVisible =
    autoOpen &&
    Boolean(profile) &&
    shouldShowDailyLetter(profileDate, seenDate, closedDate);
  const visible = open || autoVisible;

  const closeLetter = () => {
    // 只有「今天那封」才算读过；翻旧信不该把今天的记成已读。
    if (user?.id && profileDate) writeSeenDate(user.id, profileDate);
    setClosedDate(profileDate);
    onOpenChange(false);
  };

  if (!visible) return null;

  const loading = profileQuery.isLoading || lettersQuery.isLoading;
  const messageChanged = messageDraft.trim() !== (selectedMessage ?? "").trim();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="你的每日回信"
      className="mobile-workspace-page fixed inset-0 z-[100] overflow-y-auto overscroll-contain bg-background"
    >
      <div className="mx-auto w-full max-w-2xl px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <header
          className="flex items-start justify-between gap-4 border-b pb-4"
          style={{ borderColor: "var(--nayin-border)" }}
        >
          <div className="min-w-0">
            <p className="text-[10px] text-muted-foreground">
              {selectedDate}
              {selectedReference?.lunarLabel
                ? ` · ${selectedReference.lunarLabel}`
                : ""}
            </p>
            <h1 className="font-chat-brand mt-1.5 text-2xl font-normal text-foreground">
              {isToday
                ? dailyLetterGreeting(new Date().getHours())
                : `${dailyLetterDateLabel(selectedDate)}的回信`}
            </h1>
          </div>
          <button
            type="button"
            aria-label="收起回信"
            className="-mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground"
            onClick={closeLetter}
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        {loading ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            正在把信取出来…
          </p>
        ) : !profile ? (
          // 建档是一次性动作，这一版没搬到手机上。说清楚去哪儿做，
          // 而不是给一个转不动的空界面。
          <div className="py-14 text-center">
            <p className="text-sm leading-7 text-foreground">
              还没有建立你的八字档案，所以还写不出来信。
            </p>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">
              这一步目前还得在电脑上做一次，之后手机上就能一直读了。
            </p>
          </div>
        ) : (
          <>
            <div
              className="flex items-center gap-3 border-b py-3"
              style={{ borderColor: "var(--nayin-border)" }}
            >
              <CalendarDays
                aria-hidden="true"
                className="size-4 shrink-0 text-nayin"
              />
              <label
                htmlFor="mobile-letter-date"
                className="shrink-0 text-xs text-muted-foreground"
              >
                想翻回哪一天
              </label>
              <select
                id="mobile-letter-date"
                value={selectedDate}
                disabled={rewriteMut.isPending}
                className="min-h-11 min-w-0 flex-1 bg-transparent text-sm font-medium text-foreground outline-none disabled:cursor-wait disabled:opacity-60"
                onChange={event => {
                  setSelectedDate(event.target.value);
                  setEditingMessage(false);
                  setActionError(null);
                }}
              >
                {letterDates.map(date => (
                  <option key={date} value={date}>
                    {date === profileDate ? `今天 · ${date}` : date}
                  </option>
                ))}
              </select>
              {lettersQuery.isFetching ? (
                <Loader2
                  aria-hidden="true"
                  className="size-3.5 animate-spin text-muted-foreground"
                />
              ) : null}
            </div>

            <DailyAtmospherePanel
              today={today}
              almanac={almanacQuery.data}
              loading={almanacQuery.isLoading}
              embedded
              compact
              personalizedYi={selectedReference?.personalizedYi}
              personalizedJi={selectedReference?.personalizedJi}
            />

            <section
              aria-label="你在这天说的话"
              className="border-b py-5"
              style={{ borderColor: "var(--nayin-border)" }}
            >
              <div className="flex items-center justify-between gap-3">
                <SectionTitle>那天，你这样说</SectionTitle>
                {editingMessage ? null : (
                  <button
                    type="button"
                    disabled={!selectedLetter || lettersQuery.isFetching}
                    className="min-h-11 px-2 text-xs text-muted-foreground transition disabled:opacity-50"
                    onClick={beginEditing}
                  >
                    {!selectedLetter ? "整理中" : selectedMessage ? "修改" : "写一点"}
                  </button>
                )}
              </div>

              {editingMessage ? (
                <div className="mt-2">
                  <textarea
                    autoFocus
                    maxLength={800}
                    rows={5}
                    value={messageDraft}
                    placeholder="今天发生了什么，或者你现在是什么感受？"
                    className="w-full resize-none border-0 bg-transparent p-0 text-[15px] leading-8 text-foreground outline-none placeholder:text-muted-foreground/55"
                    onChange={event => setMessageDraft(event.target.value)}
                  />
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={!messageChanged || rewriteMut.isPending}
                      className="inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-xs font-medium text-white transition disabled:opacity-50"
                      style={{ background: "var(--nayin-accent)" }}
                      onClick={() => void saveMessage()}
                    >
                      {rewriteMut.isPending ? (
                        <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                      ) : (
                        <Check aria-hidden="true" className="size-3.5" />
                      )}
                      记下这句
                    </button>
                    <button
                      type="button"
                      className="min-h-11 px-2 text-xs text-muted-foreground"
                      onClick={() => setEditingMessage(false)}
                    >
                      先放着
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="mt-2 text-[15px] leading-8 text-foreground">
                    {selectedMessage ||
                      "这一天还没有写下新话，所以来信不会翻出以前的具体事情。"}
                  </p>
                  {saidAt || editedAt ? (
                    <p className="mt-1 text-[9px] text-muted-foreground/65">
                      {saidAt ? `说于 ${dailyLetterTimestampLabel(saidAt)}` : ""}
                      {saidAt && editedAt ? " · " : ""}
                      {editedAt ? `改于 ${dailyLetterTimestampLabel(editedAt)}` : ""}
                    </p>
                  ) : null}
                </>
              )}
              <p className="mt-3 text-[10px] leading-5 text-muted-foreground/70">
                只有你今天写下新话时，聊会儿才会在确有关系的地方参考以前的文字。
              </p>
            </section>

            {relatedStories.length > 0 && onOpenStory ? (
              <section
                aria-label="这天聊过的故事"
                className="border-b py-5"
                style={{ borderColor: "var(--nayin-border)" }}
              >
                <SectionTitle>那天，也聊过这些故事</SectionTitle>
                <ul className="mt-2">
                  {relatedStories.map(story => {
                    const detail =
                      story.logline?.trim() || story.summary?.trim();
                    return (
                      <li key={story.id}>
                        <button
                          type="button"
                          className="flex min-h-14 w-full flex-col gap-0.5 py-2.5 text-left"
                          onClick={() => {
                            onOpenStory(story.id);
                            closeLetter();
                          }}
                        >
                          <span className="truncate text-[15px] font-medium text-foreground">
                            {story.title.trim() || "未命名故事"}
                          </span>
                          {detail ? (
                            <span className="truncate text-xs text-muted-foreground">
                              {detail}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}

            <section aria-label="聊会儿的回信" className="py-6">
              {selectedReference?.summary ? (
                <div className="space-y-4">
                  {dailyLetterParagraphs(selectedReference.summary).map(
                    paragraph => (
                      <p
                        key={paragraph}
                        className="text-[15px] leading-8 text-foreground"
                      >
                        {paragraph}
                      </p>
                    )
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  这一天的回信还没有生成。
                </p>
              )}

              <p className="mt-5 text-[9px] text-muted-foreground/60">
                第 {selectedLetter?.revision ?? 1} 版
                {selectedLetter?.updatedAt
                  ? ` · 更新于 ${dailyLetterTimestampLabel(selectedLetter.updatedAt)}`
                  : ""}
              </p>

              {actionError ? (
                <p className="mt-3 text-xs text-destructive" role="alert">
                  {actionError}
                </p>
              ) : null}

              {isToday && selectedLetter ? (
                <button
                  type="button"
                  disabled={rereadMut.isPending || rewriteMut.isPending}
                  className={cn(
                    "mt-4 inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-xs font-medium text-foreground transition",
                    "disabled:cursor-wait disabled:opacity-50"
                  )}
                  style={{ borderColor: "var(--nayin-border)" }}
                  onClick={() => void rereadLetter()}
                >
                  {rereadMut.isPending ? (
                    <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw aria-hidden="true" className="size-3.5 text-nayin" />
                  )}
                  {rereadMut.isPending ? "正在重新读…" : "用最新记忆，再读一遍"}
                </button>
              ) : null}
            </section>

            <div
              className="flex justify-end border-t pt-4"
              style={{ borderColor: "var(--nayin-border)" }}
            >
              <button
                type="button"
                className="min-h-11 px-2 text-xs text-muted-foreground"
                onClick={closeLetter}
              >
                把信收好，继续聊
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
