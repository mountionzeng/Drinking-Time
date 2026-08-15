import { useEffect, useState } from "react";
import { Check, GitBranch, Loader2, Pencil, Plus, X } from "lucide-react";
import {
  publishingNarrativePurposeLabel,
  type PublishingNarrativeIntent,
  type PublishingStoryVersion,
} from "@shared/publishingDraft";

export function publishingVersionLabel(version: PublishingStoryVersion): string {
  const sequenceLabel = `V${version.sequence}`;
  const name = version.displayName.trim();
  return !name || name.toLocaleLowerCase() === sequenceLabel.toLocaleLowerCase()
    ? sequenceLabel
    : `${sequenceLabel} · ${name}`;
}

export function publishingVersionNameError(value: string): string | null {
  const name = value.trim();
  if (!name) return "版本名称不能为空";
  if (Array.from(name).length > 80) return "版本名称不能超过 80 个字符";
  return null;
}

function intentSummary(intent: PublishingNarrativeIntent): string {
  return [
    publishingNarrativePurposeLabel(intent.primaryPurpose),
    intent.coreAudience.trim() || "观众待确认",
  ].join(" · ");
}

export function PublishingVersionControls({
  versions,
  activeVersionId,
  activeIntent,
  busy,
  loadingVersionId,
  canCreate,
  disabledReason,
  onSwitch,
  onRename,
  onCreate,
  onEditIntent,
}: {
  versions: PublishingStoryVersion[];
  activeVersionId: string;
  activeIntent: PublishingNarrativeIntent;
  busy: boolean;
  loadingVersionId?: string | null;
  canCreate: boolean;
  disabledReason?: string | null;
  onSwitch: (versionId: string) => void;
  onRename: (name: string) => Promise<void> | void;
  onCreate: (displayName?: string) => void;
  onEditIntent: () => void;
}) {
  const active = versions.find(version => version.versionId === activeVersionId);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(active?.displayName ?? "");
  const [createName, setCreateName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    setRenaming(false);
    setRenameDraft(active?.displayName ?? "");
    setNameError(null);
  }, [active?.displayName, activeVersionId]);

  const saveRename = async () => {
    const error = publishingVersionNameError(renameDraft);
    setNameError(error);
    if (error) return;
    try {
      await onRename(renameDraft.trim());
      setRenaming(false);
    } catch {
      // The owner reports the failure (usually with a toast); keep the editor
      // open so the user can retry without an unhandled Promise rejection.
    }
  };

  return (
    <section
      className="mt-3 space-y-2"
      aria-label="故事发布版本"
      data-testid="publishing-version-controls"
    >
      <div className="flex flex-wrap items-center gap-2">
        <GitBranch className="h-3.5 w-3.5 text-[var(--nayin-accent)]" />
        <select
          value={activeVersionId}
          onChange={event => onSwitch(event.target.value)}
          disabled={busy || versions.length < 2}
          className="h-8 max-w-52 rounded-md border bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-[var(--nayin-accent)]/25 disabled:opacity-60"
          style={{ borderColor: "var(--panel-border)" }}
          aria-label="选择发布版本"
        >
          {versions.map(version => (
            <option key={version.versionId} value={version.versionId}>
              {publishingVersionLabel(version)}
            </option>
          ))}
        </select>

        {renaming ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={renameDraft}
              onChange={event => {
                setRenameDraft(event.target.value);
                setNameError(null);
              }}
              onKeyDown={event => {
                if (event.key === "Enter") void saveRename();
                if (event.key === "Escape") setRenaming(false);
              }}
              disabled={busy}
              maxLength={80}
              className="h-8 w-40 rounded-md border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-[var(--nayin-accent)]/25"
              style={{ borderColor: "var(--panel-border)" }}
              aria-label="版本名称"
              aria-invalid={Boolean(nameError)}
            />
            <button
              type="button"
              onClick={() => void saveRename()}
              disabled={busy}
              className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--nayin-accent)] hover:bg-[var(--nayin-glow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 disabled:opacity-45"
              aria-label="保存版本名称"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setRenaming(false)}
              disabled={busy}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 disabled:opacity-45"
              aria-label="取消修改版本名称"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setRenaming(true)}
            disabled={busy || !active}
            className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 disabled:opacity-45"
            aria-label="重命名当前版本"
          >
            <Pencil className="h-3 w-3" />
            重命名
          </button>
        )}

        <button
          type="button"
          onClick={onEditIntent}
          disabled={busy || !canCreate}
          className="inline-flex h-8 max-w-[min(100%,20rem)] items-center gap-1.5 rounded-md border px-2 text-left text-[11px] text-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/25 disabled:cursor-not-allowed disabled:opacity-55"
          style={{ borderColor: "var(--panel-border)" }}
          aria-label="修改这版的用途和观众"
          title={disabledReason ?? "修改用途或观众会创建新版本，原版本不会改变"}
        >
          <span className="truncate">{intentSummary(activeIntent)}</span>
          <Pencil className="h-3 w-3 shrink-0 text-muted-foreground" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 pl-5">
        <input
          value={createName}
          onChange={event => setCreateName(event.target.value)}
          disabled={busy || !canCreate}
          placeholder={`新版本名称（可选，默认 V${Math.max(0, ...versions.map(version => version.sequence)) + 1}）`}
          maxLength={80}
          className="h-8 min-w-52 flex-1 rounded-md border bg-background px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-[var(--nayin-accent)]/25 disabled:opacity-60 sm:max-w-64"
          style={{ borderColor: "var(--panel-border)" }}
          aria-label="新版本名称"
        />
        <button
          type="button"
          onClick={() => {
            onCreate(createName.trim() || undefined);
            setCreateName("");
          }}
          disabled={busy || !canCreate}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-[var(--nayin-glow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 disabled:cursor-not-allowed disabled:opacity-45"
          style={{ borderColor: "var(--panel-border)" }}
          aria-label="新建发布版本"
          title={disabledReason ?? undefined}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          新建版本
        </button>
      </div>

      <p className="pl-5 text-[10px] text-muted-foreground">
        修改用途或观众会创建新版本，原版本不会改变。
      </p>

      {nameError ? (
        <p className="pl-5 text-[10px] text-destructive" role="alert">
          {nameError}
        </p>
      ) : null}
      {loadingVersionId ? (
        <p className="flex items-center gap-1.5 pl-5 text-[10px] text-muted-foreground" role="status">
          <Loader2 className="h-3 w-3 animate-spin" />
          正在切换到 {publishingVersionLabel(
            versions.find(version => version.versionId === loadingVersionId) ??
              ({ sequence: 0, displayName: "目标版本" } as PublishingStoryVersion)
          )}，旧版本内容不会暂时回显
        </p>
      ) : disabledReason ? (
        <p className="pl-5 text-[10px] text-muted-foreground">
          {disabledReason}
        </p>
      ) : null}
    </section>
  );
}
