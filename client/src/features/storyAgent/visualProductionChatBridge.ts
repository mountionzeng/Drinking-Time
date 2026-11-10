import { parseVisualProductionChat, usesSelectedImageRevision, type VisualProductionIntent } from "@shared/visualProductionChat";
import type { SelectionContext } from "@shared/selectionContext";
import { chatImageRefsStore } from "./chatImageRefsStore";
import { withMediaChatSession } from "./mediaChatSession";

export type VisualProductionSelection = Pick<SelectionContext,
  "sourceType" | "sourceId" | "stableShotId" | "shotNo" | "imageId" | "videoTakeId" | "selection">;
export type VisualProductionRequest = { instruction: string; intent: VisualProductionIntent; selection?: VisualProductionSelection; referenceImageIds?: number[] };
type Runner = (request: VisualProductionRequest) => Promise<string>;
const runners = new Map<number, Runner>();
const running = new Set<number>();

export function registerVisualProductionChat(storyId: number, runner: Runner) {
  runners.set(storyId, runner);
  return () => { if (runners.get(storyId) === runner) runners.delete(storyId); };
}

export async function runVisualProductionChat(storyId: number, instruction: string, selection?: VisualProductionSelection) {
  const intent = parseVisualProductionChat(instruction);
  if (!intent) return null;
  if (usesSelectedImageRevision(intent, selection)) return null;
  // Text selections and confirmed masks keep their existing narrow executor.
  if (selection?.selection || (selection && !["shot", "storyboard-image", "animatic-video"].includes(selection.sourceType))) return null;
  const runner = runners.get(storyId);
  if (!runner) return { handled: true as const, reply: "视频分镜还没有载入，请先打开视频表格；尚未生成或修改素材。" };
  if (running.has(storyId)) return { handled: true as const, reply: "当前生成流程正在进行，请先完成当前算力确认或等待结果；没有重复提交。" };
  running.add(storyId);
  const basket = chatImageRefsStore.getState();
  const referenceImageIds = intent.imageId && intent.kind === "image" ? [intent.imageId]
    : !intent.shotCode && selection?.imageId ? [selection.imageId]
    : basket.storyId === storyId && basket.refs.length ? basket.refs.map(ref => ref.imageId) : undefined;
  try { return { handled: true as const, reply: await withMediaChatSession(storyId, () => runner({ instruction, intent, selection, referenceImageIds })) }; }
  catch (error) { return { handled: true as const, reply: `本次制作未完成：${error instanceof Error ? error.message : "请稍后重试"}` }; }
  finally { running.delete(storyId); }
}
