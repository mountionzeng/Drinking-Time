import { frameRegionReviewSchema, forestPaletteStatus } from "../../shared/frameRegionReview";
import type { FrameReviewVideoBinding, FrameReviewVideoPlan } from "../../shared/frameReviewVideo";
import { getStoryById } from "../repositories/stories";
import { getStoryGeneratedImages } from "../repositories/images";
import { jsonRecord } from "../repositories/storyValues";
import { getStoryMaterialState } from "./storyMaterials";

const deps = { story: getStoryById, images: getStoryGeneratedImages, material: getStoryMaterialState };
type Input = { userId: number; storyId: number; stableShotId: string; review: FrameReviewVideoBinding };
function fail(zh: string, en: string): never { throw new Error(zh + " / " + en); }

/** Read-only plan. Rechecked before quoting and purchasing. */
export async function prepareFrameReviewVideo(input: Input, overrides: Partial<typeof deps> = {}): Promise<FrameReviewVideoPlan> {
  const d = { ...deps, ...overrides };
  const story = await d.story(input.storyId, input.userId);
  if (!story) fail("故事不存在", "Story unavailable");
  const body = jsonRecord(story.body);
  const reviews = (Array.isArray(body.frameRegionReviews) ? body.frameRegionReviews : []).flatMap(value => {
    const parsed = frameRegionReviewSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
  const review = reviews.find(row => row.id === input.review.reviewId && row.storyId === input.storyId && row.editorUserId === input.userId && row.stableShotId === input.stableShotId);
  if (!review || review.revision !== input.review.reviewRevision || review.timelineVersion !== input.review.timelineVersion)
    fail("范围记录已变化，请查看最新记录", "Review changed; use the latest review");
  if (review.phase !== "images_confirmed" || !review.tasks.length || review.tasks.some(task => !task.candidate))
    fail("关键帧尚未全部认可。请先在聊天里完成配色调整和图片确认；尚未报价或生成视频", "Finish image review in chat before a video quote");
  const images = await d.images(input.storyId, input.userId);
  const own = (id: number) => images.find(image => image.id === id && image.storyId === input.storyId && image.userId === input.userId && image.shotIdentity === input.stableShotId);
  const descendsFrom = (id: number, ancestor: number): boolean => {
    const seen = new Set<number>();
    while (!seen.has(id)) {
      if (id === ancestor) return true;
      seen.add(id);
      const parent = own(id)?.parentImageId;
      if (!parent) return false;
      id = parent;
    }
    return false;
  };
  const frames = [...review.frames].sort((a, b) => a.sourceTimeSec - b.sourceTimeSec);
  if (frames.length < 2 || frames.length > 5)
    fail("连续视频需要同一原视频的2–5张关键帧，并覆盖起止画面；单张局部候选不能代替整段运动", "Use 2–5 frames covering the source clip; one local edit cannot represent its full motion");
  for (const task of review.tasks) {
    if (!own(task.imageId) || !own(task.candidate!.imageId) || !descendsFrom(task.candidate!.imageId, task.imageId))
      fail("候选或原图的来源不完整", "Candidate lineage is unavailable");
    if (forestPaletteStatus(task.candidate!.imageId, reviews, images) === "rejected")
      fail("这组图片包含未认可的配色，不能用于视频", "This set contains rejected colors");
    if (!frames.some(frame => descendsFrom(task.imageId, frame.imageId)))
      fail("修改底图不在这组原视频关键帧中，请先核对来源", "The edited source is outside this keyframe set");
  }
  const resolved = frames.map(frame => {
    const candidates = review.tasks.filter(task => descendsFrom(task.imageId, frame.imageId)).map(task => task.candidate!.imageId);
    const leaf = candidates.find(id => candidates.every(other => descendsFrom(id, other)));
    if (candidates.length && !leaf) fail("同一帧的修改还未合成一张确认图", "Edits for the same frame need a reviewed composite");
    const image = own(leaf ?? frame.imageId);
    if (!image || forestPaletteStatus(image.id, reviews, images) === "rejected") fail("关键帧不可用或配色被否定", "Keyframe unavailable or rejected");
    return { id: image.id, imageUrl: image.imageUrl, label: "#" + image.id };
  });
  if (new Set(resolved.map(image => image.id)).size !== resolved.length) fail("关键帧重复", "Duplicate keyframes");
  const material = await d.material(input.storyId, input.userId);
  if (!material || material.timeline.version !== input.review.timelineVersion) fail("剪辑版本已变化，请重新核对", "Timeline changed; review again");
  const shot = material.shots.find(shot => shot.stableShotId === input.stableShotId);
  const sourceTakeId = frames[0].takeId;
  const take = shot?.videoTakes.find(take => take.id === sourceTakeId);
  if (!sourceTakeId || frames.some(frame => frame.takeId !== sourceTakeId) || !take || take.status !== "available" || !take.durationSec)
    fail("关键帧必须来自同一条可用原视频", "Keyframes must come from one available source video");
  if (take.aspectRatio !== "1:1")
    fail("当前接口仅支持1:1画幅，不能改变原视频画幅", "This endpoint supports square video only; the source aspect ratio must be retained");
  const duration = take.durationSec;
  const seconds = duration / (frames.length - 1);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 8)
    fail("原视频为" + duration + "秒，当前接口每段仅支持1–8整数秒，无法原时长生成；不会自动缩短或变速", "The " + duration + "s source cannot be preserved by this endpoint's integer 1–8s segments; no silent retiming");
  if (frames.some((frame, index) => Math.abs(frame.sourceTimeSec - Math.min(index * seconds, duration - 1 / 30)) > 1 / 30 + 0.001))
    fail("关键帧未覆盖原片起止或间隔不匹配，不能悄悄改变动作节奏", "Keyframes must cover the source endpoints at matching intervals");
  const sourceShot = (Array.isArray(body.shots) ? body.shots : []).map(jsonRecord).find(s => (s.stableShotId ?? s.shotIdentity) === input.stableShotId);
  const direction = typeof sourceShot?.videoPrompt === "string" ? sourceShot.videoPrompt.trim() : "";
  const prompt = direction || "按关键帧顺序缓慢、连续地衔接画面，保留既有场景、色彩、物体和美术风格，不新增元素。";
  if (prompt.length > 700) fail("原视频要求超过接口700字限制，请在聊天中整理后再报价", "Review a shorter motion brief; the endpoint limit is 700 characters");
  return { storyId: input.storyId, stableShotId: input.stableShotId, shotNo: review.shotNo, review: input.review,
    sourceTakeId, sourceDurationSec: duration, segmentSeconds: seconds, images: resolved, prompt };
}
