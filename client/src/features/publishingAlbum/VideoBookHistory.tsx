import type { BookWorkflowState, ManuscriptKind } from "@shared/bookWorkflow";
import { writingModuleTexts } from "@shared/bookWritingStyle";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { requestNewVersion } from "@/features/publishingDraft/newVersionRequest";
export function VideoBookHistory({
  state,
  kind,
  storyId,
  accountId,
}: {
  state: BookWorkflowState;
  kind: ManuscriptKind;
  storyId: number;
  accountId?: number | null;
}) {
  const ui = useUiText();
  const attempts = [...state.conversions]
    .reverse()
    .filter(
      d =>
        d.source.kind === "video" && d.target === kind && d.status !== "adopted"
    );
  const versions = [...state.versions].reverse().filter(v => v.kind === kind);
  const sourceName = (kind: string) =>
    kind === "video"
      ? ui("视频")
      : kind === "text"
        ? ui("文字版")
        : ui("分镜版");
  return (
    <div className="space-y-2" aria-label={ui("作品文字版本与生成记录")}>
      {versions.map(v => (
        <details className="rounded border p-2 text-xs" key={v.id}>
          <summary className="cursor-pointer">
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
      ))}
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
            {d.status === "review" && <p>{status}</p>}
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
