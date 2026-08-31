import { trpc } from "@/lib/trpc";
import { ArrowLeft, RefreshCcw } from "lucide-react";
import { useState } from "react";

type InviteStatus = "pending" | "redeemed" | "expired";
type InviteFilter = "all" | InviteStatus;

const STATUS_META: Record<
  InviteStatus,
  { label: string; dotClassName: string; textClassName: string }
> = {
  pending: {
    label: "待领取",
    dotClassName: "bg-amber-500",
    textClassName: "text-amber-700",
  },
  redeemed: {
    label: "已领取",
    dotClassName: "bg-emerald-500",
    textClassName: "text-emerald-700",
  },
  expired: {
    label: "已过期",
    dotClassName: "bg-muted-foreground/40",
    textClassName: "text-muted-foreground",
  },
};

function formatTime(value: Date | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

export default function AdminInvitesPage() {
  const [filter, setFilter] = useState<InviteFilter>("all");
  const overview = trpc.accessAnalytics.invites.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const invites = overview.data?.invites ?? [];
  const filteredInvites =
    filter === "all"
      ? invites
      : invites.filter(invite => invite.status === filter);
  const counts = invites.reduce(
    (totals, invite) => {
      totals[invite.status] += 1;
      return totals;
    },
    { pending: 0, redeemed: 0, expired: 0 }
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
            <h1 className="text-lg font-semibold">内测邀请</h1>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              邀请码的领取、绑定与过期状态
            </p>
          </div>
          <button
            type="button"
            aria-label="刷新邀请状态"
            title="刷新邀请状态"
            disabled={overview.isFetching}
            onClick={() => overview.refetch()}
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <RefreshCcw
              className={`h-4 w-4 ${overview.isFetching ? "animate-spin" : ""}`}
            />
          </button>
        </div>
        <nav
          aria-label="管理页面"
          className="mx-auto flex max-w-6xl gap-5 px-5 sm:px-8"
        >
          <a
            href="/admin/users"
            className="border-b-2 border-transparent pb-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            用户
          </a>
          <a
            href="/admin/invites"
            aria-current="page"
            className="border-b-2 border-foreground pb-3 text-xs font-medium text-foreground"
          >
            邀请
          </a>
        </nav>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
        <section
          aria-label="邀请概览"
          className="grid grid-cols-3 gap-px overflow-hidden border-y bg-border text-center"
          style={{ borderColor: "var(--nayin-border)" }}
        >
          {(
            [
              ["待领取", counts.pending],
              ["已领取", counts.redeemed],
              ["已过期", counts.expired],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="bg-background px-3 py-5">
              <div className="text-xl font-semibold tabular-nums">{value}</div>
              <div className="mt-1 text-xs text-muted-foreground">{label}</div>
            </div>
          ))}
        </section>

        <div
          className="mt-7 flex flex-wrap items-center gap-2"
          role="group"
          aria-label="筛选邀请状态"
        >
          {(
            [
              ["all", "全部", invites.length],
              ["pending", "待领取", counts.pending],
              ["redeemed", "已领取", counts.redeemed],
              ["expired", "已过期", counts.expired],
            ] as const
          ).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                filter === value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
              }`}
            >
              {label}{" "}
              <span className="ml-1 tabular-nums opacity-70">{count}</span>
            </button>
          ))}
        </div>

        {overview.isLoading ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            正在读取邀请记录…
          </p>
        ) : overview.error ? (
          <p className="py-16 text-center text-sm text-destructive">
            暂时无法读取邀请记录，请稍后刷新。
          </p>
        ) : filteredInvites.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            这个状态下还没有邀请。
          </p>
        ) : (
          <section className="mt-5 overflow-x-auto" aria-label="邀请状态列表">
            <table className="w-full min-w-[980px] border-collapse text-left text-sm">
              <thead>
                <tr
                  className="border-b text-xs text-muted-foreground"
                  style={{ borderColor: "var(--nayin-border)" }}
                >
                  <th className="px-3 py-3 font-medium">邀请对象</th>
                  <th className="px-3 py-3 font-medium">状态</th>
                  <th className="px-3 py-3 font-medium">关联账号</th>
                  <th className="px-3 py-3 font-medium">创建时间</th>
                  <th className="px-3 py-3 font-medium">领取时间</th>
                  <th className="px-3 py-3 font-medium">有效期至</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvites.map(invite => {
                  const status = STATUS_META[invite.status];
                  const accountLabel =
                    invite.userName ||
                    invite.userEmail ||
                    (invite.redeemedByUserId
                      ? `用户 ${invite.redeemedByUserId}`
                      : null);
                  return (
                    <tr
                      key={invite.id}
                      className="border-b"
                      style={{ borderColor: "var(--nayin-border)" }}
                    >
                      <td className="px-3 py-4">
                        <div className="font-medium">
                          {invite.label ||
                            invite.redeemedByEmail ||
                            `邀请 ${invite.id}`}
                        </div>
                        {invite.redeemedByEmail &&
                        invite.redeemedByEmail !== invite.label ? (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {invite.redeemedByEmail}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-4">
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs ${status.textClassName}`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${status.dotClassName}`}
                          />
                          {status.label}
                        </span>
                      </td>
                      <td className="px-3 py-4">
                        {accountLabel ? (
                          <>
                            <div>{accountLabel}</div>
                            {invite.userName && invite.userEmail ? (
                              <div className="mt-1 text-xs text-muted-foreground">
                                {invite.userEmail}
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-muted-foreground">
                            尚未绑定
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-4 text-muted-foreground">
                        {formatTime(invite.createdAt)}
                      </td>
                      <td className="px-3 py-4 text-muted-foreground">
                        {formatTime(invite.redeemedAt)}
                      </td>
                      <td className="px-3 py-4 text-muted-foreground">
                        {invite.expiresAt
                          ? formatTime(invite.expiresAt)
                          : "不设期限"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}

        <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
          为了安全，数据库只保存邀请码的不可逆哈希，创建后无法从这里找回原码。
          「已领取」表示邀请码已绑定到邮箱；「待领取」表示仍可以被首次使用。
        </p>
      </div>
    </main>
  );
}
