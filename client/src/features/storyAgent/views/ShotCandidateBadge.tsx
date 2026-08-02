/**
 * 阶段 E：镜头卡片上的"N 条待确认"徽章——前四步（提示词表手改 / 划词编辑 /
 * 聊天提议 / 直接改镜头表字段）产生的候选，最终都在这里让用户看见、确认
 * 或放弃。没有候选时不渲染任何东西。
 *
 * 只负责展示和收集用户操作——具体的 confirmCandidate/rejectCandidate
 * 网络调用由调用方通过 onConfirm/onReject 提供，这个组件不直接碰 tRPC，
 * 方便脱离故事板单独测试。
 *
 * 列表内容拆成 ShotCandidateList，不含 Dialog/Portal——项目里的组件测试走
 * renderToStaticMarkup（无 DOM 的 node 环境），Radix 的 Dialog Portal 在
 * 那种环境下没法可靠断言内容；拆开后列表本身可以直接静态渲染测试，
 * Dialog 外壳只负责"要不要显示"，不需要单独测。
 */
import React, { useState } from "react";
import { CheckCircle2, Loader2, Sparkles, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ShotPendingCandidate } from "../shotCandidateSummary";

function preview(value: string, max = 120): string {
  const trimmed = value.trim();
  if (!trimmed) return "（空）";
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

export function ShotCandidateList({
  candidates,
  pendingRevisionId,
  onConfirm,
  onReject,
}: {
  candidates: ShotPendingCandidate[];
  pendingRevisionId: number | null;
  onConfirm: (candidate: ShotPendingCandidate) => void;
  onReject: (candidate: ShotPendingCandidate) => void;
}) {
  return (
    <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto py-1">
      {candidates.map(candidate => {
        const busy = pendingRevisionId === candidate.revisionId;
        return (
          <div
            key={candidate.revisionId}
            className="rounded-md border border-border p-3 text-xs"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-foreground">
                {candidate.label}
              </span>
              {candidate.attributionSummary ? (
                <span className="text-[10px] text-muted-foreground">
                  {candidate.attributionSummary}
                </span>
              ) : null}
            </div>
            <p className="mt-1.5 text-muted-foreground line-through decoration-muted-foreground/50">
              {preview(candidate.currentContent ?? "")}
            </p>
            <p className="mt-1 text-foreground">
              {preview(candidate.proposedContent)}
            </p>
            <div className="mt-2.5 flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => onReject(candidate)}
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <XCircle className="h-3.5 w-3.5" />
                )}
                放弃
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => onConfirm(candidate)}
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                确认
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function ShotCandidateBadge({
  shotLabel,
  candidates,
  onConfirm,
  onReject,
  compact = false,
}: {
  shotLabel: string;
  candidates: ShotPendingCandidate[];
  onConfirm: (candidate: ShotPendingCandidate) => Promise<void>;
  onReject: (candidate: ShotPendingCandidate) => Promise<void>;
  /**
   * 完整视图的镜头列只有 196px、动作行还挤着 5 个按钮——带文字的徽章会折行
   * 撑破 h-6 的行高。跟同一行的 AddShotButton / DeleteShotButton 一样，
   * compact 只显示图标 + 数字，完整措辞留在 aria-label 和 title 里。
   */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pendingRevisionId, setPendingRevisionId] = useState<number | null>(
    null
  );

  if (candidates.length === 0) return null;

  const act = async (
    candidate: ShotPendingCandidate,
    action: (candidate: ShotPendingCandidate) => Promise<void>
  ) => {
    setPendingRevisionId(candidate.revisionId);
    try {
      await action(candidate);
    } finally {
      setPendingRevisionId(null);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={event => {
          event.stopPropagation();
          setOpen(true);
        }}
        className={`inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-[var(--nayin-accent)]/15 font-semibold text-[var(--nayin-bright)] transition hover:bg-[var(--nayin-accent)]/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 ${
          compact ? "px-1.5 text-[9px]" : "px-2 text-[10px]"
        }`}
        aria-label={`${shotLabel} 有 ${candidates.length} 条待确认候选`}
        title={`${candidates.length} 条待确认候选`}
      >
        <Sparkles className="h-3 w-3 shrink-0" />
        {compact ? candidates.length : `${candidates.length} 待确认`}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{shotLabel} · 待确认候选</DialogTitle>
            <DialogDescription>
              这些是小酌或你之前的编辑提议的修改，确认后才会真正生效；放弃不会影响现有内容。
            </DialogDescription>
          </DialogHeader>
          <ShotCandidateList
            candidates={candidates}
            pendingRevisionId={pendingRevisionId}
            onConfirm={candidate => void act(candidate, onConfirm)}
            onReject={candidate => void act(candidate, onReject)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
