import { useUiText as useDesktopUiText } from "@/features/uiLanguage/UiLanguage";
import { trpc } from "@/lib/trpc";
import { PendingShotImageError } from "@shared/shotImageRender";
import { pollStoryboardImage } from "./pollStoryboardImage";
import { askMediaChatConfirmation, cancelMediaChatSession, hasMediaChatSession } from "../mediaChatSession";
import { formatComputeQuote } from "@shared/computeMoney";
import { toast } from "sonner";
import type { CreationEditorShot } from "@/features/creationEditor/types";
import { buildPromptTable } from "@/features/creationEditor/promptTable/buildPromptTable";
import type { PromptRow } from "@/features/creationEditor/promptTable/types";
import type { StoryMaterialState } from "@shared/storyMaterial";
import { STORYBOARD_IMAGE_CANDIDATE_COUNT, STORYBOARD_MASKED_EDIT_PROFILE, estimateStoryboardMaskedEditCost } from "@shared/imageRenderCost";
import {
  shotRenderReferenceOptions,
  selectedReferenceKeys,
} from "./ShotImageRenderControl";
import { storyboardExplicitImageInstruction } from "./storyboardReviewModel";
import { useState, useRef, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  quoteShotImages,
  requestsStrictReferenceFidelity,
  STRICT_REFERENCE_MJ_NOTICE,
  renderShotImageBatch,
  type ShotImageRenderSettings,
} from "@shared/shotImageRender";

type RecoveryOutcome = { status: "success" | "error" | "cancelled"; message: string; imageId?: number; imageUrl?: string };

/** Owns quote dialogs and cancellation for a story's image-render session. */
export function useShotImageRender(
  storyId: number | null | undefined,
  imageConfirmationScope: string
) {
  const _ui = useDesktopUiText();
  const recovery = trpc.storyAgent.recoverStoryboardImage.useMutation();
  const utils = trpc.useUtils();
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const activeRecoveries = useRef(new Map<string, { controller: AbortController; promise: Promise<RecoveryOutcome> }>());
  const followTask = (requestId: string): Promise<RecoveryOutcome> => {
    const active = activeRecoveries.current.get(requestId);
    if (active) return active.promise;
    if (!storyId) return Promise.resolve({ status: "cancelled", message: "已离开当前故事" });
    const scope = imageBatchScope.current;
    const controller = new AbortController();
    setImageRenderError(null);
    const notice = toast.loading("图片仍在生成，正在自动取回原任务，无需重复提交", { duration: Infinity });
    const promise = pollStoryboardImage(
      () => recovery.mutateAsync({ storyId, requestId }), controller.signal,
    ).then(async (result): Promise<RecoveryOutcome> => {
      if (scope !== imageBatchScope.current || result.status === "cancelled")
        return { status: "cancelled", message: "已离开当前故事" };
      if (result.status !== "ok") {
        const message = result.status === "error" ? result.error : "等待时间较长，原任务已保留。稍后可恢复原任务，不会重新提交生成。";
        setPendingRequestId(requestId);
        setImageRenderError(message);
        return { status: "error", message };
      }
      const refreshed = await Promise.allSettled([
        utils.storyAgent.storyImages.invalidate({ storyId }),
        utils.storyAgent.storyMaterialState.invalidate({ storyId }),
        utils.storyAgent.storyGet.invalidate({ id: storyId }),
        utils.storyAgent.pendingStoryboardImages.invalidate({ storyId }),
      ]);
      if (scope !== imageBatchScope.current) return { status: "cancelled", message: "已离开当前故事" };
      setPendingRequestId(current => current === requestId ? null : current);
      const message = `已取回 ${result.candidates.length} 张图片，已放入画面行和仓库`;
      toast.success(message);
      if (refreshed.some(item => item.status === "rejected")) toast.warning("图片已保存，页面刷新暂未完成，请稍后重新打开查看");
      return { status: "success", message, imageId: result.imageId, imageUrl: result.imageUrl };
    }).finally(() => {
      toast.dismiss(notice);
      if (activeRecoveries.current.get(requestId)?.controller === controller) activeRecoveries.current.delete(requestId);
    });
    activeRecoveries.current.set(requestId, { controller, promise });
    return promise;
  };
  const recover = () => {
    if (pendingRequestId) void followTask(pendingRequestId);
  };
  const [imageCostConfirmation, setImageCostConfirmation] = useState<
    string | null
  >(null);
  const [imageRenderError, setImageRenderError] = useState<string | null>(null);
  const imageCostResolver = useRef<((confirmed: boolean) => void) | null>(null);
  const settleImageCostConfirmation = useCallback((confirmed: boolean) => {
    const resolve = imageCostResolver.current;
    imageCostResolver.current = null;
    setImageCostConfirmation(null);
    resolve?.(confirmed);
  }, []);
  // Cancel a pending quote when its story/shot set disappears, including unmount.
  const imageBatchScope = useRef(0);
  useEffect(() => {
    setImageCostConfirmation(null);
    setImageRenderError(null);
    setPendingRequestId(null);
    return () => {
      if (storyId) cancelMediaChatSession(storyId);
      imageBatchScope.current += 1;
      activeRecoveries.current.forEach(task => task.controller.abort());
      activeRecoveries.current.clear();
      imageCostResolver.current?.(false);
      imageCostResolver.current = null;
    };
  }, [storyId, imageConfirmationScope]);
  const confirmImageCost = (message: string, chatMessage = message) => {
    const conversation = storyId ? askMediaChatConfirmation({ storyId, text: chatMessage, kind: "cost" }) : null;
    if (conversation) return conversation;
    return new Promise<boolean>(resolve => {
      imageCostResolver.current?.(false);
      imageCostResolver.current = resolve;
      setImageCostConfirmation(message);
    });
  };

  const render = async (input: {
    label: string;
    revisionInstruction?: string;
    revisionProvider?: "midjourney" | "gpt-image";
    generationProvider?: "midjourney" | "gpt-image";
    /** A parent batch already confirmed the same one-task quote. */
    skipCostConfirmation?: boolean;
    settings: ShotImageRenderSettings;
    shot: CreationEditorShot;
    previousShots: CreationEditorShot[];
    material?: StoryMaterialState | null;
    canStart: () => boolean;
    start: () => void;
    finish: () => void;
    generate: (request: {
      shotNo: number;
      rows: PromptRow[];
      explicitInstruction: string;
      imageProvider: "midjourney" | "gpt-image";
      candidateCount?: 4;
      reference: { selection: ShotImageRenderSettings["references"]; referenceRevision?: boolean; conversationRevision?: boolean };
      costConfirmation: { accepted: true; estimatedCny: number };
    }) => Promise<{
      generatedCount: number;
      imageId?: number;
      imageUrl?: string;
    }>;
  }) => {
    setPendingRequestId(null);
    const scope = imageBatchScope.current;
    const { label, settings, shot, material } = input;
    if (storyId && !input.revisionInstruction?.trim()) {
      try {
        const pending = await utils.storyAgent.pendingStoryboardImages.fetch({ storyId });
        if (scope !== imageBatchScope.current) return { status: "cancelled" as const, message: "已离开当前故事" };
        const task = pending.find(t => t.shotIdentity === shot.stableShotId);
        if (task) {
          if (task.recoverable) {
            if (!input.canStart()) return { status: "cancelled" as const, message: "镜头正在渲染" };
            input.start();
            try { return await followTask(task.requestId); }
            finally { if (scope === imageBatchScope.current) input.finish(); }
          }
          const message = "原任务受理状态尚未确认，请联系支持核对，不要重新购买。";
          setImageRenderError(message);
          return { status: "error" as const, message };
        }
      } catch {
        if (scope !== imageBatchScope.current) return { status: "cancelled" as const, message: "已离开当前故事" };
        const message = "暂时无法核对原任务，请稍后再试；尚未提交新的生成请求。";
        setImageRenderError(message);
        return { status: "error" as const, message };
      }
    }
    const isRevision = Boolean(input.revisionInstruction?.trim());
    const conversationRevision = Boolean(isRevision && storyId && hasMediaChatSession(storyId));
    const provider = isRevision ? input.revisionProvider ?? "midjourney" : input.generationProvider ?? "midjourney";
    const isGptRevision = provider === "gpt-image";
    const choices = material ? shotRenderReferenceOptions(material) : [];
    const chosen = selectedReferenceKeys(settings.references).map(key =>
      choices.find(choice => choice.key === key)
    );
    const issue =
      !input.revisionInstruction?.trim() && !shot.promptDraft?.trim()
        ? "请先填写图片要求"
        : isRevision && (settings.references.imageIds.length !== 1 || Object.keys(settings.references.assets).length !== 0)
          ? "请选中一张要修改的图片"
        : !material || chosen.some(choice => !choice)
          ? "参考素材尚未加载或已失效，请重新选择参考"
          : null;
    if (issue) {
      if (!conversationRevision) setImageRenderError(issue);
      return { status: "error" as const, message: issue };
    }
    const names = chosen.map(choice => choice!.label);
    const instruction = input.revisionInstruction
      ? `以所选参考图片为基础生成新版，保留未要求修改的主体与画面内容。用户修改要求：\n${input.revisionInstruction}`
      : [storyboardExplicitImageInstruction(shot),
          settings.references.imagePurpose === "scene-style"
            ? "所选参考是本片已确定画面：沿用对应物体造型、线条、材质与色调，画面内容和构图按当前镜头要求。"
            : ""].filter(Boolean).join("\n");
    const rows = buildPromptTable(shot, { previousShots: input.previousShots });
    // Legacy saved settings may request eight; this entry always buys one task.
    const quote = isGptRevision ? estimateStoryboardMaskedEditCost() : quoteShotImages(STORYBOARD_IMAGE_CANDIDATE_COUNT);
    const estimatedCny = quote.estimatedCny;
    const fidelityNotice = !isGptRevision && names.length > 0 && requestsStrictReferenceFidelity(instruction)
      ? `${STRICT_REFERENCE_MJ_NOTICE}\n\n` : "";
    const confirmed = (!isRevision && input.skipCostConfirmation) || await confirmImageCost(
      `${label} · ${isGptRevision ? `重新生成图（${STORYBOARD_MASKED_EDIT_PROFILE.model}）` : isRevision ? "重新生成图（MJ）" : "生成4张图（MJ）"}\n${isRevision ? "原图" : "参考素材"}：${names.join("、") || "无"}\n\n${isRevision ? input.revisionInstruction : instruction}\n\n${fidelityNotice}${isGptRevision ? "按要求修改原图，返回1张新版；原图保留。\n" : isRevision ? "参考原图重绘4张候选，细节可能变化；原图保留。\n" : ""}预计费用 ${formatComputeQuote(estimatedCny).replace(/算力$/, _ui("算力"))}，最终以服务商实际扣费为准。`
    );
    if (!confirmed || scope !== imageBatchScope.current || !input.canStart())
      return { status: "cancelled" as const, message: "已取消，未提交生成" };
    input.start();
    try {
      const generate = async () => {
        if (scope !== imageBatchScope.current)
          throw new Error("已离开当前故事，未提交后续图片");
        const image = await input.generate({
          shotNo: shot.shotNo,
          rows,
          explicitInstruction: instruction,
          imageProvider: provider,
          candidateCount: isRevision || isGptRevision ? undefined : 4,
          reference: { selection: settings.references, ...(isRevision ? { referenceRevision: true, conversationRevision } : {}) },
          costConfirmation: { accepted: true, estimatedCny },
        });
        if (!image.imageId || !image.imageUrl)
          throw new Error("服务端未返回图片，停止后续生成");
        return image;
      };
      let batch;
      if (isGptRevision) {
        const result = await generate();
        batch = { results: [result], generatedCount: result.generatedCount, error: undefined };
      } else {
        batch = await renderShotImageBatch(quote.candidateCount, generate);
      }
      if (scope !== imageBatchScope.current)
        return {
          status: "cancelled" as const,
          message: "已离开当前故事，停止后续生成",
        };
      if (batch.error)
        throw new Error(
          `${label} 已生成 ${batch.generatedCount}/${quote.candidateCount} 张，剩余任务已停止。${batch.error}`
        );
      if (conversationRevision && storyId) await utils.storyAgent.chatImageRevisions.invalidate({ storyId });
      const message = isRevision
        ? conversationRevision ? `${label} 新图已在对话中展示。请回复“替换原图”或“保留原图”。` : `${label} 新图已放到上方图层，全部版本已保存在仓库`
        : `${label} 已生成 ${batch.generatedCount} 张图片，已放入画面行`;
      toast.success(message);
      const last = batch.results.at(-1);
      return {
        status: "success" as const,
        message,
        imageId: conversationRevision ? undefined : last?.imageId,
        imageUrl: conversationRevision ? undefined : last?.imageUrl,
      };
    } catch (cause) {
      if (scope !== imageBatchScope.current) return { status: "cancelled" as const, message: "已离开当前故事" };
      const message = cause instanceof Error ? cause.message : "图片生成失败";
      if (scope === imageBatchScope.current) {
        if (cause instanceof PendingShotImageError) {
          if (conversationRevision) {
            await utils.storyAgent.chatImageRevisions.invalidate({ storyId: storyId! });
            return { status: "success" as const, message: `${label} 图片任务已受理，完成后会显示在对话里。你可以继续发送其他内容；原图尚未替换。` };
          }
          return await followTask(cause.requestId);
        }
        if (!conversationRevision) setImageRenderError(message);
      }
      return { status: "error" as const, message };
    } finally {
      if (scope === imageBatchScope.current) input.finish();
    }
  };
  return {
    confirmImageCost,
    setImageRenderError,
    render,
    dialogs: (
      <>
        <Dialog
          open={imageCostConfirmation !== null}
          onOpenChange={open => {
            if (!open) settleImageCostConfirmation(false);
          }}
        >
          <DialogContent className="z-[160] max-w-lg">
            <DialogHeader>
              <DialogTitle>{_ui("确认生成所需算力")}</DialogTitle>
              <DialogDescription className="max-h-[55vh] overflow-y-auto whitespace-pre-wrap leading-6">
                {imageCostConfirmation}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <button
                type="button"
                className="rounded-md border px-4 py-2 text-sm"
                onClick={() => settleImageCostConfirmation(false)}
              >
                {_ui("取消")}
              </button>
              <button
                type="button"
                className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
                onClick={() => settleImageCostConfirmation(true)}
              >
                {_ui("确认费用并渲染")}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog
          open={imageRenderError !== null}
          onOpenChange={open => {
            if (!open) setImageRenderError(null);
          }}
        >
          <DialogContent className="z-[160] max-w-lg">
            <DialogHeader>
              <DialogTitle>{pendingRequestId ? "图片任务已受理，等待取回" : "图片渲染未完成"}</DialogTitle>
              <DialogDescription className="whitespace-pre-wrap">
                {imageRenderError}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <button
                type="button"
                className="rounded-md border px-4 py-2 text-sm"
                onClick={() => setImageRenderError(null)}
              >
                {_ui("知道了")}
              </button>
              {pendingRequestId && <button type="button" disabled={recovery.isPending} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground" onClick={recover}>
                {recovery.isPending ? "正在取回…" : "恢复原任务（不重复扣费）"}
              </button>}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    ),
  };
}
