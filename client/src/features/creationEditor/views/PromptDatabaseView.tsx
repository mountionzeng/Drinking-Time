import { History, Loader2 } from "lucide-react";
import type { PromptRevision } from "@shared/promptLineage";
import type { PromptOverride } from "../promptTable/types";
import type { PromptLineageRowView } from "../promptLineage/viewModel";
import PromptCellEditor from "./PromptCellEditor";

type Props = {
  rows: PromptLineageRowView[];
  disabled?: boolean;
  rerendering?: boolean;
  historyNodeId: number | null;
  historyItems: PromptRevision[];
  historyLoading?: boolean;
  historyError?: string | null;
  onOpenHistory: (row: PromptLineageRowView) => void;
  onPreviewChange: (
    row: PromptLineageRowView,
    override: PromptOverride,
  ) => Promise<void> | void;
  onRerender: (
    row: PromptLineageRowView,
    override: PromptOverride,
  ) => Promise<void> | void;
  onRestoreRevision: (
    row: PromptLineageRowView,
    revision: PromptRevision,
  ) => Promise<void> | void;
};

const SCOPE_LABELS = {
  story: "故事级",
  shot: "镜头级",
  modality: "媒介级",
} as const;

const MODALITY_LABELS = {
  shared: "共享",
  dialogue: "台词",
  image: "图片",
  video: "视频",
} as const;

function usageLabel(row: PromptLineageRowView) {
  if (row.usedBy.length === 0) return "暂未编译";
  return row.usedBy
    .map(modality => MODALITY_LABELS[modality])
    .join(" / ");
}

export default function PromptDatabaseView({
  rows,
  disabled = false,
  rerendering = false,
  historyNodeId,
  historyItems,
  historyLoading = false,
  historyError = null,
  onOpenHistory,
  onPreviewChange,
  onRerender,
  onRestoreRevision,
}: Props) {
  return (
    <div className="min-h-0 overflow-auto rounded-md border border-border">
      <table className="w-full min-w-[980px] border-collapse text-left text-sm">
        <thead className="sticky top-0 bg-muted/90 backdrop-blur">
          <tr>
            {["维度", "范围", "模态", "当前值", "来源", "当前编译", "历史"].map(label => (
              <th
                key={label}
                scope="col"
                className="border-b border-border px-3 py-2 text-xs font-semibold text-muted-foreground"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const historyOpen = historyNodeId === row.nodeId;
            return (
              <tr key={row.id} className="border-b border-border/70 align-top last:border-0">
                <td className="px-3 py-2">
                  <div className="font-medium text-foreground">{row.label}</div>
                  <div className="text-[11px] text-muted-foreground">{row.dimension}</div>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {SCOPE_LABELS[row.scope]}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {MODALITY_LABELS[row.modality]}
                </td>
                <td className="px-3 py-2">
                  <PromptCellEditor
                    row={row}
                    disabled={disabled}
                    rerendering={rerendering}
                    applyLabel="预览影响"
                    disableRerenderWhenDirty
                    onApply={override => onPreviewChange(row, override)}
                    onRerender={override => onRerender(row, override)}
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="inline-flex rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                    {row.source.label}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    rev #{row.revisionId}
                  </div>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {usageLabel(row)}
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onOpenHistory(row)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs text-muted-foreground transition hover:text-foreground"
                  >
                    <History className="h-3.5 w-3.5" />
                    查看历史
                  </button>
                  {historyOpen ? (
                    <div className="mt-2 space-y-2 rounded-md border border-border/70 bg-muted/20 p-2">
                      {historyLoading ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          正在加载历史…
                        </div>
                      ) : historyError ? (
                        <div className="text-xs text-destructive">{historyError}</div>
                      ) : historyItems.length === 0 ? (
                        <div className="text-xs text-muted-foreground">暂无更多历史。</div>
                      ) : (
                        historyItems.map(revision => (
                          <button
                            key={revision.id}
                            type="button"
                            onClick={() => void onRestoreRevision(row, revision)}
                            className="flex w-full flex-col items-start rounded-md border border-border bg-background px-2 py-2 text-left transition hover:border-primary/30 hover:bg-primary/5"
                          >
                            <span className="text-xs font-medium text-foreground">
                              rev #{revision.id}
                            </span>
                            <span className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                              {revision.content}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
