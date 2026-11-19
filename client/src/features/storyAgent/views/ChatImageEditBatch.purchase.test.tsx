import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { createChatImageEditPlan, imageEditPlanOutput } from '@shared/chatImageEditPlan';
import { buildChatImageRemixRequest } from '@shared/chatImageRefs';
import type { ImageEditBatch } from '../../../../../server/services/chatImageEditBatch';
import type { ImageEditPurchase } from '../imageEditPurchase';

const m = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as Array<() => void>, cleanups: [] as Array<() => void>,
  query: {} as any, generate: vi.fn(), recover: vi.fn(), read: vi.fn(), update: vi.fn(), invalidate: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: any) => { const i = m.cursor++; if (!(i in m.slots)) m.slots[i] = initial; return [m.slots[i], (value: any) => { m.slots[i] = typeof value === 'function' ? value(m.slots[i]) : value; }]; },
  useRef: (initial: any) => { const i = m.cursor++; return m.slots[i] ?? (m.slots[i] = { current: initial }); },
  useEffect: (fn: () => void | (() => void), deps: any[]) => { const i = m.cursor++; const prev = m.slots[i]; if (!prev || deps.some((dep, index) => !Object.is(dep, prev[index]))) { m.slots[i] = deps; m.effects.push(() => { const cleanup = fn(); if (cleanup) m.cleanups.push(cleanup); }); } },
}));
vi.mock('@/lib/trpc', () => ({ trpc: {
  storyAgent: { chatImageEditBatch: { useQuery: () => ({ ...m.query }) }, generateForMobile: { useMutation: () => ({ mutateAsync: m.generate }) }, recoverStoryboardImage: { useMutation: () => ({ mutateAsync: m.recover }) } },
  useUtils: () => ({ client: { storyAgent: { chatImageEditBatch: { query: m.read } } }, storyAgent: { chatImageEditBatch: { setData: m.update }, storyMaterialState: { invalidate: m.invalidate }, chatImageRevisions: { invalidate: m.invalidate } } }),
} }));
import { ChatImageEditBatch } from './ChatImageEditBatch';

beforeEach(() => { m.slots = []; m.effects = []; m.cleanups = []; vi.clearAllMocks(); vi.stubGlobal('React', React); });
function fixture() {
  const plan = createChatImageEditPlan([11, 22].map(imageId => ({ imageId, imageUrl: `/${imageId}.png`, label: `#${imageId}` })), '只调树冠');
  plan.status = 'submitted'; plan.preserve = '保留飞机'; plan.images.forEach(image => { image.role = 'target'; });
  const batch: ImageEditBatch = { storyId: 1, planMessageId: 'p', stableShotId: 's3', shotNo: 3, unitEstimatedCny: 1.43, remainingEstimatedCny: 2.86,
    items: plan.images.map(image => ({ imageId: image.imageId, imageUrl: image.imageUrl, copy: 1, requestId: `${image.imageId}`, status: 'ready', request: buildChatImageRemixRequest(imageEditPlanOutput(plan, image.imageId, 1)) as ImageEditBatch['items'][number]['request'] })) };
  const current = structuredClone(batch);
  let purchase: ImageEditPurchase | undefined = { storyId: 1, planMessageId: 'p', stableShotId: 's3', unitEstimatedCny: 1.43, plan };
  const consumed = vi.fn(() => { purchase = undefined; });
  m.query = { data: batch, isFetching: false, error: null, refetch: vi.fn() };
  m.read.mockImplementation(async () => structuredClone(current));
  m.update.mockImplementation((_input, data) => { m.query.data = data; });
  m.generate.mockImplementation(async ({ imageEditPlanOutput: output }) => { current.items.find(item => item.imageId === output.imageId)!.status = 'done'; return { status: 'ok' }; });
  const render = () => { m.cursor = 0; const element = ChatImageEditBatch({ storyId: 1, planMessageId: 'p', purchase, onPurchaseConsumed: consumed, onBusyChange: vi.fn(), onSelect: vi.fn() }); m.effects.splice(0).forEach(fn => fn()); return element; };
  return { batch, current, render, consumed, clearPurchase: () => { purchase = undefined; }, unmount: () => m.cleanups.splice(0).forEach(fn => fn()) };
}

it('continues the priced click after the plan saves and sends both outputs once without a second confirmation', async () => {
  const f = fixture(); m.query.data = undefined; m.query.isFetching = true;
  const waiting = f.render(); expect(waiting.props.children[0]).toContain('正在保存要求'); expect(m.generate).not.toHaveBeenCalled();
  m.query.data = f.batch; m.query.isFetching = false;
  f.render(); f.render();
  await vi.waitFor(() => expect(m.generate).toHaveBeenCalledTimes(2));
  expect(f.consumed).toHaveBeenCalledTimes(1);
  expect(m.generate.mock.calls.map(([input]) => input.imageEditPlanOutput.imageId)).toEqual([11, 22]);
  expect(m.generate.mock.calls[0][0].costConfirmation).toEqual({ accepted: true, estimatedCny: 1.43 });
  f.render(); expect(m.generate).toHaveBeenCalledTimes(2); f.unmount();
});

it('opening or refreshing a saved plan never purchases without a new click', () => {
  const f = fixture(); f.clearPurchase(); f.render(); f.render(); expect(m.generate).not.toHaveBeenCalled(); f.unmount();
});

it('consumes a failed save without buying when a later refresh finally reads the plan', () => {
  const f = fixture(); m.query.data = undefined; m.query.error = new Error('尚未保存');
  f.render(); expect(f.consumed).toHaveBeenCalledTimes(1);
  m.query.data = f.batch; m.query.error = null; f.render();
  expect(m.generate).not.toHaveBeenCalled(); f.unmount();
});

it('stops a changed quote and exposes the reason instead of silently spending', () => {
  const f = fixture(); f.batch.unitEstimatedCny = 5; f.render();
  expect(m.generate).not.toHaveBeenCalled(); expect(f.render().props.error).toContain('预计费用已变化'); f.unmount();
});

it('leaving during a submission stops the remaining purchase and late result publication', async () => {
  const f = fixture(); let finish!: () => void;
  m.generate.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  f.render(); expect(m.generate).toHaveBeenCalledTimes(1); f.unmount(); finish();
  await Promise.resolve(); await Promise.resolve();
  expect(m.generate).toHaveBeenCalledTimes(1); expect(m.update).not.toHaveBeenCalled();
});
