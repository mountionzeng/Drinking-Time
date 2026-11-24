import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatComputeQuote } from "@shared/computeMoney";
import { sceneLayoutText, type SceneAllowance, type SceneLayout } from "@shared/shotSceneDirection";
import { objectTargetsSchema, suggestObjectTargets } from "@shared/shotObjectTargets";
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
  const [targetText, setTargetText] = useState<string>();
  const [draft, setDraft] = useState<string>();
  const [layout, setLayout] = useState<SceneLayout>();
  const [draftBasis, setDraftBasis] = useState("");
  const [error, setError] = useState("");
  const [usingSaved, setUsingSaved] = useState(true);
  const lock = useRef(false);
  const busy = disabled || analyze.isPending || confirm.isPending;
  const imageId = selection ?? basis.data?.defaultImageId ?? 0;
  const targetsText = targetText ?? suggestObjectTargets([adjustment, basis.data?.source, basis.data?.facts, basis.data?.subject].filter(Boolean).join("\n"), basis.data?.subject).join("、");
  const localTargets = useMemo(() => imageId ? [...new Set(targetsText.split(/[、，,;；\n]/).map(t => t.trim()).filter(Boolean))] : undefined, [imageId, targetsText]);
  const targetsValid = !imageId || objectTargetsSchema.safeParse(localTargets).success;
  const input = { ...scope, imageId: imageId || undefined, adjustment: adjustment.trim() || undefined, localTargets };
  const quote = trpc.artSystems.sceneQuote.useQuery(input, { enabled: !!basis.data && targetsValid && (!!imageId || !usingSaved || !basis.data.confirmed), retry: false,
    refetchInterval: q => q.state.data?.pending ? 6000 : false });
  const ready = Boolean(usingSaved && !imageId && basis.data?.confirmed && draft === undefined);
  const offer = !ready && draft === undefined && !analyze.isPending && !confirm.isPending && quote.isSuccess && !quote.isFetching && !quote.data.pending && quote.data;
  const quoteKey = offer ? offer.key : undefined, readingCny = offer ? offer.estimatedCny : 0;
  useEffect(() => { onReady(stableShotId, ready || !!quoteKey, quoteKey ? { stableShotId, key: quoteKey, estimatedCny: readingCny,
    imageId: imageId || undefined, localTargets } : undefined); }, [onReady, stableShotId, ready, quoteKey, readingCny, imageId, localTargets]);
  const current = basis.data;
  if (!current) return <p role="status">{basis.error?.message ?? ui("正在读取本镜画面要素…")}</p>;
  const edit = (text?: string) => { setUsingSaved(false); setDraft(text); setDraftBasis(current.basisKey); setError(""); };
  if (ready) return <details className="text-sm"><summary>{ui("第 {0} 镜 · 已确认画面调度", [shotNo])}</summary>
    <p className="whitespace-pre-wrap">{current.confirmed}</p>
    <button type="button" className="underline" disabled={busy} onClick={() => edit()}>{ui("重新识图或调整")}</button></details>;
  const value = draft ?? current.confirmed;
  const available = imageId ? quote.data?.layout : layout ?? quote.data?.layout;
  const title = ui("第 {0} 镜 · 出图前确认画面", [shotNo]);
  const controls = <fieldset aria-label={title} disabled={busy} className="space-y-2 rounded border p-2 text-sm">
    {!compact && <legend>{title}</legend>}
    <label className="block">{ui("构图来源")} <select value={imageId} onChange={e => { setSelection(Number(e.target.value)); setLayout(undefined); edit(); }}>
      <option value={0}>{ui("本镜分镜文字")}</option>
      {current.images.map(i => <option key={i.id} value={i.id}>{ui("本镜图片 #{0}", [i.id])}</option>)}
    </select></label>
    {imageId > 0 && <>
      <label className="block">{ui("定位哪些物体")}<input value={targetsText} maxLength={520} placeholder={ui("用逗号分隔，可填写英文物体短语")}
        className="mt-1 w-full rounded border bg-transparent px-2 py-1" onChange={e => { setTargetText(e.target.value); setError(""); }} /></label>
      {!targetsValid && <p role="status">{ui("请填写 1 至 8 个物体，每个最多 64 字。")}</p>}
      <div className="relative inline-block max-w-full align-top">
        <img className="block max-h-48 max-w-full rounded" src={current.images.find(i => i.id === imageId)?.url} alt={`待读取的本镜图片 #${imageId}`} />
        {available?.regions?.flatMap(r => r.boxes.map(([x, y, right, bottom], i) =>
          <span key={r.label + ":" + i} aria-hidden className="pointer-events-none absolute border-2 border-amber-400"
            style={{ left: x*100+"%", top: y*100+"%", width: (right-x)*100+"%", height: (bottom-y)*100+"%" }}>
            <span className="absolute left-0 top-0 bg-black/75 px-1 text-xs text-white">{r.label}</span>
          </span>))}
      </div>
    </>}
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
        if (!imageId) edit(quote.data.cached && !quote.data.layout ? current.confirmed || current.source : sceneLayoutText(result));
        else setError("");
        await basis.refetch();
        await quote.refetch();
      } catch (e) { setError(e instanceof Error ? e.message : "分析未完成"); await quote.refetch(); }
      finally { lock.current = false; }
    }}>{analyze.isPending || quote.data?.pending ? ui("正在分析…") : quote.data?.cached ? ui("查看上次分析") :
      imageId ? ui("免费定位所选物体") : ui("仅分析分镜") + (quote.data ? ui(" · 最多 {0}", [formatComputeQuote(quote.data.estimatedCny)]) : "")}</button>
    {offer && <p>{offer.cached ? ui("将复用首次分析，识图费用为零。") : imageId ?
      ui("生成时自动定位一次，识别为 0 算力。也可以先查看候选位置。") : ui("首次分镜分析已计入下方总报价。")}</p>}
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
        if (imageId && !quote.data?.cached) setSelection(0);
      } catch (e) { setError(e instanceof Error ? e.message : "未能保存调度"); }
      finally { lock.current = false; }
    }}>{ui(value ? "确认本镜调度" : "直接沿用分镜原文")}</button>
    {(error || quote.error) && <p role="alert">{error || quote.error?.message}</p>}
  </fieldset>;
  return compact ? <details className="text-sm"><summary>{title}</summary>{controls}</details> : controls;
}
