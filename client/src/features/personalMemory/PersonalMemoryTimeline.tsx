import PersonalMemoryDay from "./PersonalMemoryDay";
import type { PersonalMemoryDayGroup } from "./personalMemoryViewModel";

export default function PersonalMemoryTimeline({
  groups,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: {
  groups: PersonalMemoryDayGroup[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}) {
  if (groups.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed p-8 text-center">
        <p className="text-sm text-foreground">你的足迹会从这里开始</p>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          你发送的原话、明确采用的文章和图片，以及每日来信会按真实日期排列。
        </p>
      </div>
    );
  }
  return (
    <div>
      {groups.map(group => (
        <PersonalMemoryDay key={group.occurredOn} group={group} />
      ))}
      <div className="py-5 text-center" aria-live="polite">
        {hasNextPage ? (
          <button
            type="button"
            className="min-h-11 rounded-full border px-5 text-sm hover:bg-[var(--muted)] disabled:opacity-60"
            onClick={onLoadMore}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? "正在加载更多…" : "加载更早的足迹"}
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">
            已经看到最早的记录
          </span>
        )}
      </div>
    </div>
  );
}
