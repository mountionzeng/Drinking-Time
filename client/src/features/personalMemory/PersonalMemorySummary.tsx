import { CalendarDays, ChevronRight } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  describeSummarySources,
  formatPersonalMemoryDate,
} from "./personalMemoryViewModel";

export default function PersonalMemorySummary({
  onOpenAll,
  compact = true,
}: {
  onOpenAll?: () => void;
  compact?: boolean;
}) {
  const detailText = compact ? "text-[11px]" : "text-sm";
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
      className={cn("border-b", compact ? "p-3" : "py-5")}
      style={{ borderColor: "var(--nayin-border)" }}
    >
      <div
        className={cn(
          "flex items-center gap-1.5 font-medium text-foreground",
          compact ? "text-xs" : "font-chat-brand text-lg"
        )}
      >
        <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
        用户信息
      </div>
      <p
        className={cn(
          "mt-1 text-muted-foreground",
          compact ? "text-[10px] leading-4" : "text-sm leading-6"
        )}
      >
        只记录你已发送的原话和明确采用的作品；黄历不会成为长期记忆。
      </p>

      {summaryQuery.data?.captureEnabled === false ? (
        <p
          className={cn(
            "mt-2 text-muted-foreground",
            compact ? "text-xs leading-5" : "text-sm leading-6"
          )}
          role="status"
        >
          自动记忆尚未开启。目前可回看已有来信；新聊天还不会自动整理为长期理解。
        </p>
      ) : null}

      {summaryQuery.isLoading ? (
        <p
          className={cn("mt-2 text-muted-foreground", detailText)}
          role="status"
        >
          正在整理最近的记录…
        </p>
      ) : summaryQuery.isError ? (
        <div
          className={cn("mt-2 text-muted-foreground", detailText)}
          role="alert"
        >
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
              className={cn(
                "flex items-center justify-between gap-2",
                detailText
              )}
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
        <p
          className={cn(
            "mt-2 leading-relaxed text-muted-foreground",
            detailText
          )}
        >
          还没有足迹。以后你写下的话和明确采用的作品会从这里慢慢连起来。
        </p>
      )}

      <button
        type="button"
        className={cn(
          "mt-2 flex w-full items-center justify-between rounded-md px-2 text-left text-foreground transition-colors hover:bg-[var(--muted)]",
          compact ? "min-h-9 text-xs" : "min-h-11 text-base"
        )}
        onClick={openAll}
      >
        打开我的日历
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </section>
  );
}
