import { expect, it, vi } from 'vitest';
import type { ImageEditBatch } from '../../../../server/services/chatImageEditBatch';
import { runChatImageEditBatch } from './runChatImageEditBatch';
function fixture() {
  const batch: ImageEditBatch = { storyId: 1, planMessageId: 'p', stableShotId: 's', shotNo: 3, unitEstimatedCny: 1.43, remainingEstimatedCny: 2.86,
    items: [1, 2].map(imageId => ({ imageId, imageUrl: `/${imageId}`, copy: 1, requestId: `r${imageId}`, status: 'ready', request: { prompt: 'edit', explicitInstruction: 'edit', referenceImageUrl: `/${imageId}`, referenceContextImageUrls: [] } })) };
  let current = structuredClone(batch);
  const io = { active: () => true, submit: vi.fn(async (item: typeof batch.items[number]) => { current.items.find(i => i.requestId === item.requestId)!.status = 'done'; }),
    recover: vi.fn(), read: vi.fn(async () => structuredClone(current)), update: vi.fn(), wait: vi.fn() };
  return { batch, current, io };
}
it('one confirmation generates both distinct outputs in order', async () => {
  const { batch, io } = fixture(); await runChatImageEditBatch(batch, io, true);
  expect(io.submit.mock.calls.map(([item]) => item.imageId)).toEqual([1, 2]); expect(io.update).toHaveBeenCalledTimes(2);
});
it('partial completion submits only the remaining output', async () => {
  const { batch, current, io } = fixture(); batch.items[0].status = current.items[0].status = 'done';
  await runChatImageEditBatch(batch, io, true); expect(io.submit.mock.calls.map(([item]) => item.imageId)).toEqual([2]);
});
it('refresh recovers receipts without buying ready siblings', async () => {
  const { batch, current, io } = fixture(); batch.items[0].status = current.items[0].status = 'pending'; batch.items[0].recoverable = true;
  io.recover.mockImplementation(async () => { current.items[0].status = 'done'; });
  await runChatImageEditBatch(batch, io, false); expect(io.submit).not.toHaveBeenCalled(); expect(io.recover).toHaveBeenCalledWith('r1');
});
it.each(['unknown', 'failed'] as const)('preserves the completed first result when the second is %s', async status => {
  const { batch, current, io } = fixture(); io.submit.mockImplementation(async item => { current.items.find(i => i.requestId === item.requestId)!.status = item.imageId === 1 ? 'done' : status; });
  await runChatImageEditBatch(batch, io, true); expect(io.submit).toHaveBeenCalledTimes(2);
  expect(io.update.mock.calls.at(-1)![0].items.map((i: any) => i.status)).toEqual(['done', status]);
});
it('stops remaining purchases and result publication after leaving a story', async () => {
  const { batch, io } = fixture(); let active = true; io.active = () => active;
  io.submit.mockImplementation(async () => { active = false; });
  await runChatImageEditBatch(batch, io, true); expect(io.submit).toHaveBeenCalledTimes(1); expect(io.update).not.toHaveBeenCalled();
});
