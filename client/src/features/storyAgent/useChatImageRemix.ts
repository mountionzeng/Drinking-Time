import { useCallback, useState } from "react";
import { toast } from "sonner";
import { estimateStoryboardMaskedEditCost } from "@shared/imageRenderCost";
import { readableRerenderError } from "@/features/creationEditor/rerender";
import { trpc } from "@/lib/trpc";
import { buildChatImageRemixRequest, type ChatImageRef } from "./chatImageRefs";
import { chatImageRefsStore, useChatImageRefs } from "./chatImageRefsStore";

export type ChatImageRemixDraft = {
  refs: ChatImageRef[];
  instruction: string;
  prompt: string;
  referenceImageUrl: string;
  referenceContextImageUrls: string[];
  estimatedCny: number;
};

export type ChatImageRemixResult = {
  imageId: number;
  imageUrl: string;
  instruction: string;
};

export type ChatImageRemixStatus =
  | "idle"
  | "confirming"
  | "generating"
  | "done"
  | "error";

export type ChatImageRemixController = {
  refs: ChatImageRef[];
  status: ChatImageRemixStatus;
  draft: ChatImageRemixDraft | null;
  result: ChatImageRemixResult | null;
  error: string | null;
  /** 把输入框里的话变成一张待确认的卡；返回 false 表示这句话不该走图生图。 */
  arm: (instruction: string) => boolean;
  confirm: () => Promise<void>;
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
  const [status, setStatus] = useState<ChatImageRemixStatus>("idle");
  const [draft, setDraft] = useState<ChatImageRemixDraft | null>(null);
  const [result, setResult] = useState<ChatImageRemixResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generateMut = trpc.storyAgent.generateForMobile.useMutation();
  const utils = trpc.useUtils();

  const arm = useCallback(
    (instruction: string) => {
      if (refs.length === 0) return false;
      if (storyId == null || storyId <= 0) {
        toast.error("先打开一个故事，再让聊聊改图");
        return false;
      }
      const request = buildChatImageRemixRequest({ refs, instruction });
      if ("error" in request) {
        toast.error(request.error);
        return false;
      }
      const estimate = estimateStoryboardMaskedEditCost();
      setError(null);
      setResult(null);
      setDraft({
        refs: [...refs],
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
    setDraft(null);
    setError(null);
    setStatus("idle");
  }, []);

  const dismissResult = useCallback(() => {
    setResult(null);
    setStatus("idle");
  }, []);

  const confirm = useCallback(async () => {
    if (!draft || storyId == null || status === "generating") return;
    setStatus("generating");
    setError(null);
    try {
      const response = await generateMut.mutateAsync({
        storyId,
        // 不带 shotNo：新图先落进素材仓库，拖到某一镜才算采用。
        prompt: draft.prompt,
        explicitInstruction: draft.instruction,
        remixEdit: true,
        referenceImageUrl: draft.referenceImageUrl,
        referenceContextImageUrls: draft.referenceContextImageUrls,
        imageProvider: "gpt-image",
        costConfirmation: { accepted: true, estimatedCny: draft.estimatedCny },
      });
      if (response.status !== "ok" || !response.imageId || !response.imageUrl) {
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
        imageId: response.imageId,
        imageUrl: response.imageUrl,
        instruction: draft.instruction,
      });
      setDraft(null);
      setStatus("done");
      // 新图已经在仓库里了，刷新一次让素材面板和时间轴看到同一行。
      void utils.storyAgent.storyMaterialState.invalidate({ storyId });
      chatImageRefsStore.getState().clear();
    } catch (err) {
      setError(readableRerenderError(err));
      setStatus("error");
    }
  }, [draft, generateMut, status, storyId, utils]);

  const removeRef = useCallback((imageId: number) => {
    chatImageRefsStore.getState().remove(imageId);
  }, []);

  const promoteRef = useCallback((imageId: number) => {
    chatImageRefsStore.getState().promote(imageId);
  }, []);

  return {
    refs,
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
