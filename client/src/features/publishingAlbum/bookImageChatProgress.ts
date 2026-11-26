import { formatComputeQuote } from "@shared/computeMoney";
import type { ChatMessage } from "@/features/storyAgent/types";
import { storySpineStore } from "@/features/storyAgent/spine/storySpine";
import { bookImageEditSteps, cropLabel } from "./bookImageCropIntent";
import type { BookImageWork } from "./bookImageEditWork";
import type { BookMediaSession } from "./bookMediaSession";

export function bookImageProgressMessage(work: BookImageWork, imageUrl: string, shotNo?: number) {
  if (!work.chatId || work.phase === "crop" || (work.phase === "quote" && !work.cropped && work.confirmedCny == null)) return;
  const steps = bookImageEditSteps(work.request);
  const lines = [shotNo ? `第 ${String(shotNo).padStart(2,"0")} 镜 · 改图记录` : "书页改图记录"];
  const edge = work.cropChoice?.edge ?? steps.crop?.edge;
  if (work.cropped) lines.push((edge ? cropLabel(edge) : "裁切") + "，已完成 · 0 算力");
  if (steps.changes.length) lines.push(...steps.changes);
  if (work.confirmedCny != null) lines.push("已确认本次生成报价 " + formatComputeQuote(work.confirmedCny));
  const status = {
    quote: "等待确认改绘", sending: "正在生成", unknown: "提交结果待核实", failed: "改绘未完成",
    review: "候选图已生成，等待采用", done: steps.changes.length ? "候选图已生成，已放回文章" : "已放回文章",
    dismissed: "已收起这次修改",
  }[work.phase];
  lines.push(status);
  if ((work.phase === "failed" || work.phase === "unknown") && work.message) lines.push(work.message);
  return {id:work.chatId,role:"assistant" as const,content:lines.join("\n"),
    photoUrl:work.phase === "done" ? imageUrl : work.phase === "review" ? work.resultUrl : undefined};
}

export function recordBookImageProgress(session: BookMediaSession, work: BookImageWork, imageUrl: string) {
  const state = storySpineStore.getState();
  if (!session.accountId || state.accountId !== session.accountId || state.activeStoryId !== session.storyId ||
      state.storyScopeEpoch !== session.epoch) return;
  const receipt = bookImageProgressMessage(work,imageUrl,session.shotNo);
  if (!receipt) return;
  const existing = state.messages.find(row=>row.id===receipt.id);
  if (existing?.content === receipt.content && existing.photoUrl === receipt.photoUrl) return;
  const row: ChatMessage = {...receipt,timestamp:existing?.timestamp ?? Date.now()};
  state.setMessages(rows => existing ? rows.map(item=>item.id === row.id ? row : item) : [...rows,row]);
}
