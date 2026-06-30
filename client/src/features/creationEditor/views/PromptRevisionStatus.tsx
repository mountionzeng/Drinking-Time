import * as React from "react";
import { CheckCircle2, History, Loader2 } from "lucide-react";
import type { PromptRevision } from "@shared/promptLineage";
import type { PromptLineageRowView } from "../promptLineage/viewModel";

type Props = {
  row: PromptLineageRowView | null;
  storyVersion: number;
  historyOpen?: boolean;
  historyItems?: PromptRevision[];
  historyLoading?: boolean;
  historyError?: string | null;
  onOpenHistory: () => void;
  onRestoreRevision: (revision: PromptRevision) => void;
};

const STATUS_LABELS: Record<PromptRevision["status"], string> = {
  candidate: "待确认",
  confirmed: "已确认",
  rejected: "已放弃",
};

export default function PromptRevisionStatus({
  row,
  storyVersion,
  historyOpen = false,
  historyItems = [],
  historyLoading = false,
  historyError = null,
  onOpenHistory,
  onRestoreRevision,
}: Props) {
  if (!row) return null;

  return (
    <section
      className="mb-3 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 py-2"
      data-testid="prompt-revision-status"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground">
              当前已确认 revision：rev #{row.revisionId}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {row.label} · 权重 {Math.round(row.weight * 100)}% ·
              故事提示词版本 v{storyVersion}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenHistory}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <History className="h-3.5 w-3.5" />
          {historyOpen ? "收起 revision 历史" : "查看 revision 历史"}
        </button>
      </div>

      {historyOpen ? (
        <div className="mt-2 border-t border-emerald-500/20 pt-2">
          {historyLoading ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              正在读取 revision 历史…
            </p>
          ) : historyError ? (
            <p className="text-xs text-destructive">{historyError}</p>
          ) : historyItems.length === 0 ? (
            <p className="text-xs text-muted-foreground">暂无 revision 历史。</p>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {historyItems.map(revision => {
                const current = revision.id === row.revisionId;
                return (
                  <button
                    key={revision.id}
                    type="button"
                    disabled={current || revision.status !== "confirmed"}
                    onClick={() => onRestoreRevision(revision)}
                    className="min-w-[148px] rounded-md border border-border bg-background px-2.5 py-2 text-left transition hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default disabled:opacity-65"
                  >
                    <p className="text-xs font-semibold text-foreground">
                      rev #{revision.id}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      权重 {Math.round(revision.weight * 100)}% ·{" "}
                      {STATUS_LABELS[revision.status]}
                    </p>
                    <p className="mt-1 text-[10px] font-medium text-primary">
                      {current ? "当前版本" : "恢复此版本"}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
