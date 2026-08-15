import { useEffect, useMemo, useState } from "react";
import { Check, Clock3, Loader2, RefreshCcw, ShieldAlert, Tags } from "lucide-react";
import type {
  PublishingPlatformContextSnapshot,
  PublishingPlatformContextState,
  PublishingTrendPlatformId,
} from "@shared/publishingPlatformContext";
import { PUBLISHING_PLATFORM_REGISTRY } from "@shared/publishingDraft";

export type PublishingTrendPresentation = {
  label: string;
  detail: string;
  tone: "fresh" | "stale" | "neutral" | "unavailable";
};

export function publishingTrendSnapshotPresentation(
  snapshot: PublishingPlatformContextSnapshot | null,
  now = Date.now()
): PublishingTrendPresentation {
  if (!snapshot) {
    return {
      label: "尚未查看平台热点",
      detail: "只有你点击查看时才会请求；切平台、切版本和打开页面都不会自动调用。",
      tone: "neutral",
    };
  }
  // Provider failures are terminal for this snapshot. Check them before the
  // clock so a failed response cannot be misread as an ordinary stale cache.
  if (
    snapshot.status === "provider_error" ||
    snapshot.status === "unavailable" ||
    snapshot.status === "invalid_response" ||
    snapshot.capability === "unavailable"
  ) {
    return {
      label: "未获取到可验证的实时热点",
      detail: snapshot.message || "当前没有合格的授权来源，已选标签不会被清空。",
      tone: "unavailable",
    };
  }
  if (snapshot.status === "verified_fresh" && snapshot.expiresAt > now) {
    return {
      label: "可验证的实时热点",
      detail: `获取于 ${new Date(snapshot.fetchedAt).toLocaleString("zh-CN")}，有效至 ${new Date(snapshot.expiresAt).toLocaleString("zh-CN")}`,
      tone: "fresh",
    };
  }
  if (snapshot.status === "verified_stale" || snapshot.expiresAt <= now) {
    return {
      label: "来源可核验，但已过实时有效期",
      detail: "可以参考，不能再标成实时热门。点击刷新会重新核验来源。",
      tone: "stale",
    };
  }
  if (snapshot.status === "no_relevant") {
    return {
      label: "没有与当前稿件相关的热点",
      detail: "不会为了填满列表而补造标签；仍可选择普通内容标签。",
      tone: "neutral",
    };
  }
  return {
    label: "未获取到可验证的实时热点",
    detail: snapshot.message || "当前没有合格的授权来源，已选标签不会被清空。",
    tone: "unavailable",
  };
}

function toneClass(tone: PublishingTrendPresentation["tone"]): string {
  if (tone === "fresh") return "bg-emerald-500/10 text-emerald-700";
  if (tone === "stale") return "bg-amber-500/10 text-amber-700";
  if (tone === "unavailable") return "bg-rose-500/10 text-rose-700";
  return "bg-muted text-muted-foreground";
}

export function PublishingTrendTagPicker({
  platform,
  context,
  snapshot,
  busy,
  now = Date.now(),
  onRefresh,
  onSave,
}: {
  platform: PublishingTrendPlatformId;
  context: PublishingPlatformContextState;
  snapshot: PublishingPlatformContextSnapshot | null;
  busy: "refresh" | "save" | null;
  now?: number;
  onRefresh: () => void;
  onSave: (input: {
    snapshotId: string | null;
    candidateIds: string[];
    contentTags: string[];
  }) => void;
}) {
  const persistedSnapshot = snapshot && context.snapshots.some(
    candidate => candidate.snapshotId === snapshot.snapshotId
  )
    ? snapshot
    : null;
  const [candidateIds, setCandidateIds] = useState<string[]>([]);
  const [contentTags, setContentTags] = useState<string[]>([]);
  const presentation = publishingTrendSnapshotPresentation(snapshot, now);

  useEffect(() => {
    const selected = new Set(context.selectedTags);
    setCandidateIds(
      (snapshot?.candidates ?? [])
        .filter(candidate => selected.has(candidate.label))
        .map(candidate => candidate.id)
    );
    setContentTags(
      (snapshot?.contentSuggestions ?? []).filter(tag => selected.has(tag))
    );
  }, [context.revision, context.selectedSnapshotId, snapshot?.snapshotId]);

  const candidateLabels = useMemo(
    () => new Map((snapshot?.candidates ?? []).map(candidate => [candidate.id, candidate.label])),
    [snapshot?.candidates]
  );
  const selectedPreview = [
    ...candidateIds.map(id => candidateLabels.get(id)).filter(Boolean),
    ...contentTags,
  ] as string[];
  const toggle = (
    value: string,
    selected: string[],
    setSelected: (next: string[]) => void
  ) => {
    setSelected(
      selected.includes(value)
        ? selected.filter(item => item !== value)
        : [...selected, value].slice(0, 12)
    );
  };

  return (
    <section
      className="border-b border-[var(--panel-border)] px-5 py-4 sm:px-10"
      aria-label={`${PUBLISHING_PLATFORM_REGISTRY[platform].label}平台语境`}
      data-testid="publishing-trend-tag-picker"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-chat-brand text-sm text-foreground">
              平台语境与标签
            </h3>
            <span
              className={`rounded-full px-2 py-1 text-[10px] font-medium ${toneClass(presentation.tone)}`}
              role="status"
            >
              {presentation.label}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted-foreground">
            {presentation.detail}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={busy !== null}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-[var(--nayin-glow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 disabled:cursor-not-allowed disabled:opacity-45"
          style={{ borderColor: "var(--panel-border)" }}
          aria-label={`查看或刷新${PUBLISHING_PLATFORM_REGISTRY[platform].label}热点`}
        >
          {busy === "refresh" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCcw className="h-3.5 w-3.5" />
          )}
          {snapshot ? "刷新核验" : "查看热点"}
        </button>
      </div>

      {snapshot?.capability === "verified" ? (
        <div className="mt-3 grid gap-1 text-[10px] text-muted-foreground sm:grid-cols-2">
          <p className="inline-flex items-center gap-1.5">
            <Check className="h-3 w-3 text-emerald-600" />
            来源：{snapshot.providerLabel} · {snapshot.coverage}
          </p>
          <p className="inline-flex items-center gap-1.5">
            <Clock3 className="h-3 w-3" />
            授权：{snapshot.authorization.status === "official" ? "官方" : "合同授权"} · parser {snapshot.parserVersion}
          </p>
        </div>
      ) : snapshot ? (
        <p className="mt-3 inline-flex items-center gap-1.5 text-[10px] text-rose-700">
          <ShieldAlert className="h-3 w-3" />
          当前结果不会作为实时快照保存，也不会替换上次已选标签
        </p>
      ) : null}

      {(snapshot?.candidates.length ?? 0) > 0 ? (
        <fieldset className="mt-4">
          <legend className="text-[11px] font-medium text-foreground">
            来源候选 · 默认不勾选
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {snapshot!.candidates.map(candidate => (
              <label
                key={candidate.id}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] text-foreground transition-colors hover:bg-[var(--nayin-glow)]"
                style={{ borderColor: "var(--panel-border)" }}
              >
                <input
                  type="checkbox"
                  checked={candidateIds.includes(candidate.id)}
                  onChange={() => toggle(candidate.id, candidateIds, setCandidateIds)}
                  className="accent-[var(--nayin-accent)]"
                />
                {candidate.label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {(snapshot?.contentSuggestions.length ?? 0) > 0 ? (
        <fieldset className="mt-4">
          <legend className="text-[11px] font-medium text-foreground">
            普通内容标签 · 不冒充热门
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {snapshot!.contentSuggestions.map(tag => (
              <label
                key={tag}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50"
                style={{ borderColor: "var(--panel-border)" }}
              >
                <input
                  type="checkbox"
                  checked={contentTags.includes(tag)}
                  onChange={() => toggle(tag, contentTags, setContentTags)}
                  className="accent-[var(--nayin-accent)]"
                />
                {tag}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <p className="inline-flex min-w-0 flex-1 items-center gap-1.5 text-[10px] text-muted-foreground">
          <Tags className="h-3 w-3 shrink-0" />
          {selectedPreview.length > 0
            ? `准备保存：${selectedPreview.join("、")}`
            : context.selectedTags.length > 0
              ? `当前已保存：${context.selectedTags.join("、")}`
              : "尚未选择标签"}
        </p>
        <button
          type="button"
          onClick={() => onSave({
            snapshotId: persistedSnapshot?.snapshotId ?? null,
            candidateIds: persistedSnapshot ? candidateIds : [],
            contentTags,
          })}
          disabled={busy !== null || (!snapshot && context.selectedTags.length === 0)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--nayin-accent)] px-3 text-[11px] font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          保存所选标签
        </button>
      </div>
    </section>
  );
}
