import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adjustedImageEditPlanId, chatImageEditPlanSchema, confirmedImageEditPlanId, keyframeBoardImageIds, localEraseReceiptId } from "../../shared/chatImageEditPlan";
import { localEraseBounds, pictureRegionSchema } from "../../shared/chatPictureRegion";
import { inlineImageToken } from "../../shared/inlineChatImages";
import { canonicalizeShotNo } from "../../shared/imageAsset";
import { shotIdentityFromShot } from "../../shared/shotIdentity";
import { getStoryGeneratedImages, createGeneratedImage } from "../repositories/images";
import { getStoryById, updateStoryBodyIfRevision } from "../repositories/stories";
import { jsonRecord, persistedStoryBodyRevision } from "../repositories/storyValues";
import { ownedPictureBytes, withLocalPictureReader } from "./chatPictureRegion";
import { storeImageBytes } from "./imageGen";
import { submitRender } from "./render/submitRender";

export const eraseKeyframesInput = z.object({
  storyId: z.number().int().positive(), planId: z.string().startsWith("region-scan:").max(180),
  targets: z.array(z.object({ imageId: z.number().int().positive(), region: pictureRegionSchema }))
    .min(1).max(12).refine(rows => new Set(rows.map(row => row.imageId)).size === rows.length),
});
type Input = z.infer<typeof eraseKeyframesInput> & { userId: number };
type Receipt = { id: string; text: string; timestamp: number };
const locks = new Set<string>();
function conflict(message: string): never { throw new TRPCError({ code: "CONFLICT", message }); }

async function context(input: Input) {
  const story = await getStoryById(input.storyId, input.userId);
  if (!story) throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在或无权访问" });
  const body = jsonRecord(story.body);
  const messages = Array.isArray(body.messages) ? body.messages.map(jsonRecord) : [];
  const card = messages.find(row => row.id === input.planId && row.who === "s");
  const plan = chatImageEditPlanSchema.safeParse(card?.imageEditPlan);
  const selectionQuote = jsonRecord(card?.selectionQuote);
  const shotId = selectionQuote.stableShotId;
  if (!plan.success || plan.data.status !== "draft" || !plan.data.regionScanSourceId || selectionQuote.storyId !== input.storyId || typeof shotId !== "string")
    conflict("请等待本镜检查卡保存后再试。");
  const receiptId = localEraseReceiptId(input.planId);
  const existing = messages.find(row => row.id === receiptId && row.who === "s");
  if (existing) {
    const ids = keyframeBoardImageIds(receiptId, String(existing.text));
    const changed = plan.data.images.filter((image, i) => image.imageId !== ids[i]);
    if (ids.length !== plan.data.images.length || changed.length !== input.targets.length ||
      changed.some(image => !input.targets.some(target => target.imageId === image.imageId)))
      conflict("这张检查卡已处理过其他选区，请从最新图片继续。");
  }
  const board = messages.filter(row => row.who === "s" && jsonRecord(row.selectionQuote).stableShotId === shotId &&
    jsonRecord(row.selectionQuote).storyId === input.storyId && keyframeBoardImageIds(String(row.id), String(row.text)).length).at(-1);
  const images = plan.data.images;
  if (!existing && (board?.id !== plan.data.keyframeBoardId ||
    keyframeBoardImageIds(String(board?.id), String(board?.text)).join() !== images.map(image => image.imageId).join() ||
    messages.some(row => row.id === confirmedImageEditPlanId(input.planId) || row.id === adjustedImageEditPlanId(input.planId))))
    conflict("检查卡或关键帧组已变化，请从最新一组继续。");
  for (const picked of input.targets) {
    const image = images.find(item => item.imageId === picked.imageId);
    if (!image?.region || JSON.stringify(image.region) !== JSON.stringify(picked.region)) conflict("选区已变化，请核对最新标记。");
  }
  const shots = Array.isArray(body.shots) ? body.shots.map(jsonRecord) : [];
  const index = shots.findIndex((shot, i) => shotIdentityFromShot(shot, i) === shotId);
  if (index < 0) conflict("原镜头已变化，请重新选图。");
  const shotNo = canonicalizeShotNo(String(shots[index].shotNo ?? index + 1));
  return { story, body, messages, images, sourceId: plan.data.regionScanSourceId, selectionQuote, shotId, shotNo, receiptId,
    existing: existing ? { id: receiptId, text: String(existing.text), timestamp: Number(existing.timestamp) } : undefined };
}

export async function eraseKeyframeRegions(input: Input): Promise<Receipt> {
  const lock = input.userId + ":" + input.storyId + ":" + input.planId;
  if (locks.has(lock)) conflict("这组图片正在擦除，请稍候。");
  locks.add(lock);
  try {
    return await withLocalPictureReader(input.userId, async () => {
      let state = await context(input);
      if (state.existing) return state.existing;
      const available = await getStoryGeneratedImages(input.storyId, input.userId);
      const replacements = new Map<number, number>();
      for (const { imageId, region } of input.targets) {
        const prompt = "本地擦除 · 0 算力 · " + input.planId + " · " + imageId + " · " + JSON.stringify(region);
        let candidate = available.find(image => image.parentImageId === imageId && image.shotIdentity === state.shotId && image.prompt === prompt);
        if (!candidate) {
          const bytes = await ownedPictureBytes(input.storyId, input.userId, imageId);
          const output = await submitRender("image.local-erase", { bytes, region: localEraseBounds(region, imageId === state.sourceId) });
          if (output.status !== "ok") throw Error("#" + imageId + "：" + output.message);
          const stored = await storeImageBytes(output.png, "image/png");
          if (stored.status !== "ok" || !stored.imageUrl) throw Error("#" + imageId + " 擦除结果保存失败，请重试。");
          candidate = await createGeneratedImage({ projectId: state.story.projectId, storyId: input.storyId, userId: input.userId,
            shotIdentity: state.shotId, shotNo: state.shotNo, imageUrl: stored.imageUrl, imageKey: stored.imageKey,
            parentImageId: imageId, prompt, generationType: "inpaint", isCurrent: false });
        }
        replacements.set(imageId, candidate.id);
      }
      // A concurrent edit may have advanced the story. Append to its latest body and keep the user's edits.
      for (let retry = 0; retry < 4; retry++) {
        state = await context(input);
        if (state.existing) return state.existing;
        const ids = state.images.map(image => replacements.get(image.imageId) ?? image.imageId);
        const receipt = { id: state.receiptId, timestamp: Date.now(), text: "关键帧修订稿（" + ids.length + " 张）\n" +
          "已本地擦除 " + replacements.size + " 张 · 0 算力。\n" +
          ids.map((id, i) => (i + 1) + "　" + inlineImageToken(id)).join("\n") + "\n点图可继续修改。" };
        const revision = persistedStoryBodyRevision(state.body);
        const message = { ...receipt, who: "s", selectionQuote: state.selectionQuote };
        if (await updateStoryBodyIfRevision({ id: input.storyId, userId: input.userId, expectedRevision: revision,
          body: { ...state.body, _revision: revision + 1, messages: [...state.messages, message] } })) return receipt;
      }
      conflict("图片已入库，聊天正在同步。请重试以恢复结果。");
    });
  } finally { locks.delete(lock); }
}
