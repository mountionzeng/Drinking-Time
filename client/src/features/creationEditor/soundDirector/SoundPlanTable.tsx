import {
  Check,
  History,
  Loader2,
  Lock,
  Save,
  TriangleAlert,
  Waves,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { StorySoundPlanRow } from "@shared/storySoundPlan";
import type { StorySoundDirectorController } from "./useStorySoundDirector";

const KIND_LABEL = {
  dialogue: "对白",
  narration: "旁白",
  music: "配乐",
  ambience: "环境声",
  sfx: "音效",
} as const;

function frameTime(frame: number) {
  const seconds = frame / 30;
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function rowContent(row: StorySoundPlanRow) {
  return row.text ?? row.description ?? "";
}

function statusLabel(row: StorySoundPlanRow) {
  if (row.textOrigin === "ai_draft") return "AI 草稿 · 待确认";
  if (row.eligibility === "missing_voice") return "内容已确认 · 待选音色";
  if (row.eligibility === "eligible") return "内容已确认";
  return "需要补充";
}

export function SoundPlanTable({
  director,
}: {
  director: StorySoundDirectorController;
}) {
  const [viewVersionId, setViewVersionId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState<Record<string, string>>({});
  const session = director.session;
  const viewedVersion = useMemo(
    () =>
      director.versions.find(version => version.id === viewVersionId) ?? null,
    [director.versions, viewVersionId]
  );
  const workspaceRevision = session?.workspace.revision;
  useEffect(() => {
    setDraftText({});
  }, [viewVersionId, workspaceRevision]);
  if (!director.active || !session || !session.complete) return null;
  const rows = viewedVersion?.rows ?? session.workspace.rows;
  const readOnly = viewedVersion != null;
  const hasUnsavedContent =
    !readOnly &&
    rows.some(row => {
      const localValue = draftText[row.id];
      return (
        localValue !== undefined && localValue.trim() !== rowContent(row)
      );
    });
  const selectedCount = readOnly
    ? rows.length
    : rows.filter(row => session.workspace.selectionByRowId[row.id] !== false)
        .length;

  const saveContent = async (row: StorySoundPlanRow, value: string) => {
    const normalized = value.trim();
    if (!normalized || normalized === rowContent(row)) return;
    const saved = await director.editRow(
      row.id,
      row.kind === "dialogue" || row.kind === "narration"
        ? { text: normalized }
        : { description: normalized }
    );
    if (saved) {
      setDraftText(current => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
    }
  };

  return (
    <article
      className="w-full rounded-lg border bg-card text-foreground shadow-sm"
      style={{ borderColor: "var(--nayin-accent-dim)" }}
      aria-label="声音方案"
      data-testid="sound-plan-table"
    >
      <header
        className="border-b px-3 py-2.5"
        style={{ borderColor: "var(--panel-border)" }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[var(--nayin-glow)] p-1.5 text-nayin-bright">
            <Waves className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[12px] font-semibold">声音方案</h3>
            <p className="text-[9.5px] text-muted-foreground">
              {readOnly
                ? `正在查看 V${viewedVersion.versionNumber}`
                : "当前可编辑草稿"}{" "}
              · {selectedCount}/{rows.length} 项
            </p>
          </div>
          {!readOnly ? (
            <button
              type="button"
              onClick={() => void director.saveVersion()}
              disabled={director.pending || hasUnsavedContent}
              title={
                hasUnsavedContent
                  ? "请先离开正在编辑的内容，保存修改后再创建版本"
                  : undefined
              }
              className="inline-flex items-center gap-1 rounded-md bg-[var(--nayin-accent)] px-2.5 py-1.5 text-[10px] font-medium text-background disabled:opacity-45"
            >
              {director.pending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Save className="h-3 w-3" />
              )}
              保存新版本
            </button>
          ) : (
            <button
              type="button"
              onClick={async () => {
                if (await director.restoreVersion(viewedVersion.id)) {
                  setViewVersionId(null);
                  setDraftText({});
                }
              }}
              disabled={director.pending}
              className="inline-flex items-center gap-1 rounded-md bg-[var(--nayin-accent)] px-2.5 py-1.5 text-[10px] font-medium text-background disabled:opacity-45"
            >
              <History className="h-3 w-3" />
              基于此版本修改
            </button>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-1" aria-label="声音方案版本">
          <button
            type="button"
            onClick={() => setViewVersionId(null)}
            aria-pressed={!viewVersionId}
            className="rounded border border-border px-2 py-1 text-[9.5px] aria-pressed:border-[var(--nayin-accent)] aria-pressed:bg-[var(--nayin-glow)]"
          >
            当前草稿
          </button>
          {director.versions.map(version => (
            <button
              key={version.id}
              type="button"
              onClick={() => setViewVersionId(version.id)}
              aria-pressed={viewVersionId === version.id}
              className="rounded border border-border px-2 py-1 text-[9.5px] aria-pressed:border-[var(--nayin-accent)] aria-pressed:bg-[var(--nayin-glow)]"
            >
              V{version.versionNumber}
            </button>
          ))}
        </div>
      </header>

      <div
        role="table"
        aria-label={
          readOnly ? `声音方案 V${viewedVersion.versionNumber}` : "当前声音方案"
        }
        className="space-y-2.5 bg-muted/20 p-2.5"
      >
        {rows.map(row => {
          const content = draftText[row.id] ?? rowContent(row);
          const selected =
            readOnly || session.workspace.selectionByRowId[row.id] !== false;
          return (
            <div
              key={row.id}
              role="row"
              aria-label={`${KIND_LABEL[row.kind]} ${row.sceneId ?? frameTime(row.startFrame)}`}
              className="rounded-lg border border-border/80 bg-card p-2.5 text-[10px] shadow-[0_1px_0_rgba(65,80,55,0.04)]"
            >
              <div className="flex min-w-0 items-start gap-2">
                <input
                  type="checkbox"
                  aria-label={`选择${KIND_LABEL[row.kind]} ${row.sceneId ?? frameTime(row.startFrame)}`}
                  checked={selected}
                  disabled={readOnly || director.pending}
                  className="mt-1 shrink-0 accent-[var(--nayin-accent)]"
                  onChange={event =>
                    void director.setRowSelected(
                      row.id,
                      event.currentTarget.checked
                    )
                  }
                />
                <div role="cell" className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-[var(--nayin-glow)] px-2 py-0.5 font-semibold text-nayin-bright">
                      {KIND_LABEL[row.kind]}
                    </span>
                    <span className="text-muted-foreground">
                      {row.sceneId ? `${row.sceneId} · ` : ""}
                      {frameTime(row.startFrame)}–
                      {frameTime(row.startFrame + row.durationFrames)}
                    </span>
                  </div>
                  <p
                    className={`mt-1.5 text-[9.5px] ${
                      row.textOrigin === "ai_draft"
                        ? "text-amber-700"
                        : "text-muted-foreground"
                    }`}
                  >
                    {statusLabel(row)}
                  </p>
                </div>
              </div>

              <div role="cell" className="mt-2">
                <label
                  htmlFor={`sound-plan-content-${row.id}`}
                  className="mb-1 block text-[9px] font-medium text-muted-foreground"
                >
                  内容
                </label>
                <textarea
                  id={`sound-plan-content-${row.id}`}
                  value={content}
                  readOnly={readOnly}
                  rows={4}
                  aria-label={`${KIND_LABEL[row.kind]}内容`}
                  onChange={event =>
                    setDraftText(current => ({
                      ...current,
                      [row.id]: event.target.value,
                    }))
                  }
                  onBlur={() => {
                    // AI 草稿由下方明确确认一次性写入，避免 blur 保存与确认
                    // 同时争用同一个 workspace revision。
                    if (row.textOrigin !== "ai_draft") {
                      void saveContent(row, content);
                    }
                  }}
                  className="min-h-24 w-full resize-y overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background/50 px-2.5 py-2 text-[11px] leading-relaxed [field-sizing:content] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)] read-only:bg-transparent"
                />
                {row.textOrigin === "ai_draft" && !readOnly ? (
                  <button
                    type="button"
                    onClick={() =>
                      void director.confirmDraftText(row.id, content)
                    }
                    disabled={!content.trim() || director.pending}
                    className="mt-1 inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-1 text-[9.5px] font-medium text-amber-900 disabled:opacity-45"
                  >
                    <Check className="h-3 w-3" />
                    确认这句 AI 草稿
                  </button>
                ) : null}
              </div>

              <div
                role="cell"
                className="mt-2 grid gap-1.5 rounded-md bg-muted/45 p-2 text-muted-foreground"
              >
                <p>
                  <span className="font-medium text-foreground/75">表演要求：</span>
                  {row.performance.style || row.performance.emotion || "保持原意"}
                </p>
                <p>
                  <span className="font-medium text-foreground/75">音色：</span>
                  尚未选择
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <p className="px-3 py-5 text-center text-[10px] text-muted-foreground">
          故事证据不足，没有自动添加任何声音。仍可使用手动添加。
        </p>
      ) : null}
      <footer
        className="border-t px-3 py-3 text-[9.5px] leading-relaxed text-muted-foreground"
        style={{ borderColor: "var(--panel-border)" }}
      >
        <section
          aria-label="真实声音生成步骤"
          className="rounded-lg border border-[var(--nayin-accent-dim)] bg-[var(--nayin-glow)]/40 p-2.5"
        >
          <h4 className="text-[10.5px] font-semibold text-foreground">
            真实声音的下一步
          </h4>
          <ol className="mt-2 grid gap-1.5" aria-label="生成声音流程">
            {["选择音色", "获取报价", "确认生成"].map((step, index) => (
              <li key={step} className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--nayin-accent-dim)] bg-card text-[9px] font-semibold text-nayin-bright">
                  {index + 1}
                </span>
                <span className="font-medium text-foreground/80">{step}</span>
              </li>
            ))}
          </ol>
          <button
            type="button"
            disabled
            title="尚未核验豆包 TTS 权限、可用音色和价格版本"
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-muted/60 px-2.5 py-2 text-[10px] font-medium text-muted-foreground opacity-70"
          >
            <Lock className="h-3 w-3" />
            选择音色并生成
          </button>
          <p className="mt-1.5 text-[9px]">
            尚未核验豆包 TTS 权限、可用音色和价格版本，因此暂不开放真实生成。
          </p>
        </section>
        <p className="mt-2 flex items-start gap-1.5">
          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            当前只保存方案，不会调用豆包，也不会在这里产生费用。
          </span>
        </p>
        <button
          type="button"
          onClick={director.exit}
          className="mt-1.5 text-nayin-bright hover:underline"
        >
          结束声音导演，回到普通聊天
        </button>
      </footer>
    </article>
  );
}
