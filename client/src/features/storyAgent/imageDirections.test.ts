import { describe, expect, it } from 'vitest';
import { imageEditPlanOutput } from '@shared/chatImageEditPlan';
import { inlineImageToken } from '@shared/inlineChatImages';
import { compileInlineChatDraft } from './inlineChatDraft';
import { archiveMessagesFrom } from './archiveChatMessages';
import { normalizeChatMessages } from './types';
import { resolveShotImageMentions } from './views/shotImageNames';

const refs = [11, 22, 33].map((imageId, i) => ({ imageId, imageUrl: '/frame/' + imageId, label: '0101 · V0' + (i + 1) }));
const names = new Map(refs.map(ref => [ref.imageId, ref.label]));
const tokens = refs.map(ref => inlineImageToken(ref.imageId));
describe('versioned image edit drafts', () => {
  it('retains an older version and individually edited fields through the archive format', () => {
    const text = resolveShotImageMentions('0101 · V01 提亮画面，0101 · V03 降低对比', names);
    const plan = compileInlineChatDraft(text, refs).plan!;
    expect(plan.images.map(im => im.imageId)).toEqual([11, 33]);
    expect(plan.images[1].purpose).toBe('降低对比');
    plan.images[0].purpose = '增加侧光';
    const saved = archiveMessagesFrom([{ id: 'sample', role: 'assistant', content: '核对', timestamp: 1, imageEditPlan: plan }], []);
    expect(normalizeChatMessages(JSON.parse(JSON.stringify(saved)), [])[0].imageEditPlan).toEqual(plan);
    expect(() => imageEditPlanOutput(plan, 11, 1)).toThrow();
    const out = imageEditPlanOutput({ ...plan, status: 'submitted' }, 11, 1);
    expect(out.refs.map(im => im.imageId)).toEqual([11]);
    expect(out.instruction).toContain('增加侧光');
    expect(out.instruction).not.toContain('降低对比');
  });
  it('keeps a distinct warm, transition and cool instruction and quotes three outputs', () => {
    const plan = compileInlineChatDraft(tokens.join(' ') + ' 三张图之间的冷暖拉开', refs).plan!;
    expect(plan.status).toBe('draft');
    expect(plan.images.map(im => [im.role, im.copies])).toEqual(Array(3).fill(['target', 1]));
    expect(plan.images.map(im => im.purpose)).toEqual([expect.stringContaining('偏暖'), expect.stringContaining('过渡'), expect.stringContaining('偏冷')]);
    const out = imageEditPlanOutput({ ...plan, status: 'submitted' }, 22, 1);
    expect(out.refs[0].imageId).toBe(22);
  });
  it('leaves questions, refusals, composite edits and ambiguous versions for clarification', () => {
    for (const words of ['三张图之间的冷暖拉开吗？', '先看看，暂不生成', '合成一张']) {
      expect(compileInlineChatDraft(tokens.join(' ') + words, refs).plan).toBeUndefined();
    }
    expect(() => resolveShotImageMentions('0101 · V02', new Map([...names, [41, '0101 · V02']]))).toThrow();
    expect(() => compileInlineChatDraft(tokens[0] + ' 调亮', refs.slice(1))).toThrow();
  });
});
