import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatComputeQuote } from "@shared/computeMoney";
import { sceneLayoutText, type SceneAllowance, type SceneLayout } from "@shared/shotSceneDirection";
import { useUiText } from "@/features/uiLanguage/UiLanguage";

export function ShotScenePreparation({ storyId, stableShotId, shotNo, adjustment, disabled, compact, onReady }: {
  storyId: number; stableShotId: string; shotNo: number; adjustment: string; disabled: boolean; compact?: boolean;
  onReady(id: string, ready: boolean, allowance?: SceneAllowance): void;
}) {
  const scope = { storyId, stableShotId };
  const ui = useUiText();
  const basis = trpc.artSystems.sceneBasis.useQuery(scope, { retry: false });
  const utils = trpc.useUtils();
  const analyze = trpc.artSystems.sceneAnalyze.useMutation({ retry: false });
  const confirm = trpc.artSystems.sceneConfirm.useMutation({ retry: false });
  const [selection, setSelection] = useState<number | undefined>();
  const [draft, setDraft] = useState<string>();
  const [layout, setLayout] = useState<SceneLayout>();
  const [draftBasis, setDraftBasis] = useState("");
  const [error, setError] = useState("");
  const [usingSaved, setUsingSaved] = useState(true);
  const lock = useRef(false);
  const busy = disabled || analyze.isPending || confirm.isPending;
  const imageId = selection ?? basis.data?.defaultImageId ?? 0;
  const input = { ...scope, imageId: imageId || undefined, adjustment: adjustment.trim() || undefined };
  const quote = trpc.artSystems.sceneQuote.useQuery(input, { enabled: !!basis.data && (!usingSaved || !basis.data.confirmed), retry: false,
    refetchInterval: q => q.state.data?.pending ? 6000 : false });
  const ready = Boolean(usingSaved && basis.data?.confirmed && draft === undefined);
  const offer = !ready && draft === undefined && !analyze.isPending && !confirm.isPending && quote.isSuccess && !quote.isFetching && !quote.data.pending && quote.data;
  const quoteKey = offer ? offer.key : undefined, readingCny = offer ? offer.estimatedCny : 0;
  useEffect(() => { onReady(stableShotId, ready || !!quoteKey, quoteKey ? { stableShotId, key: quoteKey, estimatedCny: readingCny,
    imageId: imageId || undefined } : undefined); }, [onReady, stableShotId, ready, quoteKey, readingCny, imageId]);
  const current = basis.data;
  if (!current) return <p role="status">{basis.error?.message ?? ui("正在读取本镜画面要素…")}</p>;
  const edit = (text?: string) => { setUsingSaved(false); setDraft(text); setDraftBasis(current.basisKey); setError(""); };
  if (ready) return <details className="text-sm"><summary>{ui("第 {0} 镜 · 已确认画面调度", [shotNo])}</summary>
    <p className="whitespace-pre-wrap">{current.confirmed}</p>
    <button type="button" className="underline" disabled={busy} onClick={() => edit()}>{ui("重新识图或调整")}</button></details>;
  const value = draft ?? current.confirmed;
  const available = layout ?? quote.data?.layout;
  const title = ui("第 {0} 镜 · 出图前确认画面", [shotNo]);
  const controls = <fieldset aria-label={title} disabled={busy} className="space-y-2 rounded border p-2 text-sm">
    {!compact && <legend>{title}</legend>}
    <label className="block">{ui("构图来源")} <select value={imageId} onChange={e => { setSelection(Number(e.target.value)); setLayout(undefined); edit(); }}>
      <option value={0}>{ui("本镜分镜文字")}</option>
      {current.images.map(i => <option key={i.id} value={i.id}>{ui("本镜图片 #{0}", [i.id])}</option>)}
    </select></label>
    {imageId > 0 && <img className="max-h-24 rounded object-contain" src={current.images.find(i => i.id === imageId)?.url} alt={`待读取的本镜图片 #${imageId}`} />}
    {quote.data?.unfinished && <p role="status">{ui(quote.data.providerError === "insufficient_quota"
      ? "识图服务商额度不足。可手动填写本镜调度，或在服务额度恢复后再生成。"
      : quote.data.authFailed ? "上次识图请求被供应商拒绝。请联系站点管理员检查供应商令牌权限和额度。"
      : "上次分析未取得结果，可能已产生费用。重新分析会按本次报价计费。")}</p>}
    <button type="button" className="rounded border px-2 py-1" disabled={!quote.data || quote.isFetching || quote.data.pending} onClick={async () => {
      if (lock.current || !quote.data) return;
      lock.current = true;
      try {
        const result = await analyze.mutateAsync({ ...input, key: quote.data.key, estimatedCny: quote.data.estimatedCny, accepted: true });
        setLayout(result);
        edit(quote.data.cached && !quote.data.layout ? current.confirmed || current.source : sceneLayoutText(result));
        await basis.refetch();
        await quote.refetch();
      } catch (e) { setError(e instanceof Error ? e.message : "分析未完成"); await quote.refetch(); }
      finally { lock.current = false; }
    }}>{analyze.isPending || quote.data?.pending ? ui("正在分析…") : quote.data?.cached ? ui("查看上次分析") :
      ui(imageId ? "仅识别所选图" : "仅分析分镜") + (quote.data ? ui(" · 最多 {0}", [formatComputeQuote(quote.data.estimatedCny)]) : "")}</button>
    {offer && <p>{offer.cached ? ui("将复用首次分析，识图费用为零。") : imageId ?
      ui("生成时会将所选图交给识图服务，分析已计入下方总报价。") : ui("首次分镜分析已计入下方总报价。")}</p>}
    {(available?.observed || quote.data?.observed) && <p>{ui("原图所见")} · {available?.observed || quote.data?.observed}</p>}
    {!!available?.uncertain.length && <p>{ui("待核对")} · {available.uncertain.join("、")}</p>}
    <label className="block">{ui("本镜要画什么")}<textarea rows={3} maxLength={2600} value={value}
      placeholder={ui("人物数量与装束、谁在哪里、谁向谁做动作、必要物件")}
      className="mt-1 w-full rounded border bg-transparent p-2" onChange={e => edit(e.target.value)} /></label>
    {!value && current.source && <details><summary>{ui("查看本镜原文")}</summary><p className="whitespace-pre-wrap">{current.source}</p></details>}
    <button type="button" className="underline" onClick={async () => {
      if (lock.current) return;
      const text = (value || current.source).trim();
      if (!text || text.length > 2600) { setError("请在上方填写 1–2600 字的本镜要求。"); return; }
      lock.current = true;
      try {
        await confirm.mutateAsync({ ...scope, basisKey: draftBasis || current.basisKey, text });
        await Promise.all([basis.refetch(), utils.artSystems.previewArtBasis.invalidate({ storyId }), utils.storyAgent.bookModuleVisualBasis.invalidate({ storyId })]);
        setDraft(undefined); setUsingSaved(true); setError("");
      } catch (e) { setError(e instanceof Error ? e.message : "未能保存调度"); }
      finally { lock.current = false; }
    }}>{ui(value ? "确认本镜调度" : "直接沿用分镜原文")}</button>
    {(error || quote.error) && <p role="alert">{error || quote.error?.message}</p>}
  </fieldset>;
  return compact ? <details className="text-sm"><summary>{title}</summary>{controls}</details> : controls;
}
