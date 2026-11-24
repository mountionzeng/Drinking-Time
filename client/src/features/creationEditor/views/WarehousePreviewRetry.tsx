import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { storySpineStore } from "@/features/storyAgent/spine/storySpine";
import { trpc } from "@/lib/trpc";
import { formatComputeQuote } from "@shared/computeMoney";
import { estimateStoryboardImageCost } from "@shared/imageRenderCost";
import type { WarehouseRenderJob } from "../warehouseRenderActivity";

export function WarehousePreviewRetry({ job, label, onClose, onReport }: {
  job: WarehouseRenderJob; label: string; onClose: () => void; onReport: () => void;
}) {
  const ui = useUiText();
  const { storyId, previewRetry } = job;
  const basis = trpc.artSystems.previewArtBasis.useQuery({ storyId }, { refetchOnMount: "always" });
  const plan = trpc.artSystems.previewRetryPlan.useMutation({ retry: false });
  const generate = trpc.storyAgent.generateForMobile.useMutation({ retry: false });
  const utils = trpc.useUtils();
  const [consent, setConsent] = useState<number>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const copyId = basis.data?.privateCover && (basis.data.needsCoverCopy || previewRetry?.referenceId === basis.data.coverImageId)
    ? basis.data.coverImageId : null;
  const price = estimateStoryboardImageCost().estimatedCny;
  async function submit() {
    const scope = storySpineStore.getState();
    if (locked.current || !previewRetry || scope.activeStoryId !== storyId || !basis.data || basis.isFetching || (copyId && consent !== copyId)) return;
    locked.current = true;
    setBusy(true); setError("");
    try {
      const batch = await plan.mutateAsync({ storyId, failedId: previewRetry.failedId, basisKey: basis.data.basisKey, coverCopyImageId: copyId ?? undefined });
      const current = storySpineStore.getState();
      if (!mounted.current || current.accountId !== scope.accountId || current.activeStoryId !== storyId || current.storyScopeEpoch !== scope.storyScopeEpoch) return;
      const [shot] = batch.shots;
      if (batch.estimatedCny !== price || batch.shots.length !== 1 || shot.stableShotId !== job.shotId)
        throw new Error(ui("镜头或报价已变化，请重新查看。"));
      const result = await generate.mutateAsync({ storyId, previewBatchId: batch.id, shotNo: shot.shotNo,
        conversationShotId: shot.stableShotId, shotImageRequestId: shot.requestId, costConfirmation: { accepted: true, estimatedCny: price } });
      if (result.status === "error" && !("providerTaskId" in result && result.providerTaskId)) throw new Error(result.error);
      if (mounted.current) onClose();
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : ui("请重新核对任务状态。"));
    } finally {
      await Promise.allSettled([utils.storyAgent.warehouseImageAttempts.invalidate({ storyId }), utils.artSystems.previewRead.invalidate({ storyId }),
        utils.storyAgent.storyMaterialState.invalidate({ storyId }), utils.artSystems.previewArtBasis.invalidate({ storyId })]);
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>{ui("重新渲染")} · {label}</DialogTitle>
        <DialogDescription>{ui("沿用原试图要求和当前镜头画风，生成 4 张候选。")}</DialogDescription></DialogHeader>
      {basis.data && <p className="text-sm">{basis.data.styleName}</p>}
      {copyId && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent === copyId} disabled={busy}
        onChange={e => setConsent(e.target.checked ? copyId : undefined)} />{ui("允许本轮发送封面 #{0} 的缩图给图片服务", [copyId])}</label>}
      {(error || basis.error) && <p role="alert" className="text-sm">{error || basis.error?.message} <button className="underline" onClick={onReport}>{ui("反馈问题")}</button></p>}
      <div className="flex justify-end gap-2"><button type="button" className="rounded-md border px-3 py-2 text-sm" disabled={busy} onClick={onClose}>{ui("取消")}</button>
        <button type="button" className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
          disabled={busy || basis.isFetching || !basis.data || Boolean(copyId && consent !== copyId)} onClick={() => void submit()}>
          {busy ? ui("正在提交…") : ui("确认重新渲染 · {0}", [formatComputeQuote(price).replace("算力", ui("算力"))])}</button></div>
    </DialogContent>
  </Dialog>;
}
