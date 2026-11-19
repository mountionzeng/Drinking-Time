import { expect, it } from 'vitest';
import { confirmedImageEditPlanId, createChatImageEditPlan } from '../../shared/chatImageEditPlan';
import { mergeStaleStoryBody } from './storySync';

it('keeps a committed plan snapshot when stale saves must preserve the original server message', () => {
  const original = { id: 'plan', who: 's', text: '确认要求', imageEditPlan: createChatImageEditPlan([{ imageId: 11, imageUrl: '/11.png', label: '#11' }], '树冠配色') };
  const confirmed = { ...original, id: confirmedImageEditPlanId(original.id), imageEditPlan: { ...original.imageEditPlan, status: 'submitted', preserve: '飞机大小、形状和颜色不变' } };
  const server = { messages: [original, { id: 'other', who: 'u', text: '另一条未覆盖的编辑' }], shots: [], videoWorkflow: { keep: 'current version' } };
  // Updating an old message in a stale body is deliberately ignored.
  const stale = mergeStaleStoryBody(server, { messages: [{ ...confirmed, id: original.id }], shots: [] }, 5);
  expect(stale.messages).toEqual(server.messages);
  const saved = mergeStaleStoryBody(server, { messages: [original, confirmed], shots: [] }, 6);
  expect(saved.messages).toContainEqual(confirmed);
  expect(saved.messages).toContainEqual(server.messages[1]);
  expect(saved.videoWorkflow).toEqual(server.videoWorkflow);
  const replayed = mergeStaleStoryBody(saved, { messages: [original, confirmed], shots: [] }, 7);
  expect((replayed.messages as typeof original[]).filter(message => message.id === confirmed.id)).toHaveLength(1);
});
