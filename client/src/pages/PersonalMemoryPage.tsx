import { useEffect, useMemo } from "react";
import { ArrowLeft, Brain, ShieldCheck } from "lucide-react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import PersonalMemoryInsightActions from "@/features/personalMemory/PersonalMemoryInsightActions";
import PersonalMemoryTimeline from "@/features/personalMemory/PersonalMemoryTimeline";
import { groupPersonalMemoryTimeline } from "@/features/personalMemory/personalMemoryViewModel";

export default function PersonalMemoryPage() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const timelineQuery = trpc.personalMemory.timeline.useInfiniteQuery(
    { limit: 20 },
    {
      retry: false,
      getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
    }
  );
  const lettersQuery = trpc.emotionAnalysis.listDailyLetters.useQuery(
    { limit: 365 },
    { retry: false }
  );
  const insightsQuery = trpc.personalMemory.listInsights.useQuery(
    { includeArchived: true, limit: 100 },
    { retry: false }
  );
  const groups = useMemo(
    () =>
      groupPersonalMemoryTimeline(
        timelineQuery.data?.pages.flatMap(page => page.items) ?? [],
        (lettersQuery.data ?? []).map(letter => ({
          letterDate: letter.letterDate,
          revision: letter.revision,
        }))
      ),
    [lettersQuery.data, timelineQuery.data]
  );

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash || timelineQuery.isLoading) return;
    requestAnimationFrame(() => {
      const target = document.getElementById(hash.slice(1));
      target?.scrollIntoView({ block: "center" });
      target?.focus();
    });
  }, [timelineQuery.data, timelineQuery.isLoading]);

  const refreshInsights = async () => {
    await Promise.all([
      insightsQuery.refetch(),
      utils.personalMemory.summary.invalidate({ maxDays: 3 }),
      utils.personalMemory.timeline.invalidate({ limit: 20 }),
    ]);
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="nayin-strip" />
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex items-start gap-3">
          <button
            type="button"
            aria-label="返回工作区"
            onClick={() =>
              window.history.length > 1
                ? window.history.back()
                : setLocation("/editing")
            }
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border hover:bg-[var(--muted)]"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Private Memory / 私密记录
            </p>
            <h1 className="mt-1 font-serif text-2xl font-semibold sm:text-3xl">
              你的足迹
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              这里把你真正写下、采用和确认过的内容按日期连起来。系统推断会明确标出，你可以随时纠正、暂不使用或忘记。
            </p>
          </div>
        </header>

        <section
          className="mt-6 grid gap-3 sm:grid-cols-2"
          aria-label="记忆边界说明"
        >
          <div
            className="rounded-2xl border p-4"
            style={{ borderColor: "var(--nayin-border)" }}
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              会长期保留什么
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              只保留你已发送的原话和明确采用的文章、图片。草稿、未采用候选和系统生成内容不会冒充你的记忆。
            </p>
          </div>
          <div
            className="rounded-2xl border p-4"
            style={{ borderColor: "var(--nayin-border)" }}
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              <Brain className="h-4 w-4" aria-hidden="true" />
              每日来信如何使用
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              来信只选少量仍有效的理解，并结合你的八字与当天黄历；黄历是当天资料，不会写进长期记忆。
            </p>
          </div>
        </section>

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section aria-labelledby="timeline-title">
            <h2 id="timeline-title" className="text-lg font-semibold">
              按日期回看
            </h2>
            <div className="mt-3" aria-live="polite">
              {timelineQuery.isLoading || lettersQuery.isLoading ? (
                <p className="rounded-2xl border p-6 text-sm text-muted-foreground">
                  正在整理你的足迹…
                </p>
              ) : timelineQuery.isError || lettersQuery.isError ? (
                <div className="rounded-2xl border p-6" role="alert">
                  <p className="text-sm">足迹暂时没有完整读到。</p>
                  <button
                    type="button"
                    className="mt-3 min-h-10 rounded-full border px-4 text-xs"
                    onClick={() => {
                      timelineQuery.refetch();
                      lettersQuery.refetch();
                    }}
                  >
                    重试
                  </button>
                </div>
              ) : (
                <PersonalMemoryTimeline
                  groups={groups}
                  hasNextPage={Boolean(timelineQuery.hasNextPage)}
                  isFetchingNextPage={timelineQuery.isFetchingNextPage}
                  onLoadMore={() => timelineQuery.fetchNextPage()}
                />
              )}
            </div>
          </section>

          <aside aria-labelledby="insights-title">
            <h2 id="insights-title" className="text-lg font-semibold">
              系统现在怎样理解你
            </h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              “系统推断”不是事实；你的纠正永远优先，并影响以后新生成的来信。
            </p>
            <div className="mt-3 space-y-3" aria-live="polite">
              {insightsQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">正在读取理解…</p>
              ) : insightsQuery.isError ? (
                <button
                  type="button"
                  className="min-h-10 text-sm underline"
                  onClick={() => insightsQuery.refetch()}
                >
                  理解暂时没读到，点击重试
                </button>
              ) : insightsQuery.data?.length ? (
                insightsQuery.data.map(insight => (
                  <PersonalMemoryInsightActions
                    key={`${insight.lineageKey}:${insight.revision}`}
                    insight={insight}
                    onChanged={refreshInsights}
                  />
                ))
              ) : (
                <div className="rounded-2xl border border-dashed p-5 text-xs leading-5 text-muted-foreground">
                  还没有形成可展示的理解。你写下的内容会先保留来源，再在安全边界内慢慢整理。
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
