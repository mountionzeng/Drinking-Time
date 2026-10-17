import { createHash } from "node:crypto";
import { creativeVersionIntent } from "../../shared/creativeVersionIntent";
import { normalizePublishingDraftState } from "../../shared/publishingDraft";
import { readTextDraftHistory } from "../../shared/textDraftHistory";
import { ownedCreationStory } from "../repositories/textSourceLineage";
import { generateTextDraft } from "./textDraftHistory";
import { generateAndPersistPublishingVideoPreview } from "./publishingVideoStoryboardPersistence";
import type { WritingCompanionContext } from "./writingCompanion";

export const VIDEO_INTENT_QUESTION = "你想把这些图文做成什么样的视频？";
export const VERSION_INTENT_QUESTION = "直接修改当前作品，还是保留原版再试一版？";
type Input = {
  storyId: number; userId: number; clientTurnId: string; message: string;
  history: Array<{role: "user" | "assistant"; content: string}>;
  writingContext?: WritingCompanionContext;
};
// The existing mobile follow-up envelope quotes source material before the user's request.
// Only the final request is actionable; quoted text must never trigger generation.
function mobileRequest(content: string): string {
  const marker = "【这次的新想法】\n";
  if (content.startsWith("我想接着这段") && content.includes("【引用结束】\n\n" + marker))
    return content.slice(content.lastIndexOf(marker) + marker.length).trim();
  return content.trim();
}

/** Invoked inside the mobile turn's existing durable claim; no UI changes or extra chat writes. */
export async function replyToMobileCreativeIntent(input: Input): Promise<string | null> {
  let message = mobileRequest(input.message);
  const last = input.history.at(-1);
  const answeringVideo = last?.role === "assistant" && last.content === VIDEO_INTENT_QUESTION;
  const answeringVersion = last?.role === "assistant" && last.content === VERSION_INTENT_QUESTION;
  if ((answeringVideo || answeringVersion) && /^(取消|算了|先不做)[。！!]*$/.test(message)) return "好，当前作品保留。";
  if (answeringVersion && /^(保留|保留原版|另做一版|保留原版再试一版)[。！!]*$/.test(message)) {
    const request = input.history.at(-2);
    message = `${request?.role === "user" ? mobileRequest(request.content) : "换一种表达"}，原版保留，再写一版`;
  }
  const branch = creativeVersionIntent(message);
  if (branch === "clarify") return VERSION_INTENT_QUESTION;
  const videoRequest = /^(?:请|帮我|我想|我希望|咱们|我们)?(?:把|用|将|做|制作|生成|规划|编排)/.test(message)
    && /(?:做成|做个|做一个|变成|制作|生成|编排|规划).{0,18}(?:视频|分镜)/.test(message)
    && !/(?:不要|别|不用|不想).{0,12}(?:视频|分镜)/.test(message);
  if (!branch && !videoRequest && !answeringVideo) return null;
  if (branch === "fork" && /图片|图像|视频|封面/.test(message))
    return "想保留另一份文字，还是另做图片或视频？请说出要改变的部分。";
  if (videoRequest && !answeringVideo && !/为了|希望|想让|哄|记录|朗读|念出来|字幕|喜剧|搞笑|温柔|纪念|送给|介绍|讲解/.test(message.replace(/^(?:请|帮我|我想|我希望|咱们|我们)/, "")))
    return VIDEO_INTENT_QUESTION;
  const { body } = await ownedCreationStory(input);
  const publishing = normalizePublishingDraftState(body.publishing);
  const activeDraft = publishing.drafts[publishing.activePlatform];
  const token = `mobile-creative-${createHash("sha256").update(`${input.storyId}:${input.clientTurnId}`).digest("hex").slice(0,40)}`;
  if (branch === "fork") {
    const history = readTextDraftHistory(body.textDraftHistory);
    const name = message.match(/《([^》]+)》/);
    const number = message.match(/文字版本\s*([1-9]\d*)/);
    const matches = history.versions.filter(v => v.status === "ready" && v.generated &&
      (name ? v.generated.title === name[1] : number ? v.sequence === Number(number[1]) : false));
    if ((name || number) && matches.length !== 1) return "没有唯一对应的文字稿，请指定完整标题或文字版本编号。";
    if (!name && !number && /之前|上次|旧版/.test(message)) return "请用《完整标题》或文字版本编号指定原稿，避免选错。";
    const parent = matches[0];
    const basis = parent ? parent.adoption?.content ?? parent.generated : activeDraft?.content;
    if (!basis?.body.trim()) return "请先保存文字，或指定已有文字版本，再另做一版。";
    if (!parent && input.writingContext && input.writingContext.draft !== basis.body)
      return "当前文字还有未保存的修改，请先保存，再保留原版另写一版。";
    const previous = history.versions.find(v => v.id === token);
    const result = previous ? history : await generateTextDraft({
      storyId: input.storyId, userId: input.userId, operationToken: token,
      expectedRevision: history.revision, platform: parent?.request.platform ?? publishing.activePlatform,
      parentId: parent?.id ?? null, basis, messages: [], instruction: message, source: "own",
    });
    const draft = result.versions.find(v => v.id === token)!;
    if (draft.status !== "ready") throw new Error(draft.error || "这份文字还未生成完成，请查看文字历史，不会重复生成。");
    const title = draft.generated!.title.trim();
    return `已另存文字版本${draft.sequence}${title ? `《${title}》` : ""}。原稿、图片和视频都保留，可以在原有文字历史里查看。\n\n${draft.generated!.body}`;
  }
  if (!activeDraft?.content.body.trim()) return "请先保存要用于视频的文字，再告诉我希望做成什么样的视频。";
  if (input.writingContext?.module || input.writingContext?.layoutMemory)
    return "手机排版里的选图和位置目前只保存在本机，还不能完整交给视频分镜。请返回文字稿聊天，用已保存的正文和确认封面规划视频；当前排版会保留。";
  if (input.writingContext && input.writingContext.draft !== activeDraft.content.body)
    return "文字还有未保存的修改，请先保存，再按这份文字安排视频分镜。";
  const result = await generateAndPersistPublishingVideoPreview({
    storyId: input.storyId, userId: input.userId, versionId: publishing.activeVersionId,
    operationToken: token, creativeIntent: message,
    articleLayout: { body: activeDraft.content.body, illustrations: publishing.cover?.assetId
      ? [{assetId: publishing.cover.assetId, after: null}] : [] },
  });
  if (!result.preview || result.status === "pending") return "分镜正在规划中，已有文字和素材保留；不会重复生成媒体。";
  return "已按你的想法，用已保存的正文和确认封面保存视频分镜草稿。时长随文字和节奏安排；原稿与正式分镜保留，未生成图片或视频。\n\n" + result.preview.shots.map((shot,i) =>
    `${i+1}. ${shot.subject}\n画面：${shot.action}\n字幕／旁白：${shot.voiceText || "无"}\n动作与镜头：${shot.videoRequirement}\n声音：${shot.soundRequirement || "未指定"}`
  ).join("\n\n");
}
