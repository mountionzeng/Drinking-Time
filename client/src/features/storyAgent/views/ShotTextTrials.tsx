import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatComputeQuote } from "@shared/computeMoney";
import type { ShotTextTrial } from "@shared/shotTextTrial";

function TrialQuote({
  storyId,
  row,
  refresh,
}: {
  storyId: number;
  row: ShotTextTrial;
  refresh(): void;
}) {
  const scope = { storyId, shotId: row.shotId, id: row.id };
  const quote = trpc.shotTextTrials.quote.useQuery(scope, { retry: false });
  const write = trpc.shotTextTrials.write.useMutation({
    retry: false,
    onSettled: refresh,
  });
  return (
    <div>
      {quote.data && (
        <button
          type="button"
          disabled={write.isPending || quote.isFetching}
          className="rounded border px-2 py-1"
          onClick={() =>
            quote.data &&
            write.mutate({
              ...scope,
              key: quote.data.key,
              estimatedCny: quote.data.estimatedCny,
              accepted: true,
            })
          }
        >
          {write.isPending
            ? "正在写稿…"
            : "确认写文字试稿 · 最多 " +
              formatComputeQuote(quote.data.estimatedCny)}
        </button>
      )}
      {quote.data && (
        <p>
          {quote.data.provider} / {quote.data.model} ·
          依据作者原话、作品原文和本镜原始材料；修订会沿用本镜拾光试稿
        </p>
      )}
      {(quote.error || write.error) && (
        <p role="alert">{(quote.error || write.error)?.message}</p>
      )}
    </div>
  );
}
export function ShotTextTrials({
  storyId,
  shotId,
  shotNo,
  requested,
  onClose,
}: {
  storyId: number;
  shotId: string;
  shotNo?: number;
  requested?: string;
  onClose(): void;
}) {
  const scope = { storyId, shotId };
  const list = trpc.shotTextTrials.list.useQuery(scope, {
    refetchOnMount: "always",
    refetchInterval: q =>
      q.state.data?.some(r => r.state === "writing") ? 5000 : false,
  });
  const utils = trpc.useUtils();
  const [retrySelection, setRetrySelection] = useState<{ from?: string; id: string }>();
  const retry = trpc.shotTextTrials.open.useMutation({
    retry: false,
    onSuccess: row => {
      setRetrySelection({ from: requested, id: row.id });
      refresh();
    },
  });
  const attach = trpc.shotTextTrials.attach.useMutation({ retry: false });
  const [source, setSource] = useState(""),
    [text, setText] = useState(""),
    [kind, setKind] = useState<"source" | "reference">("reference");
  const [error, setError] = useState("");
  const refresh = () => {
    void list.refetch();
    void utils.shotTextTrials.manuscript.invalidate({ storyId });
  };
  return (
    <section
      aria-label="镜头文字试稿"
      className="mx-2 max-h-[45vh] overflow-auto rounded border bg-background p-2 text-sm"
    >
      <div className="flex justify-between">
        <strong>
          {shotNo == null
            ? "镜头文字试稿"
            : "第 " + String(shotNo).padStart(2, "0") + " 镜 · 文字试稿"}
        </strong>
        <button type="button" onClick={onClose}>
          收起试稿
        </button>
      </div>
      {list.error && <p role="alert">{list.error.message}</p>}
      {[...(list.data ?? [])]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(row => (
          <details key={row.id} open={row.id === (retrySelection && retrySelection.from === requested ? retrySelection.id : requested) || undefined}>
            <summary>
              {row.source} ·{" "}
              {row.state === "source"
                ? "原始材料"
                : row.state === "reference"
                  ? "参考稿 · 未采用"
                  : row.state === "ready"
                    ? "文字试稿 · 未采用"
                    : row.state === "quoted"
                      ? "文字试稿 · 待确认费用"
                      : row.state === "writing"
                        ? "写稿已受理"
                        : "未取得完整试稿"}
            </summary>
            {row.request && (
              <p className="my-1 whitespace-pre-wrap break-words">
                {row.request}
              </p>
            )}
            {row.text && (
              <div
                data-testid="shot-trial-verbatim"
                className="my-2 whitespace-pre-wrap break-words"
              >
                {row.text}
              </div>
            )}
            {row.state === "failed" && (
              <div>
                <p>{row.attemptedProvider} {row.attemptedModel} {row.failureReason ?? "旧版记录未保存错误详情。"}</p>
                <button type="button" disabled={retry.isPending} onClick={() =>
                  retry.mutate({...scope, retry:true, failedId:row.id, id:crypto.randomUUID(), request:"重新报价"})}>
                  沿用原要求，查看替代报价
                </button>
                {retry.variables?.failedId === row.id && retry.error && <p role="alert">{retry.error.message}</p>}
              </div>
            )}
            {row.state === "quoted" && (
              <TrialQuote row={row} storyId={storyId} refresh={refresh} />
            )}
          </details>
        ))}
      <details>
        <summary>挂入文字资料</summary>
        <label>
          用途{" "}
          <select
            value={kind}
            onChange={e => setKind(e.target.value as typeof kind)}
          >
            <option value="reference">署名参考稿（独立写稿时排除）</option>
            <option value="source">原始材料（供写稿引用）</option>
          </select>
        </label>
        <label className="block">
          作者或出处{" "}
          <input
            value={source}
            maxLength={180}
            onChange={e => setSource(e.target.value)}
          />
        </label>
        <label className="block">
          全文{" "}
          <textarea
            className="w-full rounded border"
            value={text}
            rows={4}
            maxLength={60000}
            onChange={e => setText(e.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={attach.isPending || !source.trim() || !text.trim()}
          onClick={async () => {
            try {
              await attach.mutateAsync({
                ...scope,
                id: crypto.randomUUID(),
                source,
                text,
                kind,
              });
              setText("");
              setError("");
              await utils.shotTextTrials.quote.invalidate(scope);
              refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : "保存未完成");
            }
          }}
        >
          保存到本镜
        </button>
        {error && <p role="alert">{error}</p>}
      </details>
    </section>
  );
}
