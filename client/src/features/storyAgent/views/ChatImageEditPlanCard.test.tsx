import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createChatImageEditPlan } from '@shared/chatImageEditPlan';
import { normalizeChatMessages } from '../types';
import { archiveMessagesFrom } from '../StoryAgentContext';
import { ChatImageEditPlanCard } from './ChatImageEditPlanCard';

const refs = [11, 22].map(imageId => ({ imageId, imageUrl: `/${imageId}.png`, label: `#${imageId}` }));
beforeEach(() => vi.stubGlobal('React', React));
afterEach(() => vi.unstubAllGlobals());

it('asks for image roles, counts, changes, preservation and tonal detail in the chat', () => {
  const plan = createChatImageEditPlan(refs, '协调颜色');
  plan.images[0].role = 'target';
  const html = renderToStaticMarkup(<ChatImageEditPlanCard plan={plan} onChange={vi.fn()} onSubmit={vi.fn()} />);
  for (const label of ['生成方式', '图片 #11 的用途', '图片 #11 生成张数', '哪些必须保留', '层次、配色及其他要求', '要改哪里']) expect(html).toContain(label);
  expect(html).toContain('src="/11.png"'); expect(html).toContain('src="/22.png"');
  expect(html).toContain('确认并生成'); expect(html).not.toContain('确认要求（不生成）');
});

it('an unresolved role cannot submit, and disabled or submitted plans cannot double submit', () => {
  const onSubmit = vi.fn();
  const plan = createChatImageEditPlan(refs, '协调颜色');
  const submit = (disabled = false) => {
    const element = ChatImageEditPlanCard({ plan, disabled, onChange: vi.fn(), onSubmit });
    element.props.onSubmit?.({ preventDefault: vi.fn() });
  };
  submit(); expect(onSubmit).not.toHaveBeenCalled();
  plan.images.forEach(image => { image.role = 'target'; });
  plan.preserve = '保留飞机';
  submit(true); expect(onSubmit).not.toHaveBeenCalled();
  submit(); expect(onSubmit).toHaveBeenCalledTimes(1);
  plan.status = 'submitted'; submit(); expect(onSubmit).toHaveBeenCalledTimes(1);
});

it('shows the current total before a single generation action, including changes to copy counts', () => {
  const plan = createChatImageEditPlan(refs, '调整树冠');
  plan.images.forEach(image => { image.role = 'target'; }); plan.preserve = '保留飞机';
  const view = () => renderToStaticMarkup(<ChatImageEditPlanCard plan={plan} onChange={vi.fn()} onSubmit={vi.fn()} />);
  expect(view()).toContain('预计合计 5.72 算力');
  expect(view()).toContain('确认并生成 2 张');
  plan.images[0].copies = 2;
  expect(view()).toContain('预计合计 8.58 算力');
  expect(view()).toContain('确认并生成 3 张');
  plan.preserve = '';
  expect(view()).toContain('请补充必须保留的内容');
  expect(view()).toMatch(/<button type="submit" disabled/);
});

it('round trips changed fields and submitted feedback through the real archive without authorization', () => {
  const plan = createChatImageEditPlan(refs, '只调树冠');
  plan.images[0].role = 'target'; plan.images[0].copies = 2;
  plan.images[1].role = 'reference'; plan.images[1].purpose = '暗部层次';
  plan.preserve = '原飞机的大小、颜色、位置和数量'; plan.details = '更通透但不抬亮全部暗部';
  for (const status of ['draft', 'submitted'] as const) {
    plan.status = status;
    const saved = archiveMessagesFrom([{ id: 'plan', role: 'assistant', content: '确认要求', timestamp: 1, imageEditPlan: plan }], []);
    expect(normalizeChatMessages(saved, [])[0].imageEditPlan).toEqual(plan);
  }
  const html = renderToStaticMarkup(<ChatImageEditPlanCard plan={plan} onChange={vi.fn()} onSubmit={vi.fn()} />);
  expect(html).toContain('没有提交生成'); expect(html).toContain('调整要求'); expect(html).not.toContain('type="submit"');
});

it('offers a separate quote for every requested output without generating on submit', () => {
  const plan = createChatImageEditPlan(refs, '调整树冠');
  plan.status = 'submitted'; plan.images.forEach(image => { image.role = 'target'; });
  const quote = vi.fn();
  const element = ChatImageEditPlanCard({ plan, onChange: vi.fn(), onSubmit: vi.fn(), onQuote: quote });
  const html = renderToStaticMarkup(element);
  expect(html).toContain('#11'); expect(html).toContain('#22'); expect(html).toContain('5.72');
  expect(html).toContain('逐张确认费用后生成');
  const buttons: React.ReactElement[] = [];
  const visit = (node: React.ReactNode) => React.Children.forEach(node, child => {
    if (!React.isValidElement<{children?: React.ReactNode}>(child)) return;
    if (child.type === 'button') buttons.push(child);
    visit(child.props.children);
  });
  visit(element);
  (buttons[0].props as { onClick: () => void }).onClick();
  (buttons[1].props as { onClick: () => void }).onClick();
  expect(quote.mock.calls).toEqual([[11, 1], [22, 1]]);
});
