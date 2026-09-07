import { CalendarDays, ChevronRight } from "lucide-react";
import { trpc } from "@/lib/trpc";
import {
  describeSummarySources,
  formatPersonalMemoryDate,
} from "./personalMemoryViewModel";

export default function PersonalMemorySummary({
  onOpenAll,
}: {
  onOpenAll?: () => void;
}) {
  const summaryQuery = trpc.personalMemory.summary.useQuery(
    { maxDays: 3 },
    { retry: false }
  );
  const openAll = () => {
    if (onOpenAll) onOpenAll();
    else window.location.assign("/personal-memory");
  };

  return (
    <section
      aria-label="你的个人足迹摘要"
      className="border-b p-3"
      style={{ borderColor: "var(--nayin-border)" }}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
        你的足迹
      </div>
      <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
        只记录你已发送的原话和明确采用的作品；黄历不会成为长期记忆。
      </p>

      {summaryQuery.isLoading ? (
        <p className="mt-2 text-[11px] text-muted-foreground" role="status">
          正在整理最近的记录…
        </p>
      ) : summaryQuery.isError ? (
        <div className="mt-2 text-[11px] text-muted-foreground" role="alert">
          <span>足迹暂时没有读到。</span>
          <button
            type="button"
            className="ml-2 underline underline-offset-2"
            onClick={() => summaryQuery.refetch()}
          >
            重试
          </button>
        </div>
      ) : summaryQuery.data?.days.length ? (
        <ul className="mt-2 space-y-1.5">
          {summaryQuery.data.days.map(day => (
            <li
              key={day.occurredOn}
              className="flex items-center justify-between gap-2 text-[11px]"
            >
              <span className="text-foreground">
                {formatPersonalMemoryDate(day.occurredOn)}
              </span>
              <span className="truncate text-muted-foreground">
                {describeSummarySources(day.sourceTypes)} · {day.eventCount} 项
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
          还没有足迹。以后你写下的话和明确采用的作品会从这里慢慢连起来。
        </p>
      )}

      <button
        type="button"
        className="mt-2 flex min-h-9 w-full items-center justify-between rounded-md px-2 text-left text-xs text-foreground transition-colors hover:bg-[var(--muted)]"
        onClick={openAll}
      >
        查看全部足迹
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </section>
  );
}
