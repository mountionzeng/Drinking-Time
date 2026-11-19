import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getStoryById, updateStoryBodyIfRevision } from "../repositories/stories";
import { feedbackActivityId, storedFeedbackActivity } from "../../shared/videoFeedbackActivity";

export const activityReport = z.object({
  storyId: z.number().int().positive(), feedbackId: z.string().uuid(),
  expectedSteps: z.number().int().min(1).max(40),
  phase: z.enum(["制作中","制作完成","制作失败"]), step: z.string().trim().min(1).max(160).regex(/^[^\r\n]+$/),
});

/** Update the one existing receipt without loading the story back into the editor. */
export async function reportVideoFeedbackActivity(userId: number, input: z.infer<typeof activityReport>) {
  const story = await getStoryById(input.storyId, userId);
  const body = story?.body as { messages?: Array<{id?:string;who?:string;text?:string}>; _revision?: number } | undefined;
  const id = feedbackActivityId(input.feedbackId);
  const current = storedFeedbackActivity(body, id);
  if (!current || !Array.isArray(body?.messages) || !body.messages.some(row => row.id === input.feedbackId && row.who === "u")) {
    throw new TRPCError({code:"NOT_FOUND", message:"这条视频反馈不存在"});
  }
  if (current.steps.length === input.expectedSteps + 1 && current.phase === input.phase && current.latest === input.step) return current;
  if (current.steps.length !== input.expectedSteps || current.phase === "制作完成" || current.phase === "制作失败") {
    throw new TRPCError({code:"CONFLICT",message:"制作进度已更新"});
  }
  const steps = [...current.steps, input.step];
  const text = [input.phase, ...steps].join("\n");
  const revision = body._revision ?? 0;
  const saved = await updateStoryBodyIfRevision({
    id: input.storyId, userId, expectedRevision: revision,
    body: {...body, _revision: revision + 1, messages: body.messages.map(row => row.id === id ? {...row,text} : row)},
  });
  if (!saved) throw new TRPCError({code:"CONFLICT", message:"故事已更新，请重新核对进度"});
  return {phase: input.phase, steps, latest: input.step};
}
