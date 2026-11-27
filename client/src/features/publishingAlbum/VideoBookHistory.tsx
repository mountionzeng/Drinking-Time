import { useState } from "react";
import {
  ManuscriptComparison,
  type ComparisonChapter,
  trialComparisonLabel,
} from "./ManuscriptComparison";
import type { BookWorkflowState, ManuscriptKind } from "@shared/bookWorkflow";
import { writingModuleTexts } from "@shared/bookWritingStyle";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { requestNewVersion } from "@/features/publishingDraft/newVersionRequest";
export function VideoBookHistory({
  state,
  kind,
  storyId,
  accountId,
  working,
}: {
  state: BookWorkflowState;
  kind: ManuscriptKind;
  storyId: number;
  accountId?: number | null;
  working: ComparisonChapter[];
}) {
  const ui = useUiText();
  const [selectedId, select] = useState<string | null>(null);
  const attempts = [...state.conversions]
    .reverse()
    .filter(
      d =>
        d.source.kind === "video" && d.target === kind && d.status !== "adopted"
    );
  const versions = [...state.versions].reverse().filter(v => v.kind === kind);
  const trials = [...state.conversions]
    .reverse()
    .filter(
      d =>
        d.target === kind &&
        d.status === "review" &&
        d.chapters?.length &&
        d.source.kind !== "video"
    );
  const sourceName = (kind: string) =>
    kind === "video"
      ? ui("视频")
      : kind === "text"
        ? ui("文字版")
        : ui("分镜版");
  return (
    <div className="space-y-2" aria-label={ui("作品文字版本与生成记录")}>
      {versions.map(v => (
        <div key={v.id} className="relative rounded border p-2 text-xs">
          <button
            type="button"
            className="float-right ml-2 rounded border px-2 py-1"
            aria-label={
              ui("打开对比") + " · " + sourceName(v.kind) + " V" + v.number
            }
            onClick={() => select(v.id)}
          >
            {ui("打开对比")}
          </button>
          <details>
            <summary className="min-h-6 cursor-pointer py-1">
              {sourceName(v.kind)} V{v.number} · {v.author.name} ·{" "}
              {new Date(v.createdAt).toLocaleString()}
            </summary>
            <p className="mt-2">{v.summary}</p>
            {v.source && (
              <p>
                {ui("来源：{0} V{1}", [
                  sourceName(v.source.kind),
                  v.source.number,
                ])}
              </p>
            )}
            <div className="max-h-64 space-y-2 overflow-y-auto pt-2">
              {v.chapters.map((c, i) => (
                <section key={i}>
                  <h4>{c.title}</h4>
                  {writingModuleTexts(c.blocks.body, c.blocks.writingStyle).map(
                    (t, j) => (
                      <p className="whitespace-pre-wrap py-1" key={j}>
                        {t}
                      </p>
                    )
                  )}
                </section>
              ))}
            </div>
          </details>
        </div>
      ))}
      {trials.map(d => (
        <div
          key={d.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-xs"
        >
          <span>
            {trialComparisonLabel(d)} · {ui("已保存试稿")}
          </span>
          <button
            type="button"
            className="rounded border px-2 py-1"
            onClick={() => select(d.id)}
          >
            {ui("打开对比")}
          </button>
        </div>
      ))}
      {selectedId && (
        <ManuscriptComparison
          key={selectedId}
          selectedId={selectedId}
          kind={kind}
          state={state}
          working={working}
          close={() => select(null)}
        />
      )}
      {attempts.map(d => {
        const unknown =
          d.submissionUncertain ||
          /submission outcome unknown|reconciliation required/.test(
            d.error ?? ""
          );
        const status =
          d.status === "review"
            ? ui("文字预览 · 待采用")
            : d.status === "generating"
              ? ui("正在从视频整理文字…")
              : unknown
                ? ui("未生成文字 · 上次结果和费用待核对")
                : ui("文字生成未完成");
        return (
          <div key={d.id} className="rounded border p-2 text-xs">
            {d.status === "review" ? (
              <button
                className="underline underline-offset-2"
                onClick={() =>
                  requestNewVersion({
                    storyId,
                    accountId,
                    presentation: "text",
                    instruction: d.request,
                    videoTextMethod: d.videoTextMethod ?? "rewrite",
                  })
                }
              >
                {ui("查看文字预览 / View text preview")}
              </button>
            ) : (
              <p role="status">{status}</p>
            )}
            {d.status === "review" && (
              <p>
                {status}{" "}
                {Boolean(d.chapters?.length) && (
                  <button
                    type="button"
                    className="rounded border px-2 py-1"
                    onClick={() => select(d.id)}
                  >
                    {ui("打开对比")}
                  </button>
                )}
              </p>
            )}
            <p className="text-muted-foreground">
              {sourceName(d.source.kind)} V{d.source.number} · {d.author.name} ·{" "}
              {new Date(d.createdAt).toLocaleString()}
            </p>
            <p className="mt-1 text-muted-foreground">{d.request}</p>
          </div>
        );
      })}
    </div>
  );
}
