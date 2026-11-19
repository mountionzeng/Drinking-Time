import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { useUiLanguage, useUiText } from "@/features/uiLanguage/UiLanguage";
import { formatComputeQuote } from "@shared/computeMoney";
import { storySpineStore } from "@/features/storyAgent/spine/storySpine";
import type { WarehouseSelectedImage } from "./WarehouseImageSelection";
import type { FrameReviewVideoPlan } from "@shared/frameReviewVideo";

export function WarehouseVideoSequenceDialog({
  storyId,
  stableShotId,
  shotNo,
  images,
  reviewedPlan,
  onClose,
}: {
  storyId: number;
  stableShotId: string;
  shotNo: number;
  images: WarehouseSelectedImage[];
  reviewedPlan?: FrameReviewVideoPlan;
  onClose: () => void;
}) {
  const { language } = useUiLanguage();
  const ui = useUiText();
  const en = language === "en";
  const quoteMutation = trpc.warehouseVideoSequence.quote.useMutation();
  const submit = trpc.warehouseVideoSequence.submit.useMutation();
  const utils = trpc.useUtils();
  const [seconds, setSeconds] = useState(reviewedPlan?.segmentSeconds ?? 4);
  const [prompt, setPrompt] = useState(
    reviewedPlan?.prompt ?? (en
      ? "Move slowly and continuously through these images in the selected order. Preserve the scene, colors and objects; do not introduce new elements."
      : "按选图顺序缓慢、连续地衔接画面，保留已有场景、色彩、物体和美术风格，不新增元素。"),
  );
  const [quote, setQuote] = useState<Awaited<
    ReturnType<typeof quoteMutation.mutateAsync>
  > | null>(null);
  const [receipt, setReceipt] = useState<{
    id: number;
    status: string;
    videoUrl?: string | null;
    errorMessage?: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const alive = useRef(true);
  const epoch = useRef(storySpineStore.getState().storyScopeEpoch);
  const account = useRef(storySpineStore.getState().accountId);
  const loadEpoch = useRef(storySpineStore.getState().storyLoadEpoch);
  const locked = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const current = () =>
    alive.current &&
    storySpineStore.getState().accountId === account.current &&
    storySpineStore.getState().storyLoadEpoch === loadEpoch.current &&
    storySpineStore.getState().activeStoryId === storyId &&
    storySpineStore.getState().storyScopeEpoch === epoch.current;
  const invalidate = () => {
    void utils.storyAgent.storyMaterialState.invalidate({ storyId });
    void utils.storyAgent.storyVideoAssets.invalidate({ storyId });
  };
  const message = (id: number, phase: string, content: string) => {
    if (!current()) return;
    const key = `warehouse-video-${id}-${phase}`;
    storySpineStore
      .getState()
      .setMessages((rows) =>
        rows.some((row) => row.id === key)
          ? rows
          : [
              ...rows,
              {
                id: key,
                role: "assistant",
                content,
                timestamp: Date.now(),
                selectionQuote: {
                  sourceType: "shot",
                  sourceId: stableShotId,
                  storyId,
                  stableShotId,
                  shotNo,
                  selectedText: content,
                },
              },
            ],
      );
  };
  useEffect(() => {
    if (!receipt || !["submitted", "processing"].includes(receipt.status))
      return;
    let stopped = false,
      busy = false;
    const poll = async () => {
      if (stopped || busy) return;
      busy = true;
      try {
        const result = await utils.warehouseVideoSequence.status.fetch({
          storyId,
          requestId: requestId.current,
        });
        if (stopped || !current()) return;
        if (result.take) {
          setReceipt(result.take);
          invalidate();
        }
      } catch {
        /* Read-only refresh may retry; never resubmit generation. */
      } finally {
        busy = false;
      }
    };
    const timer = window.setInterval(() => void poll(), 5000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [receipt?.id, receipt?.status]);
  const prepare = async () => {
    if (locked.current || !current()) return;
    locked.current = true;
    setError(null);
    try {
      const result = await quoteMutation.mutateAsync({
        storyId,
        stableShotId,
        imageIds: images.map((i) => i.id),
        segmentSeconds: seconds,
        prompt,
        ...(reviewedPlan ? { review: reviewedPlan.review } : {}),
      });
      if (current()) setQuote(result);
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : "Quote failed");
    } finally {
      locked.current = false;
    }
  };
  const confirm = async () => {
    if (!quote || locked.current || receipt || !current()) return;
    locked.current = true;
    setError(null);
    try {
      const result = await submit.mutateAsync({
        ...quote.input,
        requestId: requestId.current,
        fingerprint: quote.fingerprint,
        costConfirmation: { accepted: true, estimatedCny: quote.totalCny },
      });
      invalidate();
      if (current()) {
        setReceipt(result.take);
        if (["submitted", "processing"].includes(result.take.status))
          message(
            result.takeId,
            "submitted",
            en
              ? `Shot ${shotNo}: ordered images ${images.map((i) => "#" + i.id).join(" → ")} submitted as video Take ${result.takeId}. The result will be saved in Warehouse.`
              : `第 ${String(shotNo).padStart(2, "0")} 镜：已按 ${images.map((i) => "#" + i.id).join(" → ")} 提交连续视频 Take ${result.takeId}，结果保存在仓库。`,
          );
      }
    } catch (e) {
      if (current())
        setError(
          (e instanceof Error ? e.message : "Submission failed") +
            (en
              ? " Keep this window to check the same request; do not start another purchase."
              : " 请保留本次窗口核对原请求，避免另起一次生成。"),
        );
    } finally {
      locked.current = false;
    }
  };
  const busy = quoteMutation.isPending || submit.isPending;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {en
              ? "Make one continuous shot"
              : "生成连续镜头 / Continuous video"}
          </DialogTitle>
          <DialogDescription>
            {en
              ? `Shot ${shotNo} · Images follow your selection order.`
              : `第 ${String(shotNo).padStart(2, "0")} 镜 · 图片按选择顺序衔接。`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2 overflow-x-auto">
          {images.map((image, i) => (
            <figure key={image.id} className="shrink-0 text-center text-xs">
              <img
                className="size-16 rounded object-contain"
                src={image.imageUrl}
                alt={`#${image.id}`}
              />
              <figcaption>
                {i + 1} · #{image.id}
              </figcaption>
            </figure>
          ))}
        </div>
        {!receipt && (
          <>
            <label className="text-xs">
              {en
                ? "Seconds per transition"
                : "每段秒数 / Seconds per transition"}
              <select
                disabled={busy || Boolean(reviewedPlan)}
                value={seconds}
                onChange={(e) => {
                  setSeconds(Number(e.target.value));
                  setQuote(null);
                }}
                className="ml-2 rounded border p-1"
              >
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <textarea
              aria-label={
                en ? "Video instructions" : "视频要求 / Video instructions"
              }
              disabled={busy}
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setQuote(null);
              }}
              rows={3}
              maxLength={700}
              className="w-full rounded border p-2 text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Vidu Q2 Turbo · 720p · 1:1 · {images.length - 1}{" "}
              {en ? "segments" : "段"} · {seconds * (images.length - 1)}s
            </p>
            {reviewedPlan && <p className="text-xs text-muted-foreground">
              {ui("来源 Take {0} · 保留{1}秒。关键帧生成无法保证逐帧复现原运镜，需审看新候选再决定是否采用；原视频、声音和字幕保留。",
                [reviewedPlan.sourceTakeId, reviewedPlan.sourceDurationSec])}
            </p>}
            {quote && (
              <p role="status" className="text-sm">
                {en ? "Total" : "总计"}{" "}
                {en
                  ? formatComputeQuote(quote.totalCny).replace(
                      "算力",
                      "compute",
                    )
                  : formatComputeQuote(quote.totalCny)}{" "}
                ·{" "}
                {en
                  ? "Includes uploads. Saved as a new candidate."
                  : "含图片上传，保存为新候选。"}
              </p>
            )}
            <button
              type="button"
              disabled={busy || !prompt.trim()}
              onClick={() => void (quote ? confirm() : prepare())}
              className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
            >
              {busy
                ? en
                  ? "Preparing…"
                  : "正在处理…"
                : quote
                  ? en
                    ? "Confirm generation"
                    : "确认生成 / Confirm"
                  : en
                    ? "Review cost"
                    : "查看算力 / Review cost"}
            </button>
          </>
        )}
        {receipt && (
          <div role="status" className="space-y-2 text-sm">
            <p>
              Take {receipt.id} ·{" "}
              {receipt.status === "available"
                ? en
                  ? "Saved in Warehouse"
                  : "已保存到仓库"
                : ["submitted", "processing"].includes(receipt.status)
                  ? en
                    ? "Generating; you can keep chatting."
                    : "正在生成，可以继续聊天。"
                  : receipt.errorMessage}
            </p>
            {receipt.videoUrl && (
              <video
                src={receipt.videoUrl}
                controls
                className="max-h-56 w-full rounded"
              />
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
