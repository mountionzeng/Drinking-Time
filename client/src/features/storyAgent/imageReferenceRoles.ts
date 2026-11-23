import { createChatImageEditPlan, type ChatImageEditPlan } from '@shared/chatImageEditPlan';
import { inlineChatParts } from '@shared/inlineChatImages';
import { MAX_CHAT_IMAGE_REFS, type ChatImageRef } from '@shared/chatImageRefs';

const keepOriginal = '保留原图中未要求改变的内容。';

export function groupedImageDirection(text: string, refs: ChatImageRef[]) {
  const parts = inlineChatParts(text).filter(part => part.imageId || part.text.trim());
  if (refs.length < 2 || parts.length !== refs.length + 1) return;
  const words = [parts[0], parts.at(-1)].find(part => part && !part.imageId)?.text.trim();
  if (words) return words;
}

/** Each output keeps its own composition. Its peers supply the comparison scale. */
export function temperatureComparisonDraft(words: string, refs: ChatImageRef[]): ChatImageEditPlan | undefined {
  if (refs.length < 2 || refs.length > MAX_CHAT_IMAGE_REFS ||
      /只改|仅改|参考图|仅供|作参考|合成|拼贴|视频|是否|建议|如果|先看看|暂不生成|为什么|怎么|吗|[?？]/.test(words)) return;
  const relation = words.split(/[，,。；;！!\n]/).find(clause =>
    /冷暖|色温/.test(clause) && /拉开|区分开|区别开|差异更明显/.test(clause) &&
    !/前景|背景|近处|远处|每张|各自|内部|单张|已经|不用|不必|不要|不需|不想|别拉开/.test(clause) &&
    /(?:[两二三四2-4几]张(?:图(?:片)?|画面|照片)?|这些图(?:片)?|这组图(?:片)?)(?:之?间|彼此|相互|的|在|冷暖|色温)/.test(clause));
  if (!relation) return;
  const count = relation.match(/([两二三四2-4])张/)?.[1];
  if (count && (Number(count) || '一二三四'.indexOf(count.replace('两','二')) + 1) !== refs.length) return;

  const warm = '偏暖，突出原画里的暖光，暗部留少量冷色。';
  const middle = '冷暖过渡，保留原画中暖光与冷色的平衡。';
  const cool = '偏冷，以原画里的冷色为主，只留少量暖光。';
  const directions = refs.length === 2 ? [warm, cool] : refs.length === 3 ? [warm, middle, cool]
    : [warm, '略偏暖，向中性色过渡。', '略偏冷，保留少量暖色。', cool];
  if (/(?:从|由)冷(?:色|调|色调)?(?:到|至|转为|转向)暖/.test(words)) directions.reverse();
  for (const match of words.matchAll(/第\s*([一二三四1-4])\s*张(?:图(?:片)?)?\s*[：:]?\s*([^，,。；;！!\n]+)/g)) {
    const index = (Number(match[1]) || '一二三四'.indexOf(match[1]) + 1) - 1;
    if (index >= refs.length) return;
    directions[index] = match[2].trim();
  }
  return { ...createChatImageEditPlan(refs, words), mode: 'separate', individualDirections: true,
    comparison: 'color-temperature', changes: words, preserve: keepOriginal,
    images: refs.map((ref, index) => ({ ...ref, role: 'target', copies: 1, purpose: directions[index] })) };
}

export function explicitlyEditAll(words: string, count: number) {
  if (/(?:只改|只想改|仅改|仅供|[作做当]参考|参考图|先(?:别|不)(?:画|改|生成)|暂不生成|只(?:想)?(?:聊|看|讨论)|如果|假如|建议|分析|解释|为什么|怎么|是否|吗|[?？])/.test(words)) return false;
  if (/(?:这|那|全部|所有|两|三|四|[234]|每|这些|几张).{0,9}(?:都|一起|全部|分别|各自|逐张)(?:要|再|想|需要)?(?:改|修|调|变|更|生成)|(?:每张|逐张)(?:图)?(?:都)?(?:改|修|调)/.test(words)) return true;
  if (/底图|第\s*[一二三四1-4]\s*张/.test(words)) return false;
  // A direction can name the group and the desired change without saying "改图".
  const direction = /(?:([两二三四2-4])\s*张(?:图(?:片)?|画面)?|这些图|每张图)(?:的)?(?:冷暖|明暗|色彩|配色|颜色|光影|笔触|纹理|雾感|对比|层次)(?:变化|对比|层次|色调|质感)?(?:也|都)?(?:需要|应该|还要|要|希望|再|更)(?:再|更)?(?:拉开|加强|减弱|丰富|浓郁|柔和|明显|细腻|清晰|统一|有层次)/.exec(words);
  if (!direction) return false;
  const numeral = direction[1];
  if (!numeral) return true;
  const namedCount = Number(numeral) || '一二三四'.indexOf(numeral.replace('两', '二')) + 1;
  return namedCount === count;
}
