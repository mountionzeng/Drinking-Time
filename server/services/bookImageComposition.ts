import { createHash, randomUUID } from 'node:crypto';
import { compositionSources, compositionReferences, compositionPrompt, compositionQuote, compositionShotNumbers, BOOK_COMPOSITION_MODEL, type CompositionSource } from '../../shared/bookImageComposition';
import { getStoryGeneratedImages } from '../repositories/images';
import type { BookModuleImageTask } from '../../shared/bookModuleImageTask';
import { writingModuleTexts } from '../../shared/bookWritingStyle';
import { getChapter } from '../repositories/chapters';
import { getStoryById } from '../repositories/stories';
import { moduleImageTasks, mutateModuleImageTasks } from '../repositories/bookModuleImageTasks';
import { getStoryImageAssets } from './imageAssets';
import { editImage, generateImage, resume302GptImageTask, type ImageGenResult } from './imageGen';
import { reservePublishingCoverRender, publishingCoverOperationId, finishPublishingCoverBilling } from './publishingCoverBilling';
import { mediaBillingEnabled } from './mediaComputeBilling';
import { renderViaGate } from './renderGate';

type Target = { userId: number; storyId: number; chapterId: number; moduleIds: string[] };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key = (target: Target) => `composition:${hash([...new Set(target.moduleIds)].sort()).slice(0, 40)}`;
const matches = (t: BookModuleImageTask, target: Target) => t.chapterId === target.chapterId && t.moduleId === key(target) && Boolean(t.composition);
const pending = (t: BookModuleImageTask) => !['failed', 'succeeded'].includes(t.status);
async function owned(target: Target) {
  const [story, chapter] = await Promise.all([getStoryById(target.storyId, target.userId), getChapter(target.chapterId, target.userId)]);
  if (!story || chapter?.storyId !== target.storyId) throw new Error('文章不存在或无权访问');
  return { story, chapter };
}
export async function listBookImageCompositions(input: {storyId:number;userId:number}) {
  const story=await getStoryById(input.storyId,input.userId);
  if(!story) throw new Error('故事不存在或无权访问');
  const tasks=moduleImageTasks(story.body).filter(task=>Boolean(task.composition));
  const body=(story.body ?? {}) as Record<string,unknown>;
  const shots=Array.isArray(body.shots)?body.shots:[];
  const images=await getStoryGeneratedImages(input.storyId,input.userId);
  return tasks.map((task,index)=>({...task,version:index+1,shotNumbers:compositionShotNumbers(task,tasks,shots,images)}));
}
export async function readBookImageComposition(target: Target) {
  const { story } = await owned(target);
  return moduleImageTasks(story.body).filter(t => matches(t, target)).at(-1) ?? null;
}
async function sourcesFor(target: Target, expected: CompositionSource[]) {
  const { chapter } = await owned(target);
  const texts = writingModuleTexts(chapter.blocks.body, chapter.blocks.writingStyle);
  const blocks = (chapter.blocks.writingStyle ?? []).map((b, i) => ({ id: b.id, text: texts[i] ?? '' }));
  const sources = compositionSources(blocks, target.moduleIds);
  if (hash(sources) !== hash(expected)) throw new Error('原模块已变化，请重新选择；已有结果保留在仓库');
  const assets = await getStoryImageAssets(target.storyId, target.userId);
  if (compositionReferences(sources).some(url => !assets.some(a => a.imageUrl === url && a.availability !== 'missing')))
    throw new Error('参考图尚未保存到仓库，请先保存文章');
  return sources;
}
async function saveResult(target: Target, id: string, result: ImageGenResult) {
  const task = await mutateModuleImageTasks(target, async (tasks, store) => {
    const task = tasks.find(t => t.id === id && matches(t, target));
    if (!task) throw new Error('图像方案不存在');
    if (task.status === 'succeeded' || task.status === 'failed') return task;
    if (result.status === 'ok' && result.imageUrl) {
      task.candidates = await store([{ imageUrl: result.imageUrl, imageKey: result.imageKey, prompt: task.composition!.compiledPrompt ?? '' }]);
      task.status = 'succeeded'; delete task.error;
    } else if (task.providerTaskId || result.providerTaskId) {
      task.providerTaskId ||= result.providerTaskId;
      task.status = result.providerConfirmedFailure ? 'failed' : 'accepted';
      task.error = result.message;
    } else {
      task.status = result.submissionUncertain ? 'unknown' : 'failed';
      task.error = result.message || '生成未完成';
    }
    return task;
  });
  await settle(task);
  return task;
}
async function settle(task: BookModuleImageTask) {
  if (task.status === 'succeeded') await finishPublishingCoverBilling(task.composition!.billingOperationId, 'succeeded');
  else if (task.status === 'failed') await finishPublishingCoverBilling(task.composition!.billingOperationId, 'definite_failure');
  else if (task.status === 'unknown') await finishPublishingCoverBilling(task.composition!.billingOperationId, 'uncertain');
}

export async function generateBookImageComposition(input: Target & {
  sources: CompositionSource[]; instruction: string; previousTaskId: string | null; estimatedCny: number;
}) {
  const sources = await sourcesFor(input, input.sources);
  const prior = await readBookImageComposition(input);
  if (prior && (pending(prior) || prior.id !== input.previousTaskId)) return prior;
  if (!prior && input.previousTaskId) throw new Error('图像方案已变化，请重新打开');
  const previousImage = prior?.status === 'succeeded' ? prior.candidates[0]?.imageUrl : undefined;
  const instructions = [...(prior?.composition?.instructions ?? []), input.instruction.trim()].filter(Boolean);
  if (instructions.join('\n').length > 10000) throw new Error('修改说明较长，请重新选择素材开始新方案');
  const prompt = compositionPrompt(sources, instructions, Boolean(previousImage));
  if (prompt.length > (compositionReferences(sources, previousImage).length ? 11000 : 5000))
    throw new Error('素材文字较长，请缩小选择范围；本次不会截断你的要求或提交生成');
  const estimatedCny = compositionQuote(sources, instructions, Boolean(previousImage));
  if (Math.abs(input.estimatedCny - estimatedCny) > 0.001) throw new Error('方案费用已更新，请重新确认');
  // One durable successor per revision, even across tabs and different request bodies.
  const requestId = `composition:${hash([input.chapterId, key(input), prior?.id ?? 'first'])}`;
  const operationId = mediaBillingEnabled() ? publishingCoverOperationId(input.userId, input.storyId, requestId) : null;
  const id = randomUUID();
  const task = await mutateModuleImageTasks(input, tasks => {
    const current = tasks.filter(t => matches(t, input)).at(-1);
    if (current && (pending(current) || current.id !== input.previousTaskId)) return current;
    const replay = tasks.find(t => matches(t, input) && t.requestId === requestId);
    if (replay) return replay;
    const next: BookModuleImageTask = { id, createdAt:Date.now(), requestId, chapterId: input.chapterId, moduleId: key(input), sourceHash: hash(sources), provider: 'gpt-image', status: 'preparing', candidates: [], composition: { sources, instructions, previousTaskId: prior?.id ?? null, estimatedCny, billingOperationId: operationId } };
    tasks.push(next); return next;
  });
  if (task.id !== id) return task;
  let submitted = false;
  try {
    const reservation = await reservePublishingCoverRender({ ...input, operationToken: requestId, provider: BOOK_COMPOSITION_MODEL, serverEstimateCny: estimatedCny });
    if (reservation.billed && reservation.replayed) throw new Error('已存在费用记录，请核对原任务，不能重新提交');
    const references = compositionReferences(sources, previousImage);
    const options = { provider: 'gpt-image' as const, gptImageModel: BOOK_COMPOSITION_MODEL, fidelity: 'final' as const,
      aspectRatio: '3:2', gptSubmitOnly: true, gptTimeoutMs: 90000,
      onProviderTaskAccepted: async (providerTaskId: string) => {
        await mutateModuleImageTasks(input, tasks => {
          const current = tasks.find(t => t.id === id)!;
          current.providerTaskId = providerTaskId; current.status = 'accepted';
        });
      },
    };
    const result = await renderViaGate({ prompt, userInstructions: [prompt], referenceImages: references,
      strictReferenceFidelity: references.length > 0, longPrompt: true, outputPurpose: 'image-edit',
      referencePolicy: references.length ? 'preserve-composition' : 'none',
    }, async compiled => {
      await mutateModuleImageTasks(input, tasks => { tasks.find(t => t.id === id)!.composition!.compiledPrompt = compiled; });
      submitted = true;
      return references.length
        ? editImage(references[0], compiled, { ...options, requireInputImage: true, preferStructuralEdit: true, referenceContextImageUrls: references.slice(1) })
        : generateImage(compiled, options);
    });
    return await saveResult(input, id, result);
  } catch (error) {
    return saveResult(input, id, { status: 'error', message: error instanceof Error ? error.message : '生成暂未完成', submissionUncertain: submitted });
  }
}

const refreshing = new Map<string, Promise<BookModuleImageTask | null>>();
export async function refreshBookImageComposition(target: Target) {
  const task = await readBookImageComposition(target);
  if (!task) return null;
  if (!task.providerTaskId || task.status !== 'accepted') { await settle(task); return task; }
  const existing = refreshing.get(task.id);
  if (existing) return existing;
  const work = resume302GptImageTask(task.providerTaskId, { gptTimeoutMs: 8000, gptPollIntervalMs: 1000 })
    .then(result => saveResult(target, task.id, result)).finally(() => refreshing.delete(task.id));
  refreshing.set(task.id, work);
  return work;
}
