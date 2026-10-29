import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  adminUserCategories,
  adminUserCategoryLabels,
  type AdminUserCategory,
} from "@shared/adminUsers";
import { formatComputeBalance } from "@shared/computeMoney";
import { Statement } from "./AdminComputePage";

const time = (date: Date | null) =>
  date
    ? new Date(date).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour12: false,
      })
    : "尚无访问记录";
const button =
  "rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted disabled:opacity-40";
const providerNames: Record<string, string> = {
  email: "邮箱",
  google: "Google",
  phone: "手机",
  wechat: "微信",
};

export default function AdminUserOverview({ siteHost }: { siteHost: string }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<number>();
  const [saved, setSaved] = useState("");
  const statementRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selected !== undefined)
      statementRef.current?.scrollIntoView?.({
        behavior: "smooth",
        block: "start",
      });
  }, [selected]);
  const utils = trpc.useUtils();
  const query = trpc.adminUsers.overview.useQuery(
    { siteHost },
    { enabled: Boolean(siteHost), refetchInterval: 30000 }
  );
  const mutation = trpc.adminUsers.setCategory.useMutation({
    onSuccess: async () => {
      await utils.adminUsers.overview.invalidate({ siteHost });
      setSaved("分类已保存");
    },
  });
  const data = query.data;
  if (query.isLoading)
    return (
      <p className="py-8" role="status">
        正在核对注册账号与算力…
      </p>
    );
  if (query.error || !data)
    return (
      <div className="py-8" role="alert">
        用户总览读取失败，当前人数未知。{" "}
        <button className={button} onClick={() => query.refetch()}>
          重试
        </button>
      </div>
    );
  const summary = data.summary;
  const rows = data.users.filter(user => {
    const matchesCategory =
      filter === "all" ||
      (filter === "unverified"
        ? user.registration !== "verified"
        : user.registration === "verified" && user.category === filter);
    const text =
      `${user.email ?? ""} ${user.name ?? ""} ${user.userId}`.toLowerCase();
    return matchesCategory && text.includes(search.trim().toLowerCase());
  });
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(rows.length / 25) - 1)
  );
  const pageRows = rows.slice(currentPage * 25, (currentPage + 1) * 25);
  const selectedUser = data.users.find(user => user.userId === selected);
  return (
    <section aria-label="注册用户总览">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">注册与使用</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            更新于 {time(data.generatedAt)} · 北京时间 · 每 30 秒刷新
          </p>
        </div>
        <button
          className={button}
          disabled={query.isFetching}
          onClick={() => query.refetch()}
        >
          {query.isFetching ? "刷新中…" : "刷新总览"}
        </button>
      </div>
      <dl className="my-6 grid grid-cols-2 gap-x-6 gap-y-5 border-y py-5 sm:grid-cols-3 lg:grid-cols-6">
        {(
          [
            ["已验证注册账号", summary.registered],
            ["已确认外部用户", summary.external],
            ["待确认账号", summary.unclassified],
            ["近 7 天新增", summary.new7d],
            ["近 7 天活跃", summary.active7d],
            [
              "注册账号累计消耗",
              formatComputeBalance(summary.lifetimeSpentMinor),
            ],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-2 text-xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="-mt-3 mb-4 text-xs leading-relaxed text-muted-foreground">
        累计消耗只含已结算扣款，预占（待核对、进行中）不计入；预占金额见名单的“预占
        / 可用”列。
      </p>
      <p className="text-sm leading-relaxed">
        已验证账号中：自己的账号 {summary.own} 个，测试账号 {summary.test}{" "}
        个；已确认外部用户近 7 天活跃 {summary.externalActive7d} 个，累计消耗{" "}
        {formatComputeBalance(summary.externalSpentMinor)}。
      </p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        按账号去重，邮箱与 Google 绑定同一账号只计一次。历史未验证{" "}
        {summary.legacy} 个、访客 {summary.guests}{" "}
        个另列；待确认账号不算外部用户。活跃只依据 {data.siteHost}{" "}
        的已记录访问，不以登录时间代替；未记录不代表从未使用。算力仅统计已进入账本的调用。
      </p>
      <div className="my-5 flex flex-wrap gap-3">
        <input
          aria-label="搜索账号"
          placeholder="搜索邮箱、名字或账号编号"
          value={search}
          onChange={event => {
            setSearch(event.target.value);
            setPage(0);
          }}
          className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
        />
        <select
          aria-label="筛选账号分类"
          value={filter}
          onChange={event => {
            setFilter(event.target.value);
            setPage(0);
          }}
          className={button + " bg-background"}
        >
          <option value="all">全部账号</option>
          {adminUserCategories.map(category => (
            <option key={category} value={category}>
              {adminUserCategoryLabels[category]}
            </option>
          ))}
          <option value="unverified">历史未验证 / 访客</option>
        </select>
      </div>
      {mutation.error && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          分类保存失败，未确认变更。请刷新后重试。
        </p>
      )}
      <p role="status" className="mb-2 text-xs text-muted-foreground">
        {mutation.isPending ? "正在保存分类…" : saved}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1060px] text-left text-sm">
          <caption className="sr-only">账号名单与算力账单</caption>
          <thead>
            <tr className="border-b">
              {[
                "账号 / 登录方式",
                "统计分类",
                "注册时间",
                "最近访问",
                "累计赠送",
                "累计消耗",
                "预占 / 可用",
                "账单",
              ].map(label => (
                <th className="px-3 py-3 font-medium" key={label}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map(user => (
              <tr
                key={user.userId}
                className="border-b align-top hover:bg-muted/30"
              >
                <td className="px-3 py-4">
                  <div className="font-medium">
                    {user.email || user.name || `账号 #${user.userId}`}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    #{user.userId} ·{" "}
                    {user.registration === "verified"
                      ? user.providers
                          .map(provider => providerNames[provider] ?? provider)
                          .join(" / ")
                      : user.registration === "guest"
                        ? "访客"
                        : "历史未验证"}
                    {user.role === "admin" ? " · 管理员" : ""}
                  </div>
                </td>
                <td className="px-3 py-4">
                  <select
                    aria-label={`账号 ${user.userId} 的分类`}
                    value={user.category}
                    disabled={mutation.isPending}
                    onChange={event => {
                      setSaved("");
                      mutation.mutate({
                        userId: user.userId,
                        category: event.target.value as AdminUserCategory,
                      });
                    }}
                    className="rounded-md border bg-background px-2 py-1.5 text-xs disabled:opacity-40"
                  >
                    {adminUserCategories.map(category => (
                      <option key={category} value={category}>
                        {adminUserCategoryLabels[category]}
                      </option>
                    ))}
                  </select>
                  {user.registration !== "verified" && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      不计入注册数与待确认数
                    </div>
                  )}
                </td>
                <td className="px-3 py-4 text-xs">{time(user.createdAt)}</td>
                <td className="px-3 py-4 text-xs">
                  <div>{time(user.lastSeenAt)}</div>
                  <div className="mt-1 text-muted-foreground">
                    访问 {user.visitCount} 次 ·{" "}
                    {Math.floor(user.durationSeconds / 60)} 分钟
                  </div>
                  <details className="mt-1 text-muted-foreground">
                    <summary className="cursor-pointer">登录时间</summary>
                    {time(user.lastSignedIn)}
                  </details>
                </td>
                <td className="px-3 py-4 tabular-nums">
                  {formatComputeBalance(user.giftMinor)}
                </td>
                <td className="px-3 py-4 tabular-nums">
                  {formatComputeBalance(user.lifetimeSpentMinor)}
                </td>
                <td className="px-3 py-4 tabular-nums">
                  <div>{formatComputeBalance(user.reservedMinor)}</div>
                  <div className="mt-1 text-muted-foreground">
                    可用 {formatComputeBalance(user.availableMinor)}
                  </div>
                </td>
                <td className="px-3 py-4">
                  <button
                    className={button}
                    aria-label={`查看账号 ${user.userId} 的账单`}
                    onClick={() => setSelected(user.userId)}
                  >
                    查看
                  </button>
                  {selected === user.userId && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      账单见下方
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <p className="py-8 text-sm text-muted-foreground">
          没有符合条件的账号。
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <span className="mr-auto text-muted-foreground">
          符合条件 {rows.length} 个 · 第 {currentPage + 1} 页
        </span>
        <button
          className={button}
          disabled={!currentPage}
          onClick={() => setPage(currentPage - 1)}
        >
          上一页
        </button>
        <button
          className={button}
          disabled={(currentPage + 1) * 25 >= rows.length}
          onClick={() => setPage(currentPage + 1)}
        >
          下一页
        </button>
      </div>
      {selectedUser && (
        <section
          ref={statementRef}
          className="mt-6 scroll-mt-4 border-t pt-6"
          aria-label="用户账单"
        >
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold">
              {selectedUser.email || `账号 #${selectedUser.userId}`} 的账单
            </h3>
            <button className={button} onClick={() => setSelected(undefined)}>
              收起账单
            </button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            标为“异常”的流水若已实际扣款，会计入累计消耗；未扣款的预占释放后不计入。
          </p>
          <Statement key={selectedUser.userId} userId={selectedUser.userId} />
        </section>
      )}
    </section>
  );
}
