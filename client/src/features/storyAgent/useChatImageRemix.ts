import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { estimateStoryboardMaskedEditCost } from "@shared/imageRenderCost";
import { readableRerenderError } from "@/features/creationEditor/rerender";
import { trpc } from "@/lib/trpc";
import { buildChatImageRemixRequest, type ChatImageRef } from "./chatImageRefs";
import { chatImageRefsStore, useChatImageRefs } from "./chatImageRefsStore";

export type ChatImageRemixTarget = { stableShotId: string; shotNo: number; selectionImageId?: number | null };
type ChatImageRemixDraft = {
  target?: ChatImageRemixTarget;
  storyId: number;
  refs: ChatImageRef[];
  instruction: string;
  prompt: string;
  referenceImageUrl: string;
  referenceContextImageUrls: string[];
  estimatedCny: number;
};

type ChatImageRemixResult = {
  target?: ChatImageRemixTarget;
  sourceImageIds: number[];
  recovered?: boolean;
  imageId: number;
  imageUrl: string;
  instruction: string;
};

type ChatImageRemixStatus =
  | "idle"
  | "confirming"
  | "generating"
  | "done"
  | "error"
  | "pending";

export type ChatImageRemixController = {
  refs: ChatImageRef[];
  status: ChatImageRemixStatus;
  draft: ChatImageRemixDraft | null;
  result: ChatImageRemixResult | null;
  error: string | null;
  startedAt: number | null;
  restore: (quoteMessageId: string) => Promise<void>;
  /** 把输入框里的话变成一张待确认的卡；返回 false 表示这句话不该走图生图。 */
  arm: (instruction: string, refsOverride?: ChatImageRef[], target?: ChatImageRemixTarget) => boolean;
  confirm: (quoteMessageId?: string) => Promise<void>;
  recoveryQuoteId?: string | null;
  cancel: () => void;
  dismissResult: () => void;
  removeRef: (imageId: number) => void;
  promoteRef: (imageId: number) => void;
};

/**
 * 对话框图生图：篮子里的几张图 + 一句原话 → 一张新图。
 *
 * 付费任务一律先出确认卡，用户点过「确认生成」才提交 302 —— 和镜头衔接、
 * 故事版改图同一条规矩。生成结果不自动采用，只落进素材仓库等着被拖走
 * （功能账本 image-asset-history 的不变量：只有明确采用事件改变当前图片）。
 */
export function useChatImageRemix(
  storyId: number | null
): ChatImageRemixController {
  const refs = useChatImageRefs();
  const scope = useRef(storyId); scope.current = storyId;
  const running = useRef(false);
  const startedAt = useRef<number | null>(null);
  const restoring = useRef(false);
  const requestEpoch = useRef(0);
  const [status, setStatus] = useState<ChatImageRemixStatus>("idle");
  const [draft, setDraft] = useState<ChatImageRemixDraft | null>(null);
  const [result, setResult] = useState<ChatImageRemixResult | null>(null);
  const [recoveryQuoteId, setRecoveryQuoteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generateMut = trpc.storyAgent.generateForMobile.useMutation();
  const utils = trpc.useUtils();
  useEffect(() => { requestEpoch.current++; setRecoveryQuoteId(null); startedAt.current = null; setDraft(null); setResult(null); setError(null); setStatus("idle"); return () => { requestEpoch.current++; }; }, [storyId]);

  const arm = useCallback(
    (instruction: string, refsOverride?: ChatImageRef[], target?: ChatImageRemixTarget) => {
      if (running.current) return false;
      const requestRefs = refsOverride ?? refs;
      if (requestRefs.length === 0) return false;
      if (storyId == null || storyId <= 0) {
        toast.error("先打开一个故事，再让聊聊改图");
        return false;
      }
      const request = buildChatImageRemixRequest({
        refs: requestRefs,
        instruction,
      });
      if ("error" in request) {
        toast.error(request.error);
        return false;
      }
      const estimate = estimateStoryboardMaskedEditCost();
      requestEpoch.current++;
      setRecoveryQuoteId(null);
      setError(null);
      setResult(null);
      setDraft({
        storyId,
        target,
        refs: [...requestRefs],
        instruction: request.explicitInstruction,
        prompt: request.prompt,
        referenceImageUrl: request.referenceImageUrl,
        referenceContextImageUrls: request.referenceContextImageUrls,
        estimatedCny: estimate.estimatedCny,
      });
      setStatus("confirming");
      return true;
    },
    [refs, storyId]
  );

  const cancel = useCallback(() => {
    if (running.current) return;
    requestEpoch.current++;
    setDraft(null);
    setError(null);
    setStatus("idle");
  }, []);

  const dismissResult = useCallback(() => {
    setResult(null);
    setStatus("idle");
  }, []);

  // Short, query-only requests survive a dropped generation response. A bounded
  // watch leaves a recovery action rather than replaying the paid mutation.
  const followReceipt = useCallback(async (quoteMessageId: string, epoch: number) => {
    if (!storyId) return;
    const active = () => scope.current === storyId && requestEpoch.current === epoch;
    for (let attempt = 0; attempt < 12 && active(); attempt++) {
      const saved = await utils.client.storyAgent.recoverChatImageRemix.mutate({ storyId, quoteMessageId });
      if (!active()) return;
      if (!saved) return;
      setRecoveryQuoteId(quoteMessageId);
      if (!('pending' in saved)) {
        setResult({ ...saved, target: { stableShotId: saved.stableShotId, shotNo: saved.shotNo } });
        setStatus("done"); setDraft(null); setError(null);
        void utils.storyAgent.storyMaterialState.invalidate({ storyId });
        void utils.storyAgent.chatImageRevisions.invalidate({ storyId });
        return;
      }
      startedAt.current = saved.startedAt ?? startedAt.current ?? Date.now();
      setError(saved.recoverable ? "原任务已受理，正在取回结果；不会重新生成或重复购买。" : saved.error ?? "原任务仍在核对，请勿重复购买。");
      if (!saved.recoverable) { setStatus("pending"); return; }
      setStatus("generating");
      if (attempt < 11) await new Promise(resolve => setTimeout(resolve, 2000));
    }
    if (active()) { setStatus("pending"); setError("原任务尚未取回。可以继续取回或稍后刷新；不会重新生成或重复购买。"); }
  }, [storyId, utils]);

  const confirm = useCallback(async (quoteMessageId?: string) => {
    if (!draft || storyId == null || draft.storyId !== storyId || scope.current !== storyId || running.current || status === "generating") return;
    running.current = true;
    const epoch = requestEpoch.current;
    startedAt.current = Date.now();
    setStatus("generating");
    setError(null);
    try {
      const response = await generateMut.mutateAsync({
        storyId,
        ...(quoteMessageId ? { chatImageRemixQuoteId: quoteMessageId } : {}),
        conversationShotId: draft.target?.stableShotId,
        // 对话归属不采用、不修改当前图片或剪辑。
        prompt: draft.prompt,
        explicitInstruction: draft.instruction,
        remixEdit: true,
        referenceImageUrl: draft.referenceImageUrl,
        referenceContextImageUrls: draft.referenceContextImageUrls,
        imageProvider: "gpt-image",
        costConfirmation: { accepted: true, estimatedCny: draft.estimatedCny },
      });
      if (scope.current !== storyId || requestEpoch.current !== epoch) return;
      if (response.status !== "ok" || !response.imageId || !response.imageUrl) {
        if (quoteMessageId && ('providerTaskId' in response || 'submissionUncertain' in response || 'recoveryPending' in response)) {
          setRecoveryQuoteId(quoteMessageId);
          setStatus("pending");
          await followReceipt(quoteMessageId, epoch);
          return;
        }
        // 服务端把「已受理但回传失败」「连接中断无法确认」这类措辞放在 error 里，
        // 原样透出；只有裸的 fetch failed 才由 readableRerenderError 翻成
        // 「先查有没有新图再重试」，否则用户看到一句 fetch failed 就会再点一次付费。
        const message = readableRerenderError(
          ("error" in response && response.error) || "",
          "图片生成没有返回结果"
        );
        setError(message);
        setStatus("error");
        return;
      }
      setResult({
        target: draft.target,
        sourceImageIds: draft.refs.map(ref => ref.imageId),
        imageId: response.imageId,
        imageUrl: response.imageUrl,
        instruction: draft.instruction,
      });
      setDraft(null);
      setStatus("done");
      // 新图已经在仓库里了，刷新一次让素材面板和时间轴看到同一行。
      void utils.storyAgent.storyMaterialState.invalidate({ storyId });
      void utils.storyAgent.chatImageRevisions.invalidate({ storyId });
      chatImageRefsStore.getState().clear();
    } catch (err) {
      if (scope.current !== storyId || requestEpoch.current !== epoch) return;
      setError(readableRerenderError(err));
      if (quoteMessageId && /fetch|network|timeout|terminated|连接|断线/i.test(String(err))) {
        setRecoveryQuoteId(quoteMessageId); setStatus("pending");
        try { await followReceipt(quoteMessageId, epoch); } catch { /* retain the receipt; no paid retry */ }
      } else setStatus("error");
    } finally { running.current = false; }
  }, [draft, generateMut, status, storyId, utils, followReceipt]);

  const restore = useCallback(async (quoteMessageId: string) => {
    if (!storyId || result || running.current || restoring.current) return;
    restoring.current = true;
    const epoch = requestEpoch.current;
    try {
      await followReceipt(quoteMessageId, epoch);
    } catch (error) {
      if (scope.current === storyId && requestEpoch.current === epoch) { setError(readableRerenderError(error)); setRecoveryQuoteId(quoteMessageId); setStatus(/fetch|network|timeout|terminated|连接|断线/i.test(String(error)) ? "pending" : "error"); }
    } finally { restoring.current = false; }
  }, [storyId, result, followReceipt]);

  const removeRef = useCallback((imageId: number) => {
    chatImageRefsStore.getState().remove(imageId);
  }, []);

  const promoteRef = useCallback((imageId: number) => {
    chatImageRefsStore.getState().promote(imageId);
  }, []);

  return {
    refs,
    recoveryQuoteId,
    startedAt: startedAt.current,
    restore,
    status,
    draft,
    result,
    error,
    arm,
    confirm,
    cancel,
    dismissResult,
    removeRef,
    promoteRef,
  };
}
