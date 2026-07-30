import { trpc } from "@/lib/trpc";
import { ArrowLeft, RefreshCcw } from "lucide-react";

const ACTIVE_WINDOW_MS = 90_000;

function formatDuration(totalSeconds: number) {
  if (totalSeconds < 60) return "不足 1 分钟";
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} 分钟`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
}

function formatTime(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

function formatRelativeTime(value: Date, now: Date) {
  const elapsedSeconds = Math.max(
    0,
    Math.floor((now.getTime() - value.getTime()) / 1000)
  );
  if (elapsedSeconds < 90) return "刚刚";
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

export default function AdminVisitsPage() {
  const siteHost =
    typeof window === "undefined" ? "" : window.location.hostname.toLowerCase();
  const overview = trpc.accessAnalytics.overview.useQuery(
    { siteHost },
    {
      enabled: Boolean(siteHost),
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
    }
  );
  const generatedAt = overview.data?.generatedAt ?? new Date();
  const users = overview.data?.users ?? [];
  const activeUsers = users.filter(
    user =>
      generatedAt.getTime() - user.lastSeenAt.getTime() <= ACTIVE_WINDOW_MS
  ).length;
  const totalVisits = users.reduce(
    (total, user) => total + user.visitCount,
    0
  );

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header
        className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur"
        style={{ borderColor: "var(--nayin-border)" }}
      >
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-4 sm:px-8">
          <button
            type="button"
            aria-label="返回编辑页面"
            title="返回编辑页面"
            onClick={() => {
              window.location.href = "/editing";
            }}
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold">访问情况</h1>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {siteHost} · 仅统计登录后的活跃时间
            </p>
          </div>
          <button
            type="button"
            aria-label="刷新访问数据"
            title="刷新访问数据"
            disabled={overview.isFetching}
            onClick={() => overview.refetch()}
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <RefreshCcw
              className={`h-4 w-4 ${overview.isFetching ? "animate-spin" : ""}`}
            />
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
        <section
          aria-label="访问概览"
          className="grid grid-cols-3 gap-px overflow-hidden border-y bg-border text-center"
          style={{ borderColor: "var(--nayin-border)" }}
        >
          {[
            ["登录用户", users.length],
            ["当前在线", activeUsers],
            ["访问次数", totalVisits],
          ].map(([label, value]) => (
            <div key={label} className="bg-background px-3 py-5">
              <div className="text-xl font-semibold tabular-nums">{value}</div>
              <div className="mt-1 text-xs text-muted-foreground">{label}</div>
            </div>
          ))}
        </section>

        {overview.isLoading ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            正在读取访问记录…
          </p>
        ) : overview.error ? (
          <p className="py-16 text-center text-sm text-destructive">
            暂时无法读取访问记录，请稍后刷新。
          </p>
        ) : users.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            还没有记录到登录后的访问。
          </p>
        ) : (
          <section className="mt-8 overflow-x-auto" aria-label="登录用户列表">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead>
                <tr
                  className="border-b text-xs text-muted-foreground"
                  style={{ borderColor: "var(--nayin-border)" }}
                >
                  <th className="px-3 py-3 font-medium">用户</th>
                  <th className="px-3 py-3 font-medium">首次看到</th>
                  <th className="px-3 py-3 font-medium">最近在线</th>
                  <th className="px-3 py-3 text-right font-medium">访问次数</th>
                  <th className="px-3 py-3 text-right font-medium">累计停留</th>
                  <th className="px-3 py-3 text-right font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                {users.map(user => {
                  const isActive =
                    generatedAt.getTime() - user.lastSeenAt.getTime() <=
                    ACTIVE_WINDOW_MS;
                  return (
                    <tr
                      key={user.userId}
                      className="border-b"
                      style={{ borderColor: "var(--nayin-border)" }}
                    >
                      <td className="px-3 py-4">
                        <div className="font-medium">
                          {user.name || user.email || `用户 ${user.userId}`}
                        </div>
                        {user.name && user.email ? (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {user.email}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-4 text-muted-foreground">
                        {formatTime(user.firstSeenAt)}
                      </td>
                      <td
                        className="px-3 py-4 text-muted-foreground"
                        title={formatTime(user.lastSeenAt)}
                      >
                        {formatRelativeTime(user.lastSeenAt, generatedAt)}
                      </td>
                      <td className="px-3 py-4 text-right tabular-nums">
                        {user.visitCount}
                      </td>
                      <td className="px-3 py-4 text-right tabular-nums">
                        {formatDuration(user.durationSeconds)}
                      </td>
                      <td className="px-3 py-4 text-right">
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs ${
                            isActive
                              ? "text-emerald-700"
                              : "text-muted-foreground"
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              isActive ? "bg-emerald-500" : "bg-muted-foreground/40"
                            }`}
                          />
                          {isActive ? "在线" : "离线"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}

        <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
          停留时间按页面可见时的轻量报到估算，最多会有约 30 秒误差；连续 30
          分钟没有活动后，再回来会记为新的一次访问。这里不保存 IP、设备指纹、
          浏览内容或故事数据。
        </p>
      </div>
    </main>
  );
}
