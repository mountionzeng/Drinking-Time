import { describe, expect, it } from 'vitest';
import type { ImageAsset } from '@shared/imageAsset';
import { buildImageAssetWorkspace } from './imageAssetViewModel';

function asset(
  id: number,
  canonicalShotNo: string | null,
  overrides: Partial<ImageAsset> = {},
): ImageAsset {
  return {
    id,
    projectId: 1,
    storyId: 1,
    userId: 1,
    rawShotNo: canonicalShotNo,
    canonicalShotNo,
    imageKey: null,
    imageUrl: `/api/images/${id}.png`,
    prompt: `prompt ${id}`,
    generationType: 'generate',
    parentImageId: null,
    isCurrent: true,
    maskKey: null,
    createdAt: `2026-06-13T00:00:0${id}.000Z`,
    kind: 'story_frame',
    status: 'pending',
    assignment: 'shot',
    availability: 'available',
    isPrimary: false,
    selectionSource: 'none',
    selectedAt: null,
    ...overrides,
  };
}

describe('buildImageAssetWorkspace', () => {
  it('把主图、待确认和淘汰版本放进同一标准镜头', () => {
    const model = buildImageAssetWorkspace([
      asset(1, 'SH02', { status: 'selected', isPrimary: true }),
      asset(2, 'SH02'),
      asset(3, 'SH02', { status: 'rejected' }),
    ], ['SH01', 'SH02']);
    const group = model.shotGroups.get('SH02');

    expect(group?.primary?.id).toBe(1);
    expect(group?.preview?.id).toBe(1);
    expect(group?.assets.map(item => item.id)).toEqual([1, 2, 3]);
  });

  it('没有主图时用最新待确认图作为工作区预览，但不伪造主图', () => {
    const model = buildImageAssetWorkspace([
      asset(1, 'SH01'),
      asset(2, 'SH01'),
    ], ['SH01']);
    const group = model.shotGroups.get('SH01');

    expect(group?.primary).toBeNull();
    expect(group?.preview?.id).toBe(2);
  });

  it('把待归属和美术依据从镜头版本中分离', () => {
    const model = buildImageAssetWorkspace([
      asset(1, null, { assignment: 'unassigned' }),
      asset(2, null, {
        assignment: 'style_reference',
        kind: 'style_reference',
      }),
    ], ['SH01']);

    expect(model.unassigned.map(item => item.id)).toEqual([1]);
    expect(model.styleReferences.map(item => item.id)).toEqual([2]);
    expect(model.shotGroups.get('SH01')?.assets).toEqual([]);
  });
});
