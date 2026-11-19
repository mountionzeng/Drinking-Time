import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('./ChatImageReferenceChip', () => ({ ChatImageReferenceChip: () => null }));
import { ChatImageEditPlanCard } from './ChatImageEditPlanCard';
import { createChatImageEditPlan, imageEditPlanOutput, imageEditPlanQuote, chatImageEditPlanSchema } from '@shared/chatImageEditPlan';
import { legnextAspectRatio, legnextDiffusionPrompt } from '../../../../../server/services/render/adapters/legnextDiffusion';

afterEach(() => vi.unstubAllGlobals());

it('changing route preserves the complete creative request and the precision copy count', () => {
  vi.stubGlobal('React', React);
  const base = createChatImageEditPlan([{ imageId: 8, label: '树林', imageUrl: '/forest' }, { imageId: 9, label: '信封', imageUrl: '/mail' }], '按地面透视和方向光重新构图');
  base.status = 'submitted';
  base.images[0] = { ...base.images[0], role: 'target', copies: 2, purpose: '地面配色' };
  base.images[1] = { ...base.images[1], role: 'reference', purpose: '无字信封' };
  base.preserve = '同一套美术';
  const html = renderToStaticMarkup(<ChatImageEditPlanCard plan={{ ...base, status: 'draft' }} onChange={() => undefined} onSubmit={() => undefined} />);
  expect(html).toContain('原图精修 · 2.86 算力/张');
  expect(html).toContain('省算力（分镜 MJ）· 1.36 算力/4 张');
  const economy = chatImageEditPlanSchema.parse({ ...base, renderRoute: 'storyboard' });
  expect(imageEditPlanOutput(economy, 8, 1)).toEqual(imageEditPlanOutput(base, 8, 1));
  expect(imageEditPlanQuote(economy)).toMatchObject({ tasks: 1, candidates: 4, totalCny: 0.68 });
  expect(imageEditPlanQuote(base)).toMatchObject({ tasks: 2, candidates: 2, totalCny: 2.86 });
  expect(economy.images).toEqual(base.images);
  const aspectRatio = legnextAspectRatio('792:792');
  expect(legnextDiffusionPrompt({text: '林间空地', aspectRatio, referenceUrls: ['base', 'mail']})).toContain('base mail 林间空地 --v 7 --fast --ar 1:1');
});
