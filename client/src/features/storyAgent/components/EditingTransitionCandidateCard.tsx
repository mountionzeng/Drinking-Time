import {
  ArrowRight,
  Check,
  CheckCircle2,
  CircleAlert,
  Clapperboard,
  CircleDollarSign,
  Loader2,
  Pencil,
  RotateCcw,
  X,
} from "lucide-react";

export type EditingTransitionCandidateStatus =
  | "pending"
  | "generating"
  | "applied"
  | "rejected"
  | "failed";

export interface EditingTransitionCandidate {
  sourceShotNo: number | string;
  targetShotNo: number | string;
  firstImageUrl: string;
  lastImageUrl: string;
  instruction: string;
  prompt: string;
  durationSec: number;
  resolution: string;
  estimatedCredits: number;
  estimatedCny: number;
  status: EditingTransitionCandidateStatus;
  error?: string;
  retryable?: boolean;
}

export interface EditingTransitionCandidateCardProps {
  candidate: EditingTransitionCandidate;
  onConfirm: () => void | Promise<void>;
  onReject: () => void;
  onModify: () => void;
  busy?: boolean;
}

function formatShotNo(value: number | string): string {
  const normalized = String(value).trim();
  const legacy = /^SH0*(\d+)$/i.exec(normalized);
  if (legacy) return legacy[1].padStart(2, "0");
  const numeric = Number(normalized);
  if (Number.isFinite(numeric) && !/^0\d{3,}/.test(normalized)) {
    return String(numeric).padStart(2, "0");
  }
  return normalized;
}

function formatDuration(seconds: number): string {
  return Number.isInteger(seconds)
    ? `${seconds} 秒`
    : `${seconds.toFixed(1)} 秒`;
}

function formatCny(value: number): string {
  return value.toFixed(value < 1 ? 2 : 1);
}

function ActionButton({
  children,
  disabled,
  kind = "secondary",
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  kind?: "primary" | "secondary" | "quiet";
  onClick: () => void;
}) {
  const appearance =
    kind === "primary"
      ? "border-transparent bg-[var(--nayin-accent)] text-background hover:brightness-95"
      : kind === "quiet"
        ? "border-transparent bg-transparent text-muted-foreground hover:bg-muted/55 hover:text-foreground"
        : "border-[var(--panel-border)] bg-background/55 text-foreground hover:border-[var(--nayin-accent-dim)] hover:bg-[var(--nayin-glow)]";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-7 items-center justify-center gap-1 rounded-md border px-2 text-[10px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 disabled:cursor-not-allowed disabled:opacity-50 ${appearance}`}
    >
      {children}
    </button>
  );
}

function StatusNotice({
  candidate,
}: {
  candidate: EditingTransitionCandidate;
}) {
  if (candidate.status === "pending") {
    return (
      <div
        className="flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-[10px] leading-4"
        style={{
          background: "var(--nayin-glow)",
          borderColor: "var(--nayin-accent-dim)",
        }}
      >
        <CircleDollarSign className="mt-0.5 h-3 w-3 shrink-0 text-nayin-bright" />
        <span>
          预计 ¥{formatCny(candidate.estimatedCny)}；确认后才会提交 302
          并产生费用。
        </span>
      </div>
    );
  }

  if (candidate.status === "generating") {
    return (
      <div
        className="flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[10px] leading-4"
        style={{
          background: "var(--nayin-glow)",
          borderColor: "var(--nayin-accent-dim)",
        }}
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-nayin-bright" />
        <span>
          302 已提交，Vidu Q2 正在生成；完成后会自动插入两个镜头之间。
        </span>
      </div>
    );
  }

  if (candidate.status === "applied") {
    return (
      <div
        className="flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[10px] leading-4 text-nayin-bright"
        style={{
          background: "var(--nayin-glow)",
          borderColor: "var(--nayin-accent-dim)",
        }}
        role="status"
      >
        <CheckCircle2 className="h-3 w-3 shrink-0" />
        <span>转场已生成，并插入对应镜头位置。</span>
      </div>
    );
  }

  if (candidate.status === "failed") {
    return (
      <div
        className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[10px] leading-4 text-destructive"
        role="alert"
      >
        <div className="flex items-start gap-1.5">
          <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            {candidate.error?.trim() || "生成失败。你可以修改说明或重试。"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[10px] leading-4 text-muted-foreground"
      style={{ borderColor: "var(--panel-border)" }}
      role="status"
    >
      <X className="h-3 w-3 shrink-0" />
      <span>已取消，不会提交 302。</span>
    </div>
  );
}

export default function EditingTransitionCandidateCard({
  candidate,
  onConfirm,
  onReject,
  onModify,
  busy = false,
}: EditingTransitionCandidateCardProps) {
  const sourceLabel = formatShotNo(candidate.sourceShotNo);
  const targetLabel = formatShotNo(candidate.targetShotNo);
  const isLocked = busy || candidate.status === "generating";

  return (
    <article
      className="w-full overflow-hidden rounded-lg border text-foreground"
      style={{
        background: "var(--card)",
        borderColor: "var(--panel-border)",
      }}
      aria-label={`${sourceLabel} 到 ${targetLabel} 的转场确认`}
    >
      <header
        className="flex items-center justify-between gap-2 border-b px-2.5 py-2"
        style={{ borderColor: "var(--panel-border)" }}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--nayin-glow)] text-nayin-bright">
            <Clapperboard className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold leading-4">确认镜头衔接</p>
            <p className="truncate font-mono text-[9px] text-muted-foreground">
              {sourceLabel} → {targetLabel}
            </p>
          </div>
        </div>
        <span
          className="shrink-0 rounded-full border px-1.5 py-0.5 text-[8.5px] text-muted-foreground"
          style={{ borderColor: "var(--panel-border)" }}
        >
          Vidu Q2
        </span>
      </header>

      <div className="space-y-2 p-2.5">
        <div className="grid grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)] items-center gap-1.5">
          <figure
            className="relative min-w-0 overflow-hidden rounded-md border bg-muted/40"
            style={{ borderColor: "var(--panel-border)" }}
          >
            <img
              src={candidate.firstImageUrl}
              alt={`${sourceLabel} 前镜末帧`}
              className="aspect-square w-full object-cover"
              loading="lazy"
            />
            <figcaption className="absolute inset-x-0 bottom-0 bg-black/55 px-1.5 py-1 text-[8.5px] text-white">
              前镜末帧 · {sourceLabel}
            </figcaption>
          </figure>
          <span
            className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--nayin-glow)] text-nayin-bright"
            aria-hidden="true"
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </span>
          <figure
            className="relative min-w-0 overflow-hidden rounded-md border bg-muted/40"
            style={{ borderColor: "var(--panel-border)" }}
          >
            <img
              src={candidate.lastImageUrl}
              alt={`${targetLabel} 后镜首帧`}
              className="aspect-square w-full object-cover"
              loading="lazy"
            />
            <figcaption className="absolute inset-x-0 bottom-0 bg-black/55 px-1.5 py-1 text-[8.5px] text-white">
              后镜首帧 · {targetLabel}
            </figcaption>
          </figure>
        </div>

        <section aria-label="衔接说明">
          <p className="text-[8.5px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
            你的衔接说明
          </p>
          <p className="mt-0.5 whitespace-pre-wrap text-[11px] leading-[1.55] text-foreground/85">
            {candidate.instruction}
          </p>
        </section>

        <div className="flex flex-wrap items-center gap-1 text-[9px] text-muted-foreground">
          <span
            className="rounded border px-1.5 py-0.5"
            style={{ borderColor: "var(--panel-border)" }}
          >
            {formatDuration(candidate.durationSec)}
          </span>
          <span
            className="rounded border px-1.5 py-0.5"
            style={{ borderColor: "var(--panel-border)" }}
          >
            {candidate.resolution.toUpperCase()}
          </span>
          <span
            className="rounded border px-1.5 py-0.5"
            style={{ borderColor: "var(--panel-border)" }}
          >
            首尾帧转场
          </span>
        </div>

        {candidate.prompt.trim() ? (
          <details
            className="group rounded-md border px-2 py-1.5 text-[9px]"
            style={{ borderColor: "var(--panel-border)" }}
          >
            <summary className="cursor-pointer select-none text-muted-foreground outline-none transition hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35">
              查看生成约束
            </summary>
            <p className="mt-1 whitespace-pre-wrap leading-4 text-foreground/70">
              {candidate.prompt}
            </p>
          </details>
        ) : null}

        <StatusNotice candidate={candidate} />

        {candidate.status === "pending" ? (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <ActionButton
              kind="primary"
              disabled={isLocked}
              onClick={() => void onConfirm()}
            >
              {busy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              {busy ? "正在提交…" : "确认并生成"}
            </ActionButton>
            <ActionButton disabled={isLocked} onClick={onModify}>
              <Pencil className="h-3 w-3" />
              修改
            </ActionButton>
            <ActionButton kind="quiet" disabled={isLocked} onClick={onReject}>
              <X className="h-3 w-3" />
              取消
            </ActionButton>
          </div>
        ) : null}

        {candidate.status === "generating" ? (
          <ActionButton kind="primary" disabled onClick={() => undefined}>
            <Loader2 className="h-3 w-3 animate-spin" />
            正在生成并插入…
          </ActionButton>
        ) : null}

        {candidate.status === "failed" ? (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {candidate.retryable !== false ? (
              <ActionButton
                kind="primary"
                disabled={isLocked}
                onClick={() => void onConfirm()}
              >
                {busy ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RotateCcw className="h-3 w-3" />
                )}
                {busy ? "正在重试…" : "重试生成"}
              </ActionButton>
            ) : null}
            <ActionButton disabled={isLocked} onClick={onModify}>
              <Pencil className="h-3 w-3" />
              修改
            </ActionButton>
            <ActionButton kind="quiet" disabled={isLocked} onClick={onReject}>
              <X className="h-3 w-3" />
              取消
            </ActionButton>
          </div>
        ) : null}
      </div>
    </article>
  );
}
