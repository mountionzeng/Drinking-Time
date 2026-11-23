import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { adminUserCategories, adminUserCategoryLabels } from "@shared/adminUsers";
import {
  ACTIVITY_DAY_MS, ACTIVITY_PLATFORMS, activityBeijingDate, activityWindow,
  type ActivityWindow,
} from "@shared/activityJourney";

const platformLabels = { web: "网站", miniprogram: "小程序", unknown: "来源未知" };
const inputClass = "rounded-md border bg-background px-2 py-1.5 text-sm";
const rate = (value: number | null) => value == null ? "—" : new Intl.NumberFormat("zh-CN", {
  style: "percent", maximumFractionDigits: 1,
}).format(value);

function initialWindow(): ActivityWindow {
  const now = Date.now();
  return { from: activityBeijingDate(now - 6 * ACTIVITY_DAY_MS), through: activityBeijingDate(now) };
}

export default function AdminCreationJourney() {
  const [open, setOpen] = useState(false);
  return (
    <details className="mt-10 border-t pt-5" onToggle={event => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-sm font-medium">创作漏斗</summary>
      {open && <JourneyReport />}
    </details>
  );
}

function JourneyReport() {
  const [draft, setDraft] = useState(initialWindow);
  const [applied, setApplied] = useState(draft);
  const [exportState, setExportState] = useState<"idle" | "loading" | "error">("idle");
  const parsed = activityWindow.safeParse(draft);
  const report = trpc.adminUsers.journeySummary.useQuery(applied);
  const utils = trpc.useUtils();
  const data = report.data;
  const exportCsv = async () => {
    setExportState("loading");
    try {
      const csv = await utils.adminUsers.journeyExport.fetch(applied);
      const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `creation-journey-${applied.from}-${applied.through}.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportState("idle");
    } catch {
      setExportState("error");
    }
  };

  return (
    <section className="mt-4 space-y-4" aria-label="创作漏斗汇总">
      <form className="flex flex-wrap items-end gap-3" onSubmit={event => {
        event.preventDefault();
        if (parsed.success) {
          if (JSON.stringify(parsed.data) === JSON.stringify(applied)) void report.refetch();
          else setApplied(parsed.data);
        }
      }}>
        <label className="grid gap-1 text-xs">开始日期（北京时间）
          <input className={inputClass} type="date" required value={draft.from}
            onChange={event => setDraft({ ...draft, from: event.target.value })} />
        </label>
        <label className="grid gap-1 text-xs">结束日期（含当天）
          <input className={inputClass} type="date" required value={draft.through}
            onChange={event => setDraft({ ...draft, through: event.target.value })} />
        </label>
        <label className="grid gap-1 text-xs">来源
          <select className={inputClass} value={draft.platform ?? ""}
            onChange={event => setDraft({ ...draft, platform: (event.target.value || undefined) as ActivityWindow["platform"] })}>
            <option value="">全部来源</option>
            {ACTIVITY_PLATFORMS.map(value => <option key={value} value={value}>{platformLabels[value]}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs">账号分类
          <select className={inputClass} value={draft.category ?? ""}
            onChange={event => setDraft({ ...draft, category: (event.target.value || undefined) as ActivityWindow["category"] })}>
            <option value="">全部分类</option>
            {adminUserCategories.map(value => <option key={value} value={value}>{adminUserCategoryLabels[value]}</option>)}
          </select>
        </label>
        <button className={inputClass} type="submit" disabled={!parsed.success}>查询</button>
        <button className={inputClass} type="button" disabled={!data || report.isFetching || !!report.error || exportState === "loading"}
          onClick={() => void exportCsv()}>
          {exportState === "loading" ? "导出中…" : "导出当前汇总 CSV"}
        </button>
      </form>
      {!parsed.success && <p role="alert" className="text-xs text-destructive">请选择 1 至 30 个北京时间自然日。</p>}
      {exportState === "error" && <p role="alert" className="text-xs text-destructive">导出失败，请重试。</p>}
      {report.error ? <p role="alert" className="text-sm text-destructive">
        {report.error.data?.code === "PAYLOAD_TOO_LARGE" ? "事件超过查询上限，请缩小窗口或筛选范围。" : "创作漏斗暂不可用，请核对数据源与日期。"}
      </p> : !data ? <p role="status" className="text-sm">正在读取创作漏斗…</p> : <>
        <p className="text-xs text-muted-foreground">
          {data.from} 至 {data.through} · 北京时间 · 观察截至 {data.observedThrough.replace("T", " ")} · 当前采集{data.enabled ? "开启" : "关闭"}。
          {data.firstRecordedAt ? ` 最早记录 ${data.firstRecordedAt.replace("T", " ")}。` : " 目前没有可查询的采集记录。"}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[940px] text-left text-xs">
            <caption className="sr-only">按来源和账号分类统计的创作阶段</caption>
            <thead><tr className="border-b">
              {["来源", "当前分类", "进入账号", "进入后提交账号 / 率", "提交账号 / 尝试", "成功账号 / 尝试", "失败账号 / 尝试", "取消 / 超时 / 未知 / 无结论", "查看账号 / 尝试", "成功率"].map(label =>
                <th key={label} scope="col" className="px-2 py-2 font-medium">{label}</th>)}
            </tr></thead>
            <tbody>{data.rows.map(row => <tr key={row.platform + row.category} className="border-b tabular-nums">
              {[
                platformLabels[row.platform], adminUserCategoryLabels[row.category], row.enteredAccounts,
                `${row.enteredThenSubmittedAccounts} / ${rate(row.entryToSubmitAccountRate)}`,
                `${row.submittedAccounts} / ${row.submittedAttempts}`, `${row.succeededAccounts} / ${row.succeededAttempts}`,
                `${row.failedAccounts} / ${row.failedAttempts}`,
                `${row.cancelledAttempts} / ${row.timeoutAttempts} / ${row.unknownAttempts} / ${row.pendingAttempts}`,
                `${row.openedAccounts} / ${row.openedAttempts}`, rate(row.successAttemptRate),
              ].map((value, index) => <td key={index} className="px-2 py-2">{value}</td>)}
            </tr>)}</tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          进入转化跟随窗口内进入的同一浏览会话，按账号去重。生成和查看跟随窗口内提交的同一尝试。两组均观察至窗口结束后最多 30 天。
          成功率为成功尝试 ÷ 已记录提交尝试。查看来自明确的预览操作。历史来源无法归因，表中仅统计已采集事件。
        </p>
      </>}
    </section>
  );
}
