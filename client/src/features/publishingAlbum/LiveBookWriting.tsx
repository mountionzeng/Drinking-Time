import { useIsMutating } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { useUiText } from "@/features/uiLanguage/UiLanguage";

type Draft = RouterOutputs["bookWorkflow"]["liveWriting"][number];

function DraftText({ draft }: { draft: Draft }) {
  const ui = useUiText();
  const viewport = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const shotCount = draft.shotNo ?? draft.lines.filter(line=>line.format==="shot").at(-1)?.number ?? draft.lines.filter(line => line.format === "shot").length;
  const status = draft.complete ? ui("已生成 · 待确认") : shotCount
    ? ui("正在写第 {0} 镜", [String(shotCount).padStart(2, "0")]) : ui(draft.lines.length ? "正在写正文" : "等待正文…");
  useEffect(() => {
    const el = viewport.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [draft.lines]);
  let number = 0;
  return <section aria-label={ui("正在撰写的稿件")} className="border-l-2 border-[var(--nayin-accent)] py-1 pl-4">
    <p role="status" className="mb-2 text-sm font-medium text-[var(--nayin-accent)]">{status}</p>
    <div ref={viewport} tabIndex={0} onScroll={e => {
      const el = e.currentTarget; following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 36;
    }} className="max-h-[50vh] space-y-2 overflow-y-auto overscroll-contain pr-3">
      {draft.lines.map((line, i) => line.format === "shot"
        ? <h4 key={i} className="pt-2 font-semibold">{ui("第 {0} 镜", [String(line.number ?? ++number).padStart(2, "0")])}{line.text && " · "+line.text}</h4>
        : line.format === "title" ? <h3 key={i} className="font-semibold">{line.text}</h3>
        : <p key={i} className="whitespace-pre-wrap break-words leading-relaxed">{line.text}</p>)}
    </div>
  </section>;
}

/** Poll only while this story is writing. Changing stories discards the local reading position. */
export function LiveBookWriting({ storyId }: { storyId: number }) {
  const pending = useIsMutating({ predicate: m => {
    const variables = m.state.variables as { storyId?: number } | undefined;
    const path = m.options.mutationKey?.[0];
    const route = Array.isArray(path) ? path.join(".") : undefined;
    return variables?.storyId === storyId && (route === "bookWorkflow.generateFilm" || route === "bookWorkflow.convert" || route === "textDrafts.generate" || route === "shotTextTrials.write");
  } });
  const query = trpc.bookWorkflow.liveWriting.useQuery({ storyId }, {
    refetchOnMount: "always", refetchOnWindowFocus: "always", retry: false,
    refetchInterval: q => pending || q.state.data?.some(v => !v.complete) ? 650 : false,
  });
  const seen = useRef(new Set<string>());
  useEffect(() => {
    for (const job of query.data ?? []) if (!job.complete) seen.current.add(job.id);
  }, [query.data]);
  return <>{query.data?.filter(job => !job.complete || seen.current.has(job.id)).map(job => <DraftText key={job.id} draft={job} />)}</>;
}
