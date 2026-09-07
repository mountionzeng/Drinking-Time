import { useState } from "react";
import { Archive, Check, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { trpc } from "@/lib/trpc";

type InsightCard = {
  lineageKey: string;
  revision: number;
  text: string | null;
  category:
    | "fact"
    | "preference"
    | "relationship"
    | "goal"
    | "concern"
    | "reflection";
  origin: "user_stated" | "user_corrected" | "inferred";
  state: "active" | "archived" | "superseded" | "forgotten" | "unsupported";
  evidenceCount: number;
  earliestEvidenceOn: string | null;
};

const CATEGORY_LABELS: Record<InsightCard["category"], string> = {
  fact: "事实",
  preference: "偏好",
  relationship: "关系",
  goal: "阶段目标",
  concern: "近期牵挂",
  reflection: "感悟",
};

export default function PersonalMemoryInsightActions({
  insight,
  onChanged,
}: {
  insight: InsightCard;
  onChanged: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(insight.text ?? "");
  const archiveMut = trpc.personalMemory.archiveInsight.useMutation();
  const restoreMut = trpc.personalMemory.restoreInsight.useMutation();
  const forgetMut = trpc.personalMemory.forgetInsight.useMutation();
  const correctMut = trpc.personalMemory.correctInsight.useMutation();
  const pending =
    archiveMut.isPending ||
    restoreMut.isPending ||
    forgetMut.isPending ||
    correctMut.isPending;
  const mutationError =
    archiveMut.error ?? restoreMut.error ?? forgetMut.error ?? correctMut.error;

  const correct = async () => {
    const text = draft.trim();
    if (!text) return;
    await correctMut.mutateAsync({
      lineageKey: insight.lineageKey,
      category: insight.category,
      text,
      allowProactiveMention: true,
    });
    setEditing(false);
    await onChanged();
  };

  const forget = async () => {
    if (
      !window.confirm(
        "忘记会清除这条系统理解，并阻止旧依据再次生成同样理解；不会删除原聊天或作品。继续吗？"
      )
    ) {
      return;
    }
    await forgetMut.mutateAsync({ lineageKey: insight.lineageKey });
    await onChanged();
  };

  return (
    <article
      className="rounded-2xl border bg-background/75 p-4"
      style={{ borderColor: "var(--nayin-border)" }}
    >
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span className="rounded-full bg-[var(--muted)] px-2 py-1">
          {insight.origin === "inferred" ? "系统推断" : "用户确认"}
        </span>
        <span>{CATEGORY_LABELS[insight.category]}</span>
        <span>
          依据 {insight.earliestEvidenceOn ?? "当前"} 起的{" "}
          {insight.evidenceCount} 条记录
        </span>
      </div>
      {editing ? (
        <div className="mt-3">
          <label className="sr-only" htmlFor={`insight-${insight.lineageKey}`}>
            纠正系统理解
          </label>
          <textarea
            id={`insight-${insight.lineageKey}`}
            value={draft}
            maxLength={2000}
            onChange={event => setDraft(event.target.value)}
            className="min-h-24 w-full rounded-xl border bg-background p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-[var(--nayin-accent)]"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={correct}
              disabled={pending || !draft.trim()}
              className="inline-flex min-h-10 items-center gap-1 rounded-full bg-foreground px-4 text-xs text-background disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              保存纠正
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="inline-flex min-h-10 items-center gap-1 rounded-full border px-4 text-xs"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              取消
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm leading-6 text-foreground">
          {insight.text ?? "这条理解已不可显示"}
        </p>
      )}
      {!editing ? (
        <div className="mt-3 flex flex-wrap gap-2" aria-live="polite">
          {insight.state === "active" ? (
            <>
              <button
                type="button"
                onClick={() => setEditing(true)}
                disabled={pending}
                className="inline-flex min-h-10 items-center gap-1 rounded-full border px-3 text-xs"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                纠正
              </button>
              <button
                type="button"
                onClick={async () => {
                  await archiveMut.mutateAsync({
                    lineageKey: insight.lineageKey,
                  });
                  await onChanged();
                }}
                disabled={pending}
                className="inline-flex min-h-10 items-center gap-1 rounded-full border px-3 text-xs"
              >
                <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                暂不使用
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={async () => {
                await restoreMut.mutateAsync({
                  lineageKey: insight.lineageKey,
                });
                await onChanged();
              }}
              disabled={pending}
              className="inline-flex min-h-10 items-center gap-1 rounded-full border px-3 text-xs"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              恢复使用
            </button>
          )}
          <button
            type="button"
            onClick={forget}
            disabled={pending}
            className="inline-flex min-h-10 items-center gap-1 rounded-full border px-3 text-xs text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            忘记
          </button>
          {pending ? (
            <span className="self-center text-xs text-muted-foreground">
              正在保存…
            </span>
          ) : null}
          {mutationError ? (
            <span className="self-center text-xs text-destructive" role="alert">
              {mutationError.message}
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
