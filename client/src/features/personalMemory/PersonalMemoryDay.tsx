import { ExternalLink, ImageIcon, Mail } from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { PersonalMemoryTimelineItem } from "@shared/personalMemory";
import {
  formatPersonalMemoryDate,
  PERSONAL_MEMORY_SOURCE_LABELS,
  type PersonalMemoryDayGroup,
} from "./personalMemoryViewModel";

function SourceAction({ item }: { item: PersonalMemoryTimelineItem }) {
  const sourceQuery = trpc.personalMemory.resolveSource.useQuery(
    { eventId: item.id },
    { enabled: false, retry: false }
  );

  const openSource = async () => {
    const result = await sourceQuery.refetch();
    const source = result.data;
    if (!source || source.availability !== "accessible") return;
    if (source.deepLink?.kind === "story") {
      window.location.assign(`/editing?storyId=${source.deepLink.storyId}`);
    } else if (source.deepLink?.kind === "daily_letter") {
      window.location.assign(`/editing?letterDate=${item.occurredOn}`);
    }
  };

  if (item.contentScrubbed) {
    return (
      <span className="text-[11px] text-muted-foreground">来源已删除</span>
    );
  }
  if (sourceQuery.data && sourceQuery.data.availability !== "accessible") {
    const label =
      sourceQuery.data.availability === "processing"
        ? "内容仍在处理中"
        : sourceQuery.data.availability === "forbidden"
          ? "当前无法访问来源"
          : "来源已删除";
    return <span className="text-[11px] text-muted-foreground">{label}</span>;
  }
  return (
    <button
      type="button"
      onClick={openSource}
      disabled={sourceQuery.isFetching}
      className="inline-flex min-h-9 items-center gap-1 text-[11px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-60"
    >
      <ExternalLink className="h-3 w-3" aria-hidden="true" />
      {sourceQuery.isFetching ? "正在确认来源…" : "查看来源"}
    </button>
  );
}

function EventCard({ item }: { item: PersonalMemoryTimelineItem }) {
  const time = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(item.occurredAt));
  return (
    <article
      id={`event-${item.id}`}
      tabIndex={-1}
      className="rounded-2xl border bg-background/70 p-4 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]"
      style={{ borderColor: "var(--nayin-border)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-foreground">
            {PERSONAL_MEMORY_SOURCE_LABELS[item.sourceType]}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{time}</p>
        </div>
        {item.sourceType === "image_adoption" ? (
          <ImageIcon
            className="h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
        ) : null}
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground">
        {item.excerpt ?? "这条记录的原内容已经不可显示。"}
      </p>
      <SourceAction item={item} />
    </article>
  );
}

export default function PersonalMemoryDay({
  group,
}: {
  group: PersonalMemoryDayGroup;
}) {
  return (
    <section
      id={`day-${group.occurredOn}`}
      aria-labelledby={`day-title-${group.occurredOn}`}
    >
      <h2
        id={`day-title-${group.occurredOn}`}
        className="sticky top-0 z-10 border-b bg-background/90 py-3 text-sm font-semibold backdrop-blur"
        style={{ borderColor: "var(--nayin-border)" }}
      >
        {formatPersonalMemoryDate(group.occurredOn)}
      </h2>
      <div className="space-y-3 py-3">
        {group.letter ? (
          <article
            className="rounded-2xl border p-4"
            style={{
              borderColor: "var(--nayin-border)",
              background: "var(--nayin-surface)",
            }}
          >
            <div className="flex items-center gap-2 text-xs font-medium">
              <Mail className="h-4 w-4" aria-hidden="true" />
              这一天的每日来信 · 第 {group.letter.revision} 版
            </div>
            <button
              type="button"
              className="mt-2 min-h-9 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              onClick={() =>
                window.location.assign(
                  `/editing?letterDate=${group.occurredOn}`
                )
              }
            >
              打开每日来信
            </button>
          </article>
        ) : null}
        {group.items.map(item => (
          <EventCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}
