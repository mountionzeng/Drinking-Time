import { trpc } from "@/lib/trpc";
import {
  colorTransferReply,
  parseColorTransferIntent,
  resolveColorTransferRefs,
} from "@shared/colorTransferIntent";
import {
  luminanceImageReply,
  luminanceVideoReply,
  parseLuminanceGradeIntent,
  type LuminanceRef,
  type LuminanceVideoReplyItem,
} from "@shared/luminanceGradeIntent";
import { parseRegionalGradeIntent, regionalGradeReply } from "@shared/regionalGradeIntent";
import { chatImageRefsStore } from "./chatImageRefsStore";
import { storySpineStore } from "./spine/storySpine";

type Selection = { imageId?: number | null; videoTakeId?: number | null; shotNo?: number | null } | null | undefined;
type Resolved = { imageId: number } | { shotNo: number };

/**
 * 对话里的免费本地调色，不报算力、不扣费、不读图：
 * - 「按图片 #2045 的亮度调图片 #2047」「视频 Take 1611 只调亮度」：只调亮度，色相、饱和度不变（图片出中档/全档两张候选）；
 * - 「按图一的颜色改图二图三」：按参考图套色，锁亮度。
 * 图1/图2… 按对话引用栏的顺序对应；图片 #编号、第 N 镜交给服务端核对。
 * 不是这两种句式就返回 null，照常走原来的流程（含付费报价）。
 */
export function useColorTransferChat() {
  const transfer = trpc.storyAgent.transferImageColor.useMutation();
  const gradeImage = trpc.storyAgent.gradeImageLuminance.useMutation();
  const gradeVideo = trpc.storyAgent.gradeVideoLuminance.useMutation();
  const gradeRegion = trpc.storyAgent.gradeVideoRegion.useMutation();
  const utils = trpc.useUtils();

  const refresh = async (storyId: number, scopeEpoch: number) => {
    const now = storySpineStore.getState();
    if (now.activeStoryId !== storyId || now.storyScopeEpoch !== scopeEpoch) return;
    await Promise.allSettled([
      utils.storyAgent.chatImageRevisions.invalidate({ storyId }),
      utils.storyAgent.storyImages.invalidate({ storyId }),
      // 新 Take 从素材状态和视频素材列表读出
      utils.storyAgent.storyMaterialState.invalidate({ storyId }),
      utils.storyAgent.storyVideoAssets.invalidate({ storyId }),
    ]);
  };

  return async (storyId: number, text: string, selection?: Selection) => {
    const basket = chatImageRefsStore.getState();
    const refs = basket.storyId === storyId ? basket.refs : [];
    const active = selection ?? (storySpineStore.getState().activeSelection as Selection);
    const scope = storySpineStore.getState().storyScopeEpoch;

    // 「后半段森林压暗一点点，突出纸飞机」：按时段、按对象的免费亮度微调，生成新 Take。
    const regional = parseRegionalGradeIntent(text);
    if (regional) {
      if (regional.kind === "ask") return { handled: true as const, reply: regional.question };
      const takeId = regional.takeId ?? (regional.shotNo == null ? active?.videoTakeId ?? undefined : undefined);
      const shotNo = regional.shotNo ?? (takeId ? undefined : active?.shotNo ?? undefined);
      if (!takeId && shotNo == null)
        return { handled: true as const, reply: "请先选中要调的那条视频，或说「视频 Take 编号」。还没有调整，也没有扣算力。" };
      try {
        const result = await gradeRegion.mutateAsync({ storyId, requestId: crypto.randomUUID(), subject: regional.subject, window: regional.window,
          deltaL: regional.deltaL, protectHighlights: true, instruction: text.trim().slice(0, 500), ...(takeId ? { takeId } : { shotNo }) });
        await refresh(storyId, scope);
        return { handled: true as const, reply: regionalGradeReply(result, regional.emphasizePlane) };
      } catch (error) {
        return { handled: true as const, reply: `这次视频调整没有完成：${error instanceof Error ? error.message : "请稍后再试"}。没有扣算力，原视频没有变化。` };
      }
    }

    const luminance = parseLuminanceGradeIntent(text);
    if (luminance) {
      if (luminance.kind === "ask") return { handled: true as const, reply: luminance.question };
      const notes: string[] = [];
      const resolve = (ref: LuminanceRef): Resolved | string => {
        if (ref.kind === "image") return { imageId: ref.imageId };
        if (ref.kind === "shot") return { shotNo: ref.shotNo };
        const item = refs[ref.index - 1];
        if (!item) return refs.length ? `对话引用栏里只有 ${refs.length} 张图，找不到图${ref.index}。` : `对话引用栏里还没有图，我不知道图${ref.index}指哪一张。`;
        notes.push(`图${ref.index}＝图片 #${item.imageId}`);
        return { imageId: item.imageId };
      };
      try {
        if (luminance.kind === "video") {
          let referenceImageId = luminance.referenceImageId;
          if (luminance.referenceOrdinal) {
            const reference = resolve({ kind: "ordinal", index: luminance.referenceOrdinal });
            if (typeof reference === "string") return { handled: true as const, reply: `${reference}还没有调整，也没有扣算力。` };
            referenceImageId = "imageId" in reference ? reference.imageId : undefined;
          }
          const takeId = luminance.takeId ?? (luminance.shotNo == null ? active?.videoTakeId ?? undefined : undefined);
          const shotNo = luminance.shotNo ?? (takeId ? undefined : active?.shotNo ?? undefined);
          if (!takeId && shotNo == null)
            return { handled: true as const, reply: "请说明要调哪条视频，例如「视频 Take 1611 只调亮度」或「第 3 镜的视频提亮」。还没有调整，也没有扣算力。" };
          const requestId = crypto.randomUUID();
          const items: LuminanceVideoReplyItem[] = [];
          const errors: string[] = [];
          for (const strength of luminance.strengths) {
            try {
              items.push(await gradeVideo.mutateAsync({ storyId, requestId, strength, ...(takeId ? { takeId } : { shotNo }), ...(referenceImageId ? { referenceImageId } : {}) }));
            } catch (error) {
              errors.push(error instanceof Error ? error.message : "视频亮度调整失败");
              break;
            }
          }
          await refresh(storyId, scope);
          return { handled: true as const, reply: luminanceVideoReply(items, errors) };
        }
        const reference = luminance.reference ? resolve(luminance.reference) : undefined;
        if (typeof reference === "string") return { handled: true as const, reply: `${reference}还没有调整，也没有扣算力。` };
        let targets: Resolved[] = [];
        for (const ref of luminance.targets) {
          const target = resolve(ref);
          if (typeof target === "string") return { handled: true as const, reply: `${target}还没有调整，也没有扣算力。` };
          targets.push(target);
        }
        // 没写调哪张：先用当前选中的图，再用引用栏里除参考图以外的图。
        if (!targets.length && active?.imageId) targets = [{ imageId: active.imageId }];
        if (!targets.length) targets = refs.filter(item => !(reference && "imageId" in reference && reference.imageId === item.imageId)).map(item => ({ imageId: item.imageId }));
        if (!targets.length)
          return { handled: true as const, reply: "要调哪张图？请点选图片，或写「图片 #编号」。还没有调整，也没有扣算力。" };
        const result = await gradeImage.mutateAsync({
          storyId, requestId: crypto.randomUUID(), instruction: text.trim().slice(0, 500),
          ...(reference ? { reference } : {}), targets: targets.slice(0, 8), strengths: luminance.strengths,
        });
        await refresh(storyId, scope);
        return { handled: true as const, reply: luminanceImageReply({ mapping: notes.join("，"), results: result.results }) };
      } catch (error) {
        return { handled: true as const, reply: `这次亮度调整没有完成：${error instanceof Error ? error.message : "请稍后再试"}。没有扣算力，原图和原视频都没有变化。` };
      }
    }

    const intent = parseColorTransferIntent(text);
    if (!intent) return null;
    if (intent.kind === "ask") return { handled: true as const, reply: intent.question };
    const resolution = resolveColorTransferRefs(intent, refs);
    if (!resolution.ok) return { handled: true as const, reply: resolution.question };
    try {
      const result = await transfer.mutateAsync({
        storyId,
        requestId: crypto.randomUUID(),
        instruction: text.trim().slice(0, 500),
        source: resolution.source,
        targets: resolution.targets,
      });
      await refresh(storyId, scope);
      return { handled: true as const, reply: colorTransferReply({ ...result, mapping: resolution.mapping }) };
    } catch (error) {
      return {
        handled: true as const,
        reply: `这次调色没有完成：${error instanceof Error ? error.message : "请稍后再试"}。没有扣算力，原图没有变化。`,
      };
    }
  };
}
