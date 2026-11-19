import type { ImageEditBatch, ImageEditBatchItem } from '../../../../server/services/chatImageEditBatch';

/** Purchase each confirmed output once, then only poll its persisted receipt. */
export async function runChatImageEditBatch(batch: ImageEditBatch, io: {
  active: () => boolean;
  submit: (item: ImageEditBatchItem) => Promise<unknown>;
  recover: (requestId: string) => Promise<unknown>;
  read: () => Promise<ImageEditBatch>;
  update: (batch: ImageEditBatch) => void;
  wait: () => Promise<void>;
}, purchase: boolean) {
  let current = batch;
  const approved = new Set(purchase ? batch.items.filter(item => item.status === 'ready').map(item => item.requestId) : []);
  for (const original of batch.items) {
    if (!io.active()) return;
    let item = current.items.find(item => item.requestId === original.requestId)!;
    if (item.status === 'ready' && approved.has(item.requestId)) {
      const response = await io.submit(item);
      if (!io.active()) return;
      current = await io.read(); if (!io.active()) return;
      io.update(current); item = current.items.find(item => item.requestId === original.requestId)!;
      if (item.status === 'ready') throw new Error(response && typeof response === 'object' && 'error' in response
        ? String(response.error) : '尚未取得任务回执，请刷新核对原任务。');
    }
    // Receipt recovery can be repeated; submit cannot. An unknown receipt blocks
    // later purchases, while already completed siblings remain visible.
    for (let attempt = 0; item.recoverable && item.status !== 'done' && item.status !== 'failed' && attempt < 60; attempt++) {
      if (!io.active()) return;
      await io.recover(item.requestId);
      if (!io.active()) return;
      current = await io.read(); if (!io.active()) return;
      io.update(current); item = current.items.find(item => item.requestId === original.requestId)!;
      if (item.status !== 'done' && item.status !== 'failed') await io.wait();
    }
    if (item.status !== 'done' && (approved.has(item.requestId) || item.status !== 'ready')) return;
  }
}
