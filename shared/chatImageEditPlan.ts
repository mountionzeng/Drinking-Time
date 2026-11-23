import { pictureRegionSchema, pictureRegionNote } from "./chatPictureRegion";
import { z } from 'zod';
import { hasRemovalTargetDescription, isImageObjectRemoval } from './imageObjectRemoval';
import { estimateStoryboardImageCost, estimateStoryboardMaskedEditCost } from './imageRenderCost';
import { formatComputeQuote } from './computeMoney';

import { inlineChatParts } from './inlineChatImages';
import { MAX_CHAT_IMAGE_REFS } from './chatImageRefs';

/** Only a review receipt lists a complete, ordered board. */
export function keyframeBoardImageIds(id: string, text: string): number[] {
  if (!id.startsWith('saved-photos:') || !/关键帧初稿|关键帧修订稿/.test(text)) return [];
  const ids = inlineChatParts(text).flatMap(part => part.imageId ? [part.imageId] : []);
  return new Set(ids).size === ids.length ? ids : [];
}

/** Intent only. This persisted record must never contain payment authorization. */
export const chatImageEditPlanSchema = z.object({
  status: z.enum(['draft', 'submitted']),
  individualDirections: z.literal(true).optional(),
  comparison: z.literal('color-temperature').optional(),
  renderRoute: z.enum(['precision', 'storyboard']).optional(),
  regionScanSourceId: z.number().int().positive().optional(),
  keyframeBoardId: z.string().startsWith('saved-photos:').max(500).optional(),
  mode: z.enum(['separate', 'compose']),
  images: z.array(z.object({
    imageId: z.number().int().positive(),
    imageUrl: z.string().min(1),
    label: z.string(),
    role: z.enum(['undecided', 'target', 'reference', 'omit']),
    copies: z.number().int().min(1).max(4),
    purpose: z.string().max(1000),
    region: pictureRegionSchema.optional(),
  })).min(1).max(15).refine(images => new Set(images.map(image => image.imageId)).size === images.length),
  changes: z.string().max(2000),
  preserve: z.string().max(1000),
  details: z.string().max(1000),
}).refine(plan => plan.regionScanSourceId ? Boolean(plan.keyframeBoardId && plan.mode === "separate" &&
  plan.images.length <= 12 && plan.images.some(i => i.imageId === plan.regionScanSourceId && i.region) &&
  plan.images.every(i => i.copies === 1 && (i.role === "omit" || i.role === "target" && i.region)) &&
  (plan.status === "draft" || plan.images.some(i => i.role === "target"))) : plan.keyframeBoardId
  ? plan.mode === 'separate' && plan.images.every(i => i.copies === 1 && ['target', 'reference'].includes(i.role)) && plan.images.some(i => i.role === 'target') && plan.images.filter(i => i.role === 'target').length <= 12 &&
    plan.images.filter(i => i.role === 'reference').length < MAX_CHAT_IMAGE_REFS
  : plan.images.length <= MAX_CHAT_IMAGE_REFS);
export type ChatImageEditPlan = z.infer<typeof chatImageEditPlanSchema>;

// A committed form is a new chat record. Stale-body merges deliberately keep
// existing messages, so mutating the original form ID cannot commit its fields.
export const localEraseReceiptId = (planId: string) => "saved-photos:keyframe-revision:local-erase:" + planId;
export const confirmedImageEditPlanId = (sourceId: string) => `image-edit-confirmed:${sourceId}`;
export const adjustedImageEditPlanId = (sourceId: string) => `image-edit-adjusted:${sourceId}`;

export function imageEditPlanOutput(plan: ChatImageEditPlan, imageId: number, copy: number) {
  const error = imageEditPlanError(plan);
  if (error) throw new Error(error);
  if (plan.status !== 'submitted') throw new Error('请先确认修改要求。');
  if (!plan.preserve.trim()) throw new Error('请补充必须保留的内容，再准备报价。');
  const target = plan.images.find(image => image.imageId === imageId && image.role === 'target');
  if (!target || !Number.isInteger(copy) || copy < 1 || copy > target.copies) throw new Error('待修改图片或张数已变化，请重新核对。');
  const refs = [target, ...plan.images.filter(image => image.imageId !== imageId &&
    (plan.keyframeBoardId ? image.role === 'reference' : plan.mode === 'separate' && plan.individualDirections ?
      image.role === 'reference' || image.role === 'target' && (plan.comparison === 'color-temperature' || [...target.purpose.matchAll(/#(\d+)\b/g)].some(match => Number(match[1]) === image.imageId)) : image.role !== 'omit'))];
  return {
    refs: refs.map(({ imageId, imageUrl, label }) => ({ imageId, imageUrl, label })),
    instruction: [
      `本次只修改图片 #${imageId}，输出第 ${copy}/${target.copies} 张独立候选；其他图片仅按下面说明参考，不同时修改，不拼贴。`,
      `这张图的要求：${target.purpose}`,
      ...(plan.regionScanSourceId && target.region ? ["仅修改这张原图的定位范围 " +
        pictureRegionNote(target.region, {text:"",object:"",available:false}, false)] : []),
      `共同修改要求：${plan.changes}`,
      `必须保留：${plan.preserve}`,
      `层次、配色和其他要求：${plan.details}`,
      ...refs.slice(1).map(image => `参考图片 #${image.imageId}：${(image.role === 'target' && plan.individualDirections ? '仅作为原图对照，保留本张底图的构图与主体。' : image.purpose) || '仅在共同修改要求明确点名时参考，不借用其构图或主体。'}`),
      '所有图片编号均为仓库ID；当前底图是图1。只输出这张底图的新候选，保留原图，不替换当前剪辑。',
    ].join('\n'),
  };
}

export function createChatImageEditPlan(
  refs: Array<{ imageId: number; imageUrl: string; label: string }>, instruction: string,
): ChatImageEditPlan {
  return {
    status: 'draft', mode: 'separate', changes: instruction,
    preserve: isImageObjectRemoval(instruction) ? '未要求修改的主体与背景保持原样；保留对象的大小、颜色、形状、位置及原有明暗不变。' : '', details: '',
    images: refs.map(ref => ({ ...ref, role: refs.length === 1 ? 'target' : 'undecided', copies: 1, purpose: '' })),
  };
}

export function requestsVisualChange(words: string) {
  if (words.length > 1000 || /视频|镜头运动|台词|字幕|音轨|音乐|如果|假如|是否|能不能|可不可以|想知道|希望知道|想了解|解释|为什[么麼]|什么|怎么|吗|么[。！!\s]*$|[?？]/.test(words)) return false;
  const direction = /(?:我(?:其实|主要|还是|更)?(?:是)?(?:希望|想(?:要|让))|^(?:希望|想要)(?=背景|画面|构图|颜色|色调|图标|元素)|请让|请把)/.test(words);
  if (direction &&
      !/解释|分析|描述一下|评价|比较一下|问一下|知道|了解|查看|看看|展示给我|打开|发给我|导出|下载|分享|播放|费用|报价|算力|撤回|采用|保存到|放进剪辑|不(?:用|必|想|要)改|(?:不希望|不是希望).{0,5}(?:改图|生成)/.test(words)) return true;
  if (/(?:再|更)(?:抽象|简洁|简约|通透|柔和|清晰|立体)(?:一?点|一些|些)/.test(words) &&
      !/建议|已经|本来|不用|不必|不要|不想|有没有|为什么|是不是/.test(words)) return true;
  // A terse art direction can specify a distribution without an imperative verb.
  return /有的?大[，、,\s]*有的?小|有的?小[，、,\s]*有的?大|大小(?:不一(?:致)?|不等|各异|错落|交错|有别)/.test(words) &&
    !/原本|本来|已经|原来|看起来|现在(?:是|就)|挺好|喜欢|满意|不用改|不要改|无需改|是不是|有没有|为什么|为啥/.test(words);
}

/** Only infer roles for untouched drafts where each ordered image has its own edit sentence. */
export function resolveIndividualDirections(plan: ChatImageEditPlan): ChatImageEditPlan {
  if (plan.status !== "draft" || plan.individualDirections || plan.mode !== "separate" || plan.renderRoute || plan.keyframeBoardId ||
      plan.preserve || plan.details || plan.images.length < 2 || plan.images.some(i => i.role !== "undecided" || i.copies !== 1 || i.purpose || i.region)) return plan;
  const markers = [...plan.changes.matchAll(/图(\d+)（图片 #(\d+)）/g)];
  if (markers.length !== plan.images.length || !/^(?:(?:请|帮我|把|这几张图|分别|修改|调整|一下)|[\s，,:：])*$/u.test(plan.changes.slice(0, markers[0]?.index))) return plan;
  if (/(?:仅|只|作为|用作|当作|用来).{0,5}参考|参考图|不要改|不用改|无需改|不改|保持原样|只改|不用这张|合成|拼贴|拼成|(?:生成|出|做|要|来|给我).{0,4}[零一二两三四五六七八九十\d]+张|(?:[2-9]\d*|两|二|三|四|五|六|七|八|九|十)\s*张|[零一二两三四五六七八九十\d]+\s*(?:张候选|张图|个版本)|[?？]|删除|去掉|擦除|框选/.test(plan.changes)) return plan;
  const instructions: string[] = [];
  for (const [i, marker] of markers.entries()) {
    if (Number(marker[1]) !== i + 1 || Number(marker[2]) !== plan.images[i].imageId) return plan;
    let request = plan.changes.slice(marker.index! + marker[0].length, markers[i+1]?.index)
      .trim().replace(/^(?:我希望这张图|这张图我希望)(?=更|是|改|调|变|增加|减少)/, "")
      .replace(/三围(?=的?视角)/g, "三维").replace(/^是(?:一个)?三维的?视角/, "三维视角");
    if (!request || (!requestsVisualChange(request) && !/(?:改|调|抽象|放大|缩小|增[加大]|减[少小]|扩大|降低|压低|提[高亮]|换成|变成|更[亮暗暖冷绿]|视角|移到|变[大小]|加上|画成)/.test(request)) ||
        /^(?:[，。\s]*)(?:仅供|参考|参照|借鉴|不用|保留原图)/.test(request)) return plan;
    if (i > 0) request = request.replace(/(?:上|前)一?张(?:图)?(?=一样|一[样致]|的(?:风格|画风|配色)|同样)/g, "图 #"+plan.images[i-1].imageId+" ");
    instructions.push(request);
  }
  return {...plan, individualDirections:true, changes:"按各图旁的要求分别修改。",
    preserve:"保留各自的原图主体、元素数量，以及修改要求以外的内容。",
    images:plan.images.map((image,i)=>({...image,role:"target",purpose:instructions[i]}))};
}

export function imageEditPlanQuote(plan: ChatImageEditPlan) {
  const targets = plan.images.filter(image => image.role === 'target');
  const economy = plan.renderRoute === 'storyboard';
  const unit = economy ? estimateStoryboardImageCost() : estimateStoryboardMaskedEditCost();
  const tasks = targets.reduce((sum, image) => sum + (economy ? 1 : image.copies), 0);
  return { unitCny: unit.estimatedCny, totalCny: Number((unit.estimatedCny * tasks).toFixed(2)), candidates: tasks * unit.candidateCount, tasks };
}

export function imageEditPlanOutputCount(plan: ChatImageEditPlan): number {
  return plan.images.reduce((count, image) => count + (image.role === 'target' ? image.copies : 0), 0);
}

export function imageEditPlanError(plan: ChatImageEditPlan): string | null {
  if (!chatImageEditPlanSchema.safeParse(plan).success) return '图片或张数无效，请重新核对。';
  if (plan.images.some(image => image.role === 'undecided')) return '请明确每张图片的用途：待修改、仅参考或不用。';
  const targets = plan.images.filter(image => image.role === 'target');
  if (!targets.length) return '请选择至少一张待修改的图片。';
  if (plan.mode === 'compose' && targets.length !== 1) return '合成模式需要明确一张底图，其余图片设为参考。';
  if (plan.images.some(image => image.role === 'reference' && !image.purpose.trim())) return '请说明参考图用于配色、层次、构图还是其他部分。';
  if (!plan.changes.trim()) return '请说明这次需要修改的地方。';
  if (isImageObjectRemoval(plan.changes) && targets.some(image => !(plan.regionScanSourceId && image.region) && !hasRemovalTargetDescription(`${plan.changes}\n${image.purpose}`)))
    return '请在图片说明中明确删除或保留哪一个（位置、大小或颜色），避免误删其他物体。';
  return null;
}

/** Stable image IDs retain their meaning even when each target later becomes the base. */
export function imageEditPlanReply(plan: ChatImageEditPlan, generationEstimate?: number): string {
  return [
    `改图要求确认：${plan.mode === 'separate' ? '每张原图分别修改' : '按一张底图合成'}，共 ${imageEditPlanQuote(plan).candidates} 张新候选。`,
    ...plan.images.map(image => `[[ref:image%3A${image.imageId}]] 图片 #${image.imageId}：${image.role === 'target'
      ? `${plan.mode === 'separate' ? '分别修改' : '合成底图'}，生成 ${plan.renderRoute === 'storyboard' ? 4 : image.copies} 张`
      : image.role === 'reference' ? '仅作参考，不生成' : '本次不用'}${image.purpose.trim() ? `；${image.purpose.trim()}` : ''}`),
    `要修改：${plan.changes.trim()}`,
    `必须保留：${plan.preserve.trim() || '尚未补充，请先问清楚，不能默认可改动其他内容。'}`,
    ...(plan.details.trim() ? [`其他要求：${plan.details.trim()}`] : []),
    generationEstimate === undefined
      ? '这次只确认要求，不批准付费生成或采用。先核对修改和保护范围，再按实际输出张数报价。'
      : `确认以上要求和预计合计 ${formatComputeQuote(generationEstimate)}，生成 ${imageEditPlanQuote(plan).candidates} 张新候选；结果存入仓库，不替换当前剪辑。`,
  ].join('\n');
}
