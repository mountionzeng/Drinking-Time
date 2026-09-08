import { useEffect, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { trpc } from "@/lib/trpc";
import PersonalMemoryDay from "@/features/personalMemory/PersonalMemoryDay";
import PersonalMemoryInsightActions from "@/features/personalMemory/PersonalMemoryInsightActions";

export function monthDays(month: string): Array<string | null> {
  const [year, number] = month.split("-").map(Number);
  const offset = (new Date(Date.UTC(year, number - 1, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const days: Array<string | null> = Array(offset).fill(null);
  for (let day = 1; day <= count; day++)
    days.push(month + "-" + String(day).padStart(2, "0"));
  while (days.length % 7) days.push(null);
  return days;
}

export default function PersonalMemoryPage() {
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const [selected, setSelected] = useState(() => {
    const match = window.location.hash.match(/^#day-(\d{4}-\d{2}-\d{2})$/);
    const date = match?.[1];
    return date && monthDays(date.slice(0, 7)).includes(date) ? date : today;
  });
  const [month, setMonth] = useState(selected.slice(0, 7));
  const [manage, setManage] = useState(false);
  const user = trpc.auth.me.useQuery();
  const timeline = trpc.personalMemory.timeline.useInfiniteQuery(
    { limit: 100 },
    {
      retry: false,
      getNextPageParam: page => page.nextCursor ?? undefined,
    }
  );
  const letters = trpc.emotionAnalysis.listDailyLetters.useQuery(
    { limit: 365 },
    { retry: false }
  );
  const day = trpc.personalMemory.day.useQuery(
    { occurredOn: selected },
    { retry: false }
  );
  const insights = trpc.personalMemory.listInsights.useQuery(
    { includeArchived: true, limit: 100 },
    { enabled: manage, retry: false }
  );
  const summary = trpc.personalMemory.summary.useQuery(
    { maxDays: 3 },
    { enabled: manage }
  );
  const events = timeline.data?.pages.flatMap(page => page.items) ?? [];
  const oldest = events.at(-1)?.occurredOn;
  useEffect(() => {
    if (
      timeline.hasNextPage &&
      !timeline.isFetching &&
      !timeline.isError &&
      (!oldest || oldest >= month + "-01")
    )
      void timeline.fetchNextPage();
  }, [
    month,
    oldest,
    timeline.hasNextPage,
    timeline.isFetching,
    timeline.isError,
    timeline.fetchNextPage,
  ]);
  const marked = new Set(
    events
      .filter(
        event =>
          event.sourceType !== "daily_letter_version" && !event.contentScrubbed
      )
      .map(event => event.occurredOn)
  );
  const letter = letters.data?.find(item => item.letterDate === selected);
  const reference = letter?.dailyReference as { summary?: string } | undefined;
  const changeMonth = (delta: number) => {
    const [year, number] = month.split("-").map(Number);
    const next = new Date(Date.UTC(year, number - 1 + delta, 1))
      .toISOString()
      .slice(0, 7);
    setMonth(next);
    setSelected(next === today.slice(0, 7) ? today : next + "-01");
  };
  const name = user.data?.name || "用户信息";
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="nayin-strip" />
      <div className="mx-auto max-w-2xl px-5 py-7 sm:px-10 sm:py-10">
        <a
          href="/editing"
          className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={16} />
          返回工作区
        </a>
        <header className="mb-10 mt-7 flex items-center gap-4">
          <div
            aria-hidden="true"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-muted font-serif text-xl"
          >
            {name.slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-serif text-2xl">{name}</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              来信与日常，都在这里。
            </p>
          </div>
          <button
            onClick={() => setManage(!manage)}
            aria-expanded={manage}
            className="min-h-11 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            {manage ? "收起" : "资料与记忆"}
          </button>
        </header>
        {manage && (
          <section
            aria-label="资料与记忆"
            className="mb-8 space-y-4 border-b pb-6"
          >
            <p className="text-sm">{user.data?.email || "当前账号"}</p>
            {summary.data?.captureEnabled === false && (
              <p className="text-xs text-muted-foreground">
                自动记忆尚未开启，新聊天暂不会整理成长期理解。
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              系统推断可以纠正；忘记理解不会删除原始聊天与作品。
            </p>
            {insights.isLoading ? (
              <p role="status">正在读取…</p>
            ) : insights.isError ? (
              <button onClick={() => insights.refetch()}>重新读取记忆</button>
            ) : insights.data?.length ? (
              insights.data.map(insight => (
                <PersonalMemoryInsightActions
                  key={insight.lineageKey + insight.revision}
                  insight={insight}
                  onChanged={async () => {
                    await insights.refetch();
                    await day.refetch();
                    await timeline.refetch();
                  }}
                />
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                还没有形成可展示的理解。
              </p>
            )}
          </section>
        )}
        <section aria-label="个人日历">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="font-serif text-xl">
              {Number(month.slice(5))} 月{" "}
              <span className="ml-2 text-sm text-muted-foreground">
                {month.slice(0, 4)}
              </span>
            </h2>
            <div className="flex items-center gap-1">
              <button
                aria-label="上个月"
                onClick={() => changeMonth(-1)}
                className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-muted"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                onClick={() => {
                  setMonth(today.slice(0, 7));
                  setSelected(today);
                }}
                className="h-11 px-3 text-xs"
              >
                今天
              </button>
              <button
                aria-label="下个月"
                onClick={() => changeMonth(1)}
                className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-muted"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-7 text-center text-xs text-muted-foreground">
            {"一二三四五六日".split("").map(label => (
              <span key={label} className="pb-3">
                {label}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-1">
            {monthDays(month).map((date, i) =>
              date ? (
                <button
                  key={date}
                  aria-label={date + (marked.has(date) ? "，有新内容" : "")}
                  aria-pressed={selected === date}
                  aria-current={date === today ? "date" : undefined}
                  onClick={() => setSelected(date)}
                  className={
                    "relative mx-auto flex h-12 w-full max-w-12 flex-col items-center justify-center rounded-full text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
                    (selected === date
                      ? "bg-foreground text-background"
                      : "hover:bg-muted") +
                    (date === today ? " font-bold" : "")
                  }
                >
                  <span>{Number(date.slice(-2))}</span>
                  {marked.has(date) && (
                    <span
                      aria-hidden="true"
                      className="absolute bottom-1.5 h-1 w-1 rounded-full bg-current"
                    />
                  )}
                </button>
              ) : (
                <span key={"blank-" + i} />
              )
            )}
          </div>
          <p className="mt-5 text-center text-xs text-muted-foreground">
            小圆点 · 当天有原话、感悟或采用的作品
          </p>
          {timeline.isFetching && (
            <p
              role="status"
              className="mt-2 text-center text-xs text-muted-foreground"
            >
              正在读取日期标记…
            </p>
          )}
          {timeline.isError && (
            <button
              className="mt-2 text-xs underline"
              onClick={() => timeline.refetch()}
            >
              日期标记未完整加载，点击重试
            </button>
          )}
        </section>
        <section
          aria-label="当天的来信与记录"
          aria-live="polite"
          className="mt-8 border-t pt-7"
        >
          <p className="mb-5 text-xs text-muted-foreground">
            {selected.replaceAll("-", " / ")}
          </p>
          {letters.isError || day.isError ? (
            <button
              className="text-sm underline"
              onClick={() => {
                void letters.refetch();
                void day.refetch();
              }}
            >
              这一天暂未读到，点击重试
            </button>
          ) : letters.isLoading || day.isLoading ? (
            <p role="status" className="text-sm text-muted-foreground">
              正在展开这一天…
            </p>
          ) : (
            <>
              <article>
                <h2 className="mb-4 font-serif text-xl">写给你的一封信</h2>
                {reference?.summary ? (
                  <p className="whitespace-pre-wrap text-sm leading-8">
                    {reference.summary}
                  </p>
                ) : (
                  <p className="text-sm leading-7 text-muted-foreground">
                    {selected > today
                      ? "这一天还没到，来信也还在路上。"
                      : "这一天还没有保存的来信。"}
                  </p>
                )}
                {letter && (
                  <a
                    className="mt-4 inline-block py-2 text-xs text-muted-foreground underline"
                    href={"/editing?letterDate=" + selected}
                  >
                    打开完整来信
                  </a>
                )}
              </article>
              {Boolean(
                day.data?.items.some(
                  item => item.sourceType !== "daily_letter_version"
                )
              ) && (
                <div className="mt-6">
                  <PersonalMemoryDay
                    group={{
                      occurredOn: selected,
                      letter: null,
                      items: day.data!.items.filter(
                        item => item.sourceType !== "daily_letter_version"
                      ),
                    }}
                  />
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
