import { readBookImage } from './bookImageBlock';
import { readBookAudio } from './bookAudioBlock';
import type { BookModuleImageTask } from './bookModuleImageTask';

export const BOOK_COMPOSITION_MODEL = 'gpt-image-2.5-sunburst' as const;
export type CompositionSource = { id: string; text: string };
export type BookImageComposition = {
  sources: CompositionSource[];
  instructions: string[];
  previousTaskId: string | null;
  estimatedCny: number;
  billingOperationId: string | null;
  compiledPrompt?: string;
  /** Render profile frozen at submission (see shared/renderProfiles.ts). */
  renderProfile?: import('./renderProfiles').RenderProfileSnapshot;
};

/** Resolve actual shot links, never infer a shot from creative prose or reference-image contents. */
export function compositionShotNumbers(task: BookModuleImageTask, tasks: BookModuleImageTask[], shots: unknown[], images: { id: number; shotIdentity: string | null; shotNo: string | null }[]): number[] {
  const related = tasks.filter(t => t.chapterId === task.chapterId && t.moduleId === task.moduleId);
  const chain = new Set([task.id]);
  let size = 0;
  while (size !== chain.size) {
    size = chain.size;
    for (const t of related) {
      const previous = t.composition?.previousTaskId;
      if (previous && (chain.has(t.id) || chain.has(previous))) { chain.add(t.id); chain.add(previous); }
    }
  }
  const candidateIds = new Set(related.filter(t => chain.has(t.id)).flatMap(t => t.candidates.map(i => i.imageId)));
  const sourceIds = new Set(task.composition?.sources.map(s => `${task.chapterId}:${s.id}`));
  const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {};
  return [...new Set(shots.flatMap(raw => {
    const shot = record(raw), source = record(shot.publishingVideo);
    const shotNo = Number(shot.shotNo), identity = shot.stableShotId || shot.shotIdentity;
    if (!Number.isInteger(shotNo) || shotNo < 1) return [];
    const moduleMatch = Array.isArray(source.sourceModuleIds) && source.sourceModuleIds.some(id => sourceIds.has(String(id)));
    const resultMatch = Array.isArray(source.referenceImageIds) && source.referenceImageIds.some(id => candidateIds.has(Number(id)));
    const assigned = images.some(i => candidateIds.has(i.id) && (i.shotIdentity
      ? i.shotIdentity === identity
      : /^(?:SH)?0*\d+$/i.test(i.shotNo ?? '') && Number(i.shotNo!.replace(/^SH/i, '')) === shotNo));
    return moduleMatch || resultMatch || assigned ? [shotNo] : [];
  }))].sort((a, b) => a - b);
}

export function compositionSources(blocks: CompositionSource[], ids?: readonly string[]) {
  const selected = ids?.length ? blocks.filter(b => ids.includes(b.id)) : blocks;
  if (ids?.some(id => !blocks.some(b => b.id === id))) throw new Error('所选模块已变化，请重新选择');
  if (selected.some(b => readBookAudio(b.text))) throw new Error('请只选择图片和文字模块；音频暂不能合并为图像');
  const sources = selected.filter(b => b.text.trim()).map(({ id, text }) => ({ id, text }));
  if (!sources.length) throw new Error('请先写下想法，或选择图片、文字模块');
  if (sources.length > 200 || sources.reduce((n, b) => n + b.text.length, 0) > 30000)
    throw new Error('内容较多，请选中这次想整合的模块后再生成');
  if (new Set(sources.map(b => readBookImage(b.text)?.url).filter(Boolean)).size > 15)
    throw new Error('一次最多整合 15 张参考图，请缩小选择范围');
  return sources;
}

export function compositionReferences(sources: CompositionSource[], latestUrl?: string) {
  return [...new Set([latestUrl, ...sources.map(b => readBookImage(b.text)?.url)].filter((s): s is string => Boolean(s)))];
}

export function compositionPrompt(sources: CompositionSource[], instructions: string[], revision: boolean) {
  const text = sources.filter(b => !readBookImage(b.text)).map(b => b.text).join('\n\n');
  return [
    '根据用户提供的素材和创作要求制作一张完整图片。',
    revision ? '图1是上一轮结果，其余图片是最初素材。只根据本轮反馈修改，保留已经确认的内容；原始素材始终作为造型和风格依据。' : '参考图按书稿中的顺序提供。将所选素材按照以下想法整合成一个画面，不要把整张素材简单拼成联系表。',
    text ? `所选文字与想法：\n${text}` : '',
    ...instructions.map((s, i) => `${i === instructions.length - 1 ? '本轮要求' : '此前要求'}：${s}`),
  ].filter(Boolean).join('\n\n');
}

/** Product quote using the project's existing 302 token rates/conversion. Not a supplier invoice. */
export function compositionQuote(sources: CompositionSource[], instructions: string[], revision: boolean) {
  const images = compositionReferences(sources).length + (revision ? 1 : 0);
  const prompt = compositionPrompt(sources, instructions, revision);
  const ptc = (images * 2048 * 8 + (prompt.length * 2 + 256) * 5 + 6500 * 30) / 1_000_000;
  return Math.ceil(ptc * (0.35 / 0.052) * 100) / 100;
}

/** Explicit creation requests only: a discussion about images must remain ordinary chat. */
export function isBookImageCreationIntent(text: string) {
  if (/(不要|别|不想|不用|无需|不需要).{0,8}(生成|画|做|合并|创作)/.test(text)) return false;
  return /(?:生成|创作|绘制|画|做|合并|整合|合成).{0,12}(?:图片|图像|插画|插图|一张图|张图|幅图)|(?:generate|create|draw|make|combine).{0,30}(?:image|picture|illustration)/i.test(text);
}
