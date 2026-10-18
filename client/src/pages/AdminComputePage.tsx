import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatComputeBalance } from "@shared/computeMoney";
import type { ComputeStatementItem } from "@shared/computeStatement";

const time = (value: Date | string) => new Date(value).toLocaleString("zh-CN");
const statuses = {
  posted: "已入账",
  reserved: "预占中",
  processing: "处理中",
  reconciliation: "待核对",
  released: "已释放",
  exception: "异常",
};
const button =
  "rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted disabled:opacity-40";
function Entries({ items }: { items: ComputeStatementItem[] }) {
  return items.length ? (
    <ul className="divide-y">
      {items.map((item, i) => (
        <li
          key={i}
          className="flex flex-wrap justify-between gap-3 py-3 text-sm"
        >
          <div>
            {item.label} · {statuses[item.status]}
            {item.estimated ? " · 估算" : ""}
            <div className="text-xs text-muted-foreground">
              {time(item.createdAt)}
            </div>
          </div>
          <div className="text-right tabular-nums">
            {formatComputeBalance(item.amountMinor)}
            {item.reservedMinor > 0 && (
              <div>预占 {formatComputeBalance(item.reservedMinor)}</div>
            )}
            {item.releasedMinor > 0 && (
              <div>释放 {formatComputeBalance(item.releasedMinor)}</div>
            )}
          </div>
        </li>
      ))}
    </ul>
  ) : (
    <p className="py-4 text-sm text-muted-foreground">暂无记录</p>
  );
}
function Statement({ userId }: { userId: number }) {
  const [historyOffset, setHistory] = useState(0);
  const [attentionOffset, setAttention] = useState(0);
  const query = trpc.adminCompute.statement.useQuery(
    { userId, historyOffset, attentionOffset },
    { refetchInterval: 30000 }
  );
  if (query.isLoading) return <p>正在读取账单…</p>;
  if (query.error || !query.data)
    return (
      <p role="alert">
        账单读取失败。
        <button className={button} onClick={() => query.refetch()}>
          重试
        </button>
      </p>
    );
  const data = query.data;
  return (
    <>
      <p className="my-4 text-sm text-muted-foreground">{data.coverageNote}</p>
      <p className="tabular-nums">
        可用 {formatComputeBalance(data.balance.availableMinor)} · 累计消耗{" "}
        {formatComputeBalance(data.balance.lifetimeSpentMinor)}
      </p>
      <h3 className="mt-6 font-medium">进行中与待核对</h3>
      <Entries items={data.attentionItems} />
      <div className="flex gap-2">
        <button
          className={button}
          disabled={!attentionOffset}
          onClick={() => setAttention(n => n - 25)}
        >
          上一页
        </button>
        <button
          className={button}
          disabled={!data.attentionHasMore || attentionOffset >= 500}
          onClick={() => setAttention(n => n + 25)}
        >
          下一页
        </button>
      </div>
      <h3 className="mt-6 font-medium">历史账单</h3>
      <Entries items={data.historyItems} />
      <div className="flex gap-2">
        <button
          className={button}
          disabled={!historyOffset}
          onClick={() => setHistory(n => n - 25)}
        >
          上一页
        </button>
        <button
          className={button}
          disabled={!data.historyHasMore || historyOffset >= 500}
          onClick={() => setHistory(n => n + 25)}
        >
          下一页
        </button>
      </div>
      {(data.historyTruncated || data.attentionTruncated) && (
        <p>更早记录超出当前查询范围。</p>
      )}
    </>
  );
}
export default function AdminComputePage() {
  const [draft, setDraft] = useState("");
  const [email, setEmail] = useState<string>();
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<{
    userId: number;
    email: string | null;
  }>();
  const query = trpc.adminCompute.users.useQuery(
    { email, offset, limit: 25 },
    { refetchInterval: 30000 }
  );
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
        <nav className="mb-8 flex gap-5 text-sm">
          <a href="/editing">返回创作</a>
          <a href="/admin/users">用户访问</a>
          <a href="/admin/invites">邀请</a>
          <a
            href="/admin/compute"
            aria-current="page"
            className="font-semibold"
          >
            算力账单
          </a>
        </nav>
        <h1 className="text-2xl font-semibold">用户算力</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          真实账号与账本记录 · 每 30 秒刷新 · 算力显示两位小数
        </p>
        <form
          className="my-6 flex flex-wrap gap-2"
          onSubmit={e => {
            e.preventDefault();
            setEmail(draft.trim() || undefined);
            setOffset(0);
            setSelected(undefined);
          }}
        >
          <input
            type="email"
            aria-label="按完整邮箱查询"
            placeholder="输入完整邮箱"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2"
          />
          <button className={button}>查询</button>
          <button
            type="button"
            className={button}
            onClick={() => {
              setDraft("");
              setEmail(undefined);
              setOffset(0);
              setSelected(undefined);
            }}
          >
            全部用户
          </button>
          <button
            type="button"
            className={button}
            disabled={query.isFetching}
            onClick={() => query.refetch()}
          >
            刷新
          </button>
        </form>
        <p className="mb-4 text-xs text-muted-foreground">
          邮箱来自实际登录账号。未注册的邮箱不会创建虚拟用户；无邮箱的账号显示账号编号。仅统计已进入算力账本的调用。
        </p>
        {query.isLoading ? (
          <p>正在读取…</p>
        ) : query.error ? (
          <p role="alert">读取失败，请刷新重试。</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead>
                  <tr className="border-b">
                    {[
                      "邮箱 / 用户",
                      "注册时间",
                      "最近登录",
                      "累计赠送",
                      "累计消耗",
                      "预占",
                      "可用",
                      "明细",
                    ].map(s => (
                      <th key={s} className="p-3 font-medium">
                        {s}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {query.data?.users.map(u => (
                    <tr key={u.userId} className="border-b hover:bg-muted/30">
                      <td className="p-3">
                        {u.email || `账号 #${u.userId}`}
                        <div className="text-xs text-muted-foreground">
                          {u.name}
                        </div>
                      </td>
                      <td className="p-3">{time(u.createdAt)}</td>
                      <td className="p-3">{time(u.lastSignedIn)}</td>
                      {[
                        u.giftMinor,
                        u.lifetimeSpentMinor,
                        u.reservedMinor,
                        u.availableMinor,
                      ].map((n, i) => (
                        <td key={i} className="p-3 tabular-nums">
                          {formatComputeBalance(n)}
                        </td>
                      ))}
                      <td className="p-3">
                        <button
                          className={button}
                          onClick={() => setSelected(u)}
                        >
                          查看
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!query.data?.users.length && (
              <p className="py-8">
                未找到账号。请确认此邮箱已在当前站点完成登录。
              </p>
            )}
            <div className="my-5 flex items-center gap-3">
              <button
                className={button}
                disabled={!offset}
                onClick={() => setOffset(n => n - 25)}
              >
                上一页
              </button>
              <span>第 {offset / 25 + 1} 页</span>
              <button
                className={button}
                disabled={!query.data?.hasMore}
                onClick={() => setOffset(n => n + 25)}
              >
                下一页
              </button>
            </div>
          </>
        )}
        {selected && (
          <section className="mt-8 border-t pt-6" aria-label="用户账单">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">
                {selected.email || `账号 #${selected.userId}`} 的账单
              </h2>
              <button className={button} onClick={() => setSelected(undefined)}>
                收起
              </button>
            </div>
            <Statement key={selected.userId} userId={selected.userId} />
          </section>
        )}
      </div>
    </main>
  );
}
