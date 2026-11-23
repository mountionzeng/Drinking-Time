import { createChatImageEditPlan, resolveIndividualDirections } from '@shared/chatImageEditPlan';
import { groupedImageDirection, temperatureComparisonDraft, explicitlyEditAll } from './imageReferenceRoles';
import { withoutPictureRegionNotes } from "@shared/chatPictureRegion";
import { hasInlineChatImages, inlineImageToken, inlineChatImageIds, inlineChatInstruction, inlineChatParts } from '@shared/inlineChatImages';
import type { ChatImageRef } from './chatImageRefs';
import { isFrameRegionReviewImage, regionReviewDecision, regionInheritanceDecision, forestPaletteFeedbackDecision, forestPaletteConsistencyDecision, cloudShapeDecision, type FrameRegionReview } from '@shared/frameRegionReview';
import { isImageObjectRemoval } from '@shared/imageObjectRemoval';

export function compileInlineChatDraft(text: string, images: Array<{ imageId?: number; imageUrl: string; label: string }>) {
  const ids = inlineChatImageIds(text);
  const userText = withoutPictureRegionNotes(text);
  if (!inlineChatParts(userText).some(part => !part.imageId && part.text.trim())) throw new Error('请在图片旁写下想问或想改的内容');
  const refs = ids.map(imageId => {
    const image = images.find(i => i.imageId === imageId);
    if (!image?.imageUrl) throw new Error(`图片 #${imageId} 尚未加载或已不可用，请从仓库重新选择`);
    return { imageId, imageUrl: image.imageUrl, label: image.label } satisfies ChatImageRef;
  });
  const instruction = inlineChatInstruction(userText);
  // Comparison/advice is conversation, not authorization to generate an edited image.
  const question = /[？?]|哪个好|哪张好|如何|怎么|建议|是否|能否|可以吗|该不该|what|which|how|should|could/i.test(instruction);
  const negated = /暂不生成|先不生成|先别生成|不(?:要|用|需).{0,12}(?:改|调整|生成|重画|综合|融合|混合|合成)|(?<!分)别.{0,8}(?:改|生成|综合|融合|混合|合成)|don't|do not/i.test(instruction);
  // Object-size feedback can be an edit without the word “修改”. Still leave
  // questions, comparisons, completed changes and refusals in conversation.
  const sizeFeedback = /放大|缩小|[调变][大小]|[大小](?:一?点(?:点|儿)?|一些)/.test(instruction)
    && !/哪|为什么|为啥|为何|是不是|有没有|[吗么]|比.{0,20}[大小]|(?:已经|本来|原来|看起来).{0,20}(?:[大小]|放|缩)/.test(instruction)
    && !/(?:不(?:要|用|需|想)|无需|不必|(?<!分)别).{0,12}(?:[大小]|放|缩)/.test(instruction);
  const words = inlineChatParts(userText).filter(part => !part.imageId).map(part => part.text).join('').trim();
  const visualTextRemoval = /^(?:请|我希望|我想|这里|这张图(?:里|上)?)?\s*(?:不要(?:有|出现|显示)|不显示|去掉|删掉|移除|擦掉)(?:[这那]种|[这那]些|[这那]段|[这那]里的|具体的|多余的|画面上的|选中的|所有|任何|的|\s)*(?:文字|字样|字母|字|文案|标识)[。！!\s]*$/u.test(words);
  const removeSelection = userText !== text && /^(?:请)?(?:去掉|删掉|移除|擦掉)(?:这(?:个|里|块|部分)|选中(?:的)?(?:部分|区域)?|框选的(?:部分|区域)?)[。！!\s]*$/.test(words);
  const edit = isImageObjectRemoval(instruction) || !question && !negated && (visualTextRemoval || removeSelection || sizeFeedback || /改|调(?:整|一下|亮|暗|淡|深|暖|冷)|重画|重绘|生成|画一|出图|提高|降低|增加|减少|综合|融合|混合|合成|更(?:白|嫩|绿|亮|暗|淡|深|暖|冷)|edit|change|generate|redraw|blend|combine/i.test(instruction));
  const grouped = groupedImageDirection(userText, refs);
  const plan = !question && !negated && userText === text && refs.length > 1 && !/视频|音轨|字幕|先看看|只看|讨论|如果|假如/.test(words) ? (() => {
    if (grouped) {
      const comparison = temperatureComparisonDraft(grouped, refs);
      if (comparison) return comparison;
      if (explicitlyEditAll(grouped, refs.length) && !/合成|拼贴|参考/.test(grouped)) {
        return { ...createChatImageEditPlan(refs, grouped), individualDirections: true as const,
          changes: '按各图旁的要求分别修改。', preserve: '保留原图中未要求改变的内容。',
          images: refs.map(ref => ({ ...ref, role: 'target' as const, copies: 1, purpose: grouped })) };
      }
    }
    const individual = resolveIndividualDirections(createChatImageEditPlan(refs, instruction));
    if (individual.individualDirections) return individual;
  })() : undefined;
  return { refs, instruction: inlineChatInstruction(text), edit: edit || Boolean(plan), plan };
}

export function referenceWarehouseSelection(text: string, imageIds: readonly number[]) {
  if (hasInlineChatImages(text) || /视频|video|拆镜|首帧|尾帧/i.test(text) ||
    !/(?:这|那|它们|他们)[两二2三3四4五5几]张|[这那]些图|所选.{0,3}图|选中.{0,3}图|多图|both|these images/i.test(text)) return text;
  if (imageIds.length < 2) throw new Error('请在仓库选中要一起使用的图片，或把两张图放进输入框；尚未调用模型。');
  if (imageIds.length > 4) throw new Error('改图一次最多引用4张图片；当前视频多选保留，请减少改图引用后再发送。');
  return `${imageIds.map(inlineImageToken).join(' ')} ${text}`;
}

/** A selected image remains the editing subject until the user chooses another subject. */
export function continueInlineImageEdit(text: string, imageId: number | null | undefined, images: Parameters<typeof compileInlineChatDraft>[1], explicitContext = false) {
  if (!imageId || explicitContext || hasInlineChatImages(text) || /首帧|尾帧|视频|第\s*[\d一二三四五六七八九十]+\s*镜|#\s*\d/.test(text) ||
    /范围|蒙版|选区/.test(text) && !isImageObjectRemoval(text)) return text;
  const withImage = `${inlineImageToken(imageId)} ${text}`;
  return images.some(image => image.imageId === imageId) && compileInlineChatDraft(withImage, images).edit ? withImage : text;
}

/** A single cited review frame can answer its existing scope or palette question. */
export function selectedRegionReply(text: string, selectedId: number, review?: FrameRegionReview | null) {
  if (!review || review.phase === 'cancelled' || !isFrameRegionReviewImage(review, selectedId)) return null;
  let parts;
  try { parts = inlineChatParts(text); } catch { return null; }
  const ids = new Set(parts.flatMap(part => part.imageId ? [part.imageId] : []));
  if (ids.size !== 1 || !ids.has(selectedId)) return null;
  const reply = parts.filter(part => !part.imageId).map(part => part.text).join('').trim();
  return regionReviewDecision(reply) || regionInheritanceDecision(reply) || forestPaletteFeedbackDecision(reply) ||
    forestPaletteConsistencyDecision(reply) || (review.tasks.some(task => task.shapeQuote) && cloudShapeDecision(reply))
    ? reply : null;
}
