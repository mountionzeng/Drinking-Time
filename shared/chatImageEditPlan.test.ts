import { describe, expect, it } from 'vitest';
import { createChatImageEditPlan, imageEditPlanError, imageEditPlanOutputCount, imageEditPlanReply, chatImageEditPlanSchema, imageEditPlanOutput } from './chatImageEditPlan';

const refs = [11, 22, 33].map(imageId => ({ imageId, imageUrl: `/${imageId}.png`, label: `#${imageId}` }));
describe('chat image edit intent confirmation', () => {
  it('requires an explicit object choice before an ambiguous removal can be submitted', () => {
    const instruction = '不是这个范围，你只需要去掉一个飞机和他的尾巴就好了';
    const plan = createChatImageEditPlan(refs.slice(0, 1), instruction);
    expect(plan.changes).toBe(instruction);
    expect(imageEditPlanError(plan)).toContain('删除或保留哪一个');
    expect(plan.preserve).toContain('未要求修改');
    plan.images[0].purpose = '删除右下方的小飞机及其尾巴，保留左上的大飞机';
    expect(imageEditPlanError(plan)).toBeNull();
    plan.status = 'submitted';
    const output = imageEditPlanOutput(plan, 11, 1);
    expect(output.instruction).toContain(instruction);
    expect(output.instruction).toContain('右下方的小飞机及其尾巴');
    expect(chatImageEditPlanSchema.parse(plan)).toEqual(plan);
  });
  it('quotes each target separately with that exact base and keeps references, counts and preservation', () => {
    const plan = createChatImageEditPlan(refs, '只调整树冠颜色');
    plan.status = 'submitted'; plan.preserve = '飞机的大小、形状、位置、数量和颜色不变';
    plan.images[0].role = 'target'; plan.images[0].copies = 2;
    plan.images[1].role = 'target';
    plan.images[2].role = 'reference'; plan.images[2].purpose = '只参考暗部层次';
    const first = imageEditPlanOutput(plan, 11, 2);
    const second = imageEditPlanOutput(plan, 22, 1);
    expect(first.refs.map(image => image.imageId)).toEqual([11, 22, 33]);
    expect(second.refs.map(image => image.imageId)).toEqual([22, 11, 33]);
    expect(first.instruction).toContain('第 2/2 张');
    expect(second.instruction).toContain('本次只修改图片 #22');
    for (const output of [first, second]) {
      expect(output.instruction).toContain(plan.preserve);
      expect(output.instruction).toContain('参考图片 #33：只参考暗部层次');
      expect(output).not.toHaveProperty('accepted');
    }
    expect(() => imageEditPlanOutput(plan, 33, 1)).toThrow('待修改图片');
    expect(() => imageEditPlanOutput(plan, 22, 2)).toThrow('张数');
    plan.status = 'draft'; expect(() => imageEditPlanOutput(plan, 22, 1)).toThrow('先确认');
  });
  it('does not assume that several selected images mean one base plus references', () => {
    const plan = createChatImageEditPlan(refs, '综合这两张的颜色');
    expect(plan.images.map(image => image.role)).toEqual(['undecided', 'undecided', 'undecided']);
    expect(imageEditPlanError(plan)).toContain('用途');
    expect(plan.status).toBe('draft');
  });
  it('counts outputs by target and never counts a reference as an output', () => {
    const plan = createChatImageEditPlan(refs, '只调整树冠');
    plan.images[0] = { ...plan.images[0], role: 'target', copies: 2 };
    plan.images[1] = { ...plan.images[1], role: 'target', copies: 1 };
    plan.images[2] = { ...plan.images[2], role: 'reference', purpose: '只参考暗部层次' };
    expect(imageEditPlanError(plan)).toBeNull();
    expect(imageEditPlanOutputCount(plan)).toBe(3);
    expect(imageEditPlanReply(plan)).toContain('图片 #11：分别修改，生成 2 张');
    expect(imageEditPlanReply(plan)).toContain('图片 #33：仅作参考，不生成；只参考暗部层次');
  });
  it('requires exactly one base for a composite and an explicit reference purpose', () => {
    const plan = createChatImageEditPlan(refs, '合成');
    plan.mode = 'compose';
    plan.images = plan.images.map(image => ({ ...image, role: 'target' }));
    expect(imageEditPlanError(plan)).toContain('一张底图');
    plan.images[1].role = 'reference'; plan.images[2].role = 'omit';
    expect(imageEditPlanError(plan)).toContain('参考');
  });
  it('persists feedback without turning confirmation into paid authorization', () => {
    const plan = createChatImageEditPlan(refs.slice(0, 1), '调整树冠绿色');
    plan.preserve = '飞机的大小、位置、数量、形状和颜色保持原样';
    plan.status = 'submitted';
    const saved = chatImageEditPlanSchema.parse({ ...plan, accepted: true });
    expect(saved).toEqual(plan);
    expect(imageEditPlanReply(plan)).toContain(plan.preserve);
    expect(imageEditPlanReply(plan)).toContain('这次只确认要求，不批准付费生成或采用');
    expect(imageEditPlanReply(plan, 1.43)).toContain('确认以上要求和预计合计 2.86 算力');
    expect(imageEditPlanReply(plan, 1.43)).not.toContain('这次只确认要求');
  });
  it('rejects missing images, duplicate identities and invalid output counts', () => {
    const plan = createChatImageEditPlan(refs, '调整颜色');
    expect(chatImageEditPlanSchema.safeParse({ ...plan, images: [] }).success).toBe(false);
    expect(chatImageEditPlanSchema.safeParse({ ...plan, images: [plan.images[0], plan.images[0]] }).success).toBe(false);
    plan.images[0].copies = 0;
    expect(chatImageEditPlanSchema.safeParse(plan).success).toBe(false);
  });
});
