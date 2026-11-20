import { inlineChatParts, inlineImageToken } from "@shared/inlineChatImages";
import type { ChatMessage } from "./types";
import type { ImageEditBatch } from "../../../../server/services/chatImageEditBatch";

const groupPrefix = "shot-keyframe:";
const resultPrefix = "saved-photos:keyframe-output:";

/** Record completed stills in their requested order even when receipts arrive out of order. */
export function collectKeyframeReview(messages: ChatMessage[], batch: ImageEditBatch, now: number): ChatMessage[] {
  const confirmed = messages.find(m => m.id === batch.planMessageId && m.selectionQuote?.storyId === batch.storyId && m.selectionQuote.stableShotId === batch.stableShotId);
  if (confirmed?.imageEditPlan?.keyframeBoardId) {
    const targets = confirmed.imageEditPlan.images.filter(i => i.role === "target");
    if (batch.renderRoute === "storyboard" || !targets.length || targets.length !== batch.items.length) return messages;
    const results = targets.map(target => batch.items.find(item => item.imageId === target.imageId && item.status === "done")?.result);
    if (results.some(result => !result)) return messages;
    const edited = new Map(targets.map((target, i) => [target.imageId, results[i]!.imageId]));
    const ids = confirmed.imageEditPlan.regionScanSourceId
      ? confirmed.imageEditPlan.images.map(image => edited.get(image.imageId) ?? image.imageId)
      : results.map(result => result!.imageId);
    const id = "saved-photos:keyframe-revision:" + ids.join("-");
    if (messages.some(m => m.id === id)) return messages;
    return [...messages, { id, role: "assistant", timestamp: now, selectionQuote: confirmed.selectionQuote,
      content: "关键帧修订稿（" + ids.length + " 张）\n" + ids.map((imageId, i) =>
        (i + 1) + "　" + inlineImageToken(imageId)).join("\n") + "\n点图可继续修改。" }];
  }
  const group = batch.planMessageId.match(/^(?:image-edit-(?:confirmed|adjusted):)+(shot-keyframe:[^:]+:)(\d+)$/);
  if (!group || batch.renderRoute === "storyboard" || batch.items.length !== 1) return messages;
  const item = batch.items[0];
  if (item.status !== "done" || !item.result) return messages;
  const belongs = (m: ChatMessage) => m.selectionQuote?.storyId === batch.storyId && m.selectionQuote?.stableShotId === batch.stableShotId;
  const planned = messages.filter(m => m.id.startsWith(group[1]) && belongs(m)).sort((a,b)=>Number(a.id.split(":").pop())-Number(b.id.split(":").pop()));
  const original = planned.find(m => m.id === group[1]+group[2]);
  if (!original || !planned.every((m,i)=>m.id===group[1]+i)) return messages;
  const id = resultPrefix + batch.planMessageId;
  const rows = messages.some(m => m.id === id) ? messages : [...messages,{
    id, role:"assistant" as const, selectionQuote:original.selectionQuote, timestamp:now,
    content:"第 "+(Number(group[2])+1)+" 张关键帧 · "+inlineImageToken(item.result.imageId),
  }];
  const results = planned.map(m => {
    const receipt = rows.slice().reverse().find(row=>row.id.startsWith(resultPrefix) && row.id.endsWith(":"+m.id) && belongs(row));
    return receipt && inlineChatParts(receipt.content).find(p=>p.imageId)?.imageId;
  });
  if (results.some(imageId => !imageId)) return rows;
  const boardId = "saved-photos:keyframe-review:"+group[1].slice(groupPrefix.length)+results.join("-");
  if (rows.some(m=>m.id===boardId)) return rows;
  return [...rows,{id:boardId,role:"assistant",timestamp:now+1,selectionQuote:original.selectionQuote,
    content:"关键帧初稿（"+results.length+" 张）\n"+results.map((imageId,i)=>(i+1)+"　"+inlineImageToken(imageId!)).join("\n")+"\n点图可放大。哪些符合你的想法？需要调整可以回复帧号和改动。"}];
}
