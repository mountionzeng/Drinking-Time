import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUiLanguage } from "@/features/uiLanguage/UiLanguage";
import { formatComputeQuote } from "@shared/computeMoney";
import type { ImageRetryOffer } from "../../../../../server/services/reviewedImageRetry";
import { storySpineStore } from "../spine/storySpine";
import { runChatImageEditBatch } from "../runChatImageEditBatch";

/** The click approves one priced output. Further requests only read this receipt. */
export function RetryImageButton({
  offer,
  disabled,
}: {
  offer: ImageRetryOffer;
  disabled?: boolean;
}) {
  const { language } = useUiLanguage();
  const en = language === "en";
  const utils = trpc.useUtils();
  const generate = trpc.storyAgent.generateForMobile.useMutation();
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { storyId, planMessageId, imageId, copy } = offer;
  const batchInput = { storyId, planMessageId };
  const quote = formatComputeQuote(offer.unitCny);
  async function retry() {
    if (locked.current || disabled) return;
    const scope = storySpineStore.getState();
    if (scope.activeStoryId !== storyId) return;
    const inScope = () => {
      const current = storySpineStore.getState();
      return (
        current.activeStoryId === storyId &&
        current.accountId === scope.accountId &&
        current.storyScopeEpoch === scope.storyScopeEpoch
      );
    };
    locked.current = true;
    setBusy(true);
    setError("");
    const read = () =>
      utils.client.storyAgent.chatImageEditBatch.query(batchInput);
    const update = (batch: Awaited<ReturnType<typeof read>>) => {
      if (!inScope()) return;
      utils.storyAgent.chatImageEditBatch.setData(batchInput, batch);
      void utils.storyAgent.warehouseImageAttempts.invalidate({ storyId });
      if (
        batch.items.some(
          item => item.requestId === offer.nextId && item.status === "done"
        )
      ) {
        void utils.storyAgent.storyMaterialState.invalidate({ storyId });
        void utils.storyAgent.storyImages.invalidate({ storyId });
        void utils.storyAgent.chatImageRevisions.invalidate({ storyId });
      }
    };
    try {
      const response = await generate.mutateAsync({
        storyId,
        imageEditPlanOutput: { planMessageId, imageId, copy },
        conversationShotId: offer.stableShotId,
        shotImageRequestId: offer.nextId,
        retryFailedImageRequestId: offer.failedId,
        costConfirmation: { accepted: true, estimatedCny: offer.unitCny },
      });
      if (!inScope()) return;
      const batch = await read();
      update(batch);
      const item = batch.items.find(row => row.requestId === offer.nextId);
      if (!item && response.status === "error") throw new Error(response.error);
      if (item?.recoverable)
        await runChatImageEditBatch(
          { ...batch, items: [item] },
          {
            active: inScope,
            read,
            update,
            recover: requestId =>
              utils.client.storyAgent.recoverStoryboardImage.mutate({
                storyId,
                requestId,
              }),
            submit: () => Promise.reject(new Error("Recovery only")),
            wait: () => new Promise(resolve => setTimeout(resolve, 2000)),
          },
          false
        );
    } catch (reason) {
      if (inScope()) {
        setError(
          reason instanceof Error
            ? reason.message
            : en
              ? "Checking this request."
              : "正在核对本次请求。"
        );
        void utils.storyAgent.chatImageEditBatch.invalidate(batchInput);
        void utils.storyAgent.warehouseImageAttempts.invalidate({ storyId });
      }
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => void retry()}
        title={
          en
            ? "Confirm the estimate and reuse the saved instructions and references"
            : "点击确认本次预估费用，沿用原要求、底图和参考图"
        }
        className="rounded bg-primary px-1.5 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-50"
      >
        {busy
          ? en
            ? "Submitting…"
            : "正在提交…"
          : en
            ? "Retry · " + quote.replace("算力", "credits")
            : "重新渲染 · " + quote}
      </button>
      {error && (
        <p role="alert" className="break-words text-[11px]">
          {error}
        </p>
      )}
    </>
  );
}
