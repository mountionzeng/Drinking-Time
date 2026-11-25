import type { ShotTextTrial } from "@shared/shotTextTrial";
import { trpc } from "@/lib/trpc";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { BookFormattedText } from "./BookMathText";

type ManuscriptRow = ShotTextTrial & { shotNo: number };

const labels: Record<Exclude<ShotTextTrial["state"], "source">, string> = {
  ready: "文字试稿 · 未采用",
  reference: "参考稿 · 未采用",
  quoted: "等待确认写稿费用",
  writing: "正在写稿…",
  failed: "未取得完整试稿",
};

type EditAction = { onEdit?(id: string): void; busy?: boolean; hideEmpty?: boolean };

export function ShotManuscriptReader({ storyId, ...action }: { storyId: number } & EditAction) {
  const ui = useUiText();
  const query = trpc.shotTextTrials.manuscript.useQuery({ storyId }, {
    refetchOnMount: "always",
    refetchInterval: q => q.state.data?.some(row => row.state === "writing") ? 5000 : false,
  });
  if (query.error) return <p role="alert" className="text-sm text-destructive">{ui("镜头试稿读取失败。")} <button type="button" className="underline" onClick={() => void query.refetch()}>{ui("重试")}</button></p>;
  if (!query.data) return <p role="status" className="py-2 text-sm text-muted-foreground">{ui("正在读取镜头试稿…")}</p>;
  return <ManuscriptRows rows={query.data} {...action} />;
}

export function ManuscriptRows({ rows, onEdit, busy, hideEmpty }: { rows: readonly ManuscriptRow[] } & EditAction) {
  const ui = useUiText();
  const byShot = new Map<string, ManuscriptRow[]>();
  for (const row of rows) {
    if (row.state === "source") continue;
    const group = byShot.get(row.shotId);
    if (group) group.push(row);
    else byShot.set(row.shotId, [row]);
  }
  const groups = [...byShot.values()].sort((a, b) => a[0].shotNo - b[0].shotNo);
  if (!groups.length) return hideEmpty ? null : <p className="py-2 text-sm text-muted-foreground">{ui("在对话里说说想拍什么，写好的镜头稿会出现在这里。")}</p>;
  return <section aria-label={ui("镜头试稿")} className="min-w-0 divide-y divide-[var(--panel-border)]">
    {groups.map((group, index) => {
      group.sort((a, b) => b.createdAt - a.createdAt);
      const featured = group.find(row => row.state === "ready") ?? group.find(row => row.state === "reference");
      return <details key={group[0].shotId} open={index === 0} className="min-w-0 py-2">
        <summary className="cursor-pointer py-1 text-sm font-semibold">{ui("第 {0} 镜", [String(group[0].shotNo).padStart(2, "0")])}</summary>
        {group.map(row => row.state === "source" ? null : <details key={row.id} open={row.id === featured?.id} className="min-w-0 pt-1">
          <summary className="cursor-pointer py-1 text-xs text-muted-foreground">{row.source} · {ui(labels[row.state])} · <time dateTime={new Date(row.createdAt).toISOString()}>{new Date(row.createdAt).toLocaleString()}</time></summary>
          {row.state === "failed" && row.failureReason && <p role="status" className="text-sm">{[row.attemptedModel, row.failureReason].filter(Boolean).join(" · ")}</p>}
          {row.text ? <article className="max-w-3xl space-y-2 break-words py-2 text-sm leading-6">{row.text.trim().split(/\r?\n[\t ]*\r?\n+/).map((paragraph, i) =>
            <div key={i} className="whitespace-pre-wrap"><BookFormattedText text={paragraph} /></div>)}</article> :
            <p className="max-w-prose whitespace-pre-wrap break-words py-2 text-sm">{row.request}</p>}
          {onEdit && row.text && (row.state === "reference" || row.state === "ready") &&
            <button type="button" disabled={busy} className="py-1 text-xs underline underline-offset-4" onClick={() => onEdit(row.id)}>{ui("在正文中编辑")}</button>}
        </details>)}
      </details>;
    })}
  </section>;
}
