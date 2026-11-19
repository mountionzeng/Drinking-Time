import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { ChatImageEditBatchView, imageEditBatchQueryOptions } from './ChatImageEditBatch';
import { QueryClient } from '@tanstack/react-query';
import type { ImageEditBatch } from '../../../../../server/services/chatImageEditBatch';
vi.stubGlobal('React', React);
it('waits for a newly confirmed plan to save, but bounds missing-plan reads and does not retry unrelated errors', async () => {
  const client = new QueryClient();
  const pending = new Error('修改要求尚未保存，请先确认要求。');
  const saved = vi.fn().mockRejectedValueOnce(pending).mockResolvedValue({ items: [] });
  await expect(client.fetchQuery({ queryKey: ['saved'], queryFn: saved, ...imageEditBatchQueryOptions, retryDelay: 0 })).resolves.toEqual({ items: [] });
  expect(saved).toHaveBeenCalledTimes(2);
  const missing = vi.fn().mockRejectedValue(pending);
  await expect(client.fetchQuery({ queryKey: ['missing'], queryFn: missing, ...imageEditBatchQueryOptions, retryDelay: 0 })).rejects.toThrow('尚未保存');
  expect(missing).toHaveBeenCalledTimes(4);
  const denied = vi.fn().mockRejectedValue(new Error('无权访问'));
  await expect(client.fetchQuery({ queryKey: ['denied'], queryFn: denied, ...imageEditBatchQueryOptions, retryDelay: 0 })).rejects.toThrow('无权访问');
  expect(denied).toHaveBeenCalledTimes(1);
  client.clear();
});
it('shows both outputs together, reuses the first, and quotes only the remaining image', () => {
  const batch: ImageEditBatch = { storyId: 1217, planMessageId: 'p', stableShotId: 's3', shotNo: 3, unitEstimatedCny: 1.43, remainingEstimatedCny: 1.43,
    items: [2119, 2092].map((imageId, i) => ({ imageId, imageUrl: `/${imageId}.png`, copy: 1, requestId: `${i}`, status: i === 0 ? 'done' : 'ready', result: i === 0 ? { imageId: 2122, imageUrl: '/2122.png' } : undefined,
      request: { prompt: '', explicitInstruction: '', referenceImageUrl: '', referenceContextImageUrls: [] } })) };
  const html = renderToStaticMarkup(<ChatImageEditBatchView batch={batch} busy={false} onConfirm={vi.fn()} onRecover={vi.fn()} onSelect={vi.fn()} />);
  for (const text of ['同批 2 张', '已完成 1/2', '#2119', '#2092', '#2122', '2.86', '确认费用并生成剩余 1 张', '直接复用', 'src="/2122.png"']) expect(html).toContain(text);
  expect(html).not.toContain('5.72');
  batch.items[1].status = 'unknown';
  const blocked = renderToStaticMarkup(<ChatImageEditBatchView batch={batch} busy={false} onConfirm={vi.fn()} onRecover={vi.fn()} onSelect={vi.fn()} />);
  expect(blocked).toContain('不重新购买'); expect(blocked).not.toContain('确认费用并生成'); expect(blocked).toContain('/2122.png');
});
