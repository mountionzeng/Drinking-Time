import { appendVisualProductionBrief, motionBriefText, motionSyncReply, syncMotionFields, type MotionField } from "@shared/visualProductionChat";
import type { VisualProductionRequest } from "../visualProductionChatBridge";

export type ProductionShot = {
  stableShotId: string; shotNo: number; cueCode?: string | null;
  promptDraft?: string | null; videoPrompt?: string | null;
  imageIds: number[]; takeIds: number[];
  /** 画面动作、运镜、开始/结束画面等结构化字段（有值时视频以它们为准，忽略 videoPrompt）。 */
  motionFields?: Partial<Record<MotionField, string>>;
};
type Dependencies = {
  shots: ProductionShot[];
  selectedShotNo?: number | null;
  referenceImageIds?: number[];
  isCurrent: () => boolean;
  save: (shot: ProductionShot, field: "promptDraft" | "videoPrompt", value: string) => Promise<void>;
  /** 一次写入多个结构化字段（同一条修订）。没有提供时只写 videoPrompt，保持旧行为。 */
  saveFields?: (shot: ProductionShot, fields: Partial<Record<MotionField, string>>) => Promise<void>;
  render: (shot: ProductionShot, kind: "image" | "video", instruction: string, referenceImageIds?: number[]) => Promise<string>;
  adopt: (shot: ProductionShot, asset: { imageId?: number; takeId?: number; timeline: boolean }) => Promise<void>;
};

/** One conversation operation, scoped before writing or opening any paid dialog. */
export async function executeVisualProduction(request: VisualProductionRequest, deps: Dependencies): Promise<string> {
  const { intent, selection, instruction } = request;
  const sameCode = (code: string) => code.replace(/^SH/i, "").replace(/^0+/, "") || "0";
  const explicit = intent.shotCode
    ? deps.shots.find(s => sameCode(s.cueCode || String(s.shotNo)) === sameCode(intent.shotCode!))
    : undefined;
  const selected = selection?.stableShotId
    ? deps.shots.find(s => s.stableShotId === selection.stableShotId)
    : selection?.shotNo != null ? deps.shots.find(s => s.shotNo === selection.shotNo) : undefined;
  if (selection && !selected && !explicit) return "刚才的镜头选区已失效，请在对话里写明镜号；尚未修改或生成。";
  if (intent.shotCode && !explicit) return `找不到镜头 ${intent.shotCode}，请核对镜号；尚未修改或生成。`;
  const shot = explicit ?? selected ?? deps.shots.find(s => s.shotNo === deps.selectedShotNo);
  if (!shot) return "请先点一下要制作的镜头，或在对话里写明“第 02 镜”；尚未生成素材。";
  const targetSelection = selected?.stableShotId === shot.stableShotId ? selection : undefined;
  if (targetSelection?.imageId && !shot.imageIds.includes(targetSelection.imageId)) return "刚才选中的图片已移出本镜，请重新选择；尚未生成。";
  if (!deps.isCurrent()) return "已离开当前故事，本次操作停止。";
  if (request.referenceImageIds?.length && deps.referenceImageIds && request.referenceImageIds.some(id => !deps.referenceImageIds!.includes(id)))
    return "参考图已不可用或不属于当前故事，尚未修改要求或生成。";
  const label = shot.cueCode || String(shot.shotNo).padStart(2, "0");
  if (intent.kind === "adopt") {
    const imageId = intent.imageId ?? targetSelection?.imageId ?? undefined;
    const takeId = intent.takeId ?? targetSelection?.videoTakeId ?? undefined;
    if ((!imageId && !takeId) || (imageId && takeId)) return "请点选一张图片或一条视频，再说“采用这张”或“放入剪辑线”。";
    if (imageId && !shot.imageIds.includes(imageId) || takeId && !shot.takeIds.includes(takeId)) return "这份素材不属于当前镜头，尚未采用。";
    await deps.adopt(shot, { imageId, takeId, timeline: intent.timeline });
    return `${label} 已采用${imageId ? `图片 #${imageId}` : `视频 Take ${takeId}`}。${intent.timeline || takeId ? "已放入对应剪辑位置。" : "已显示在对应镜头。"}旧版本保留。${imageId ? "如需让全片沿用这张图的美术，可说“用图片 #" + imageId + " 作为美术基准”。" : ""}`;
  }
  const field = intent.briefField ?? (intent.kind === "video" ? "videoPrompt" : "promptDraft");
  // An explicitly rewritten motion brief replaces conflicting old choreography;
  // the existing field-version history retains the previous one.
  const value = intent.briefField ? instruction.trim() : appendVisualProductionBrief(shot[field], instruction);
  await deps.save(shot, field, value);
  // 视频要求同时写进「画面动作」并清掉 ChatCut 残留，否则首尾帧视频会继续用旧字段。
  const brief = field === "videoPrompt" ? motionBriefText(instruction) : null;
  const sync = brief && deps.saveFields && shot.motionFields ? syncMotionFields(shot.motionFields, brief) : null;
  if (sync) await deps.saveFields!(shot, sync.updates);
  const synced = sync ? motionSyncReply(sync) : "";
  if (!deps.isCurrent()) return "要求已保存到原故事；你已切换工作区，没有提交生成。";
  if (intent.kind === "brief") return field === "videoPrompt"
    ? `${label} 的视频要求已保存为新修订，包含这次对话的动作与变化节奏。${synced}尚未提交视频生成；可继续调整，或说“第 ${label} 镜生成视频”。`
    : `${label} 的画面要求已根据这次对话保存为新修订。可以继续补充参考图或美术方向，准备好后说“生成图片”；确定图片后，后续镜头会继承它的物体与色彩。`;
  const rendered = await deps.render({ ...shot, [field]: value, ...(sync ? { motionFields: { ...shot.motionFields, ...sync.updates } } : {}) }, intent.kind, instruction, request.referenceImageIds);
  return synced ? `${synced}\n${rendered}` : rendered;
}
