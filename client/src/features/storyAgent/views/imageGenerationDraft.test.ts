import { expect, it } from 'vitest';
import { compileImageDraft, initialImagePrompt, referenceToken, composerImages } from './imageGenerationDraft';
import type { StoryMaterialState } from '@shared/storyMaterial';
const options = [1, 2, 3, 4, 5].map(id => ({ key: `image:${id}`, imageId: id, imageUrl: `/image/${id}`, label: `Image ${id}` }));
const token = (id: number) => referenceToken(`image:${id}`);
it('preserves cursor order and repeated mentions while submitting each image once', () => {
  const draft = compileImageDraft(`取${token(2)}的花，放进${token(1)}里，再用${token(2)}的颜色`, options, { imageIds: [], assets: {}, filmStyleVersion: 4 });
  expect(draft.instruction).toContain('取图1的花，放进图2里，再用图1的颜色');
  expect(draft.references).toEqual({ imageIds: [2, 1], assets: {}, filmStyleVersion: 4, instructionMode: 'composed' });
});
it('removing every chip explicitly clears all content references but retains film style version', () => {
  const draft = compileImageDraft('只有一条小船', options, { imageIds: [1], assets: {}, filmStyleVersion: 8, imagePurpose: 'scene-style' });
  expect(draft.references).toEqual({imageIds: [], assets: {}, filmStyleVersion: 8, instructionMode: 'composed'});
  expect(draft.instruction).toBe('只有一条小船');
});
it('keeps continuity purpose only for the originally selected single image', () => {
  const initial = { imageIds: [1], assets: {}, imagePurpose: 'scene-style' as const };
  expect(compileImageDraft(initialImagePrompt('船', initial), options, initial).references.imagePurpose).toBe('scene-style');
  expect(compileImageDraft(`船${token(2)}`, options, initial).references.imagePurpose).toBeUndefined();
});
it('rejects missing references, too many unique references and empty descriptions', () => {
  const refs = { imageIds: [], assets: {} };
  expect(() => compileImageDraft(`船${token(99)}`, options, refs)).toThrow('missing-reference');
  expect(() => compileImageDraft(`船${[1,2,3,4,5].map(token).join('')}`, options, refs)).toThrow('reference-limit');
  expect(() => compileImageDraft(token(1), options, refs)).toThrow('empty-prompt');
  expect(() => compileImageDraft('x'.repeat(2001), options, refs)).toThrow('prompt-limit');
});
it('includes warehouse-only images, deduplicates, and excludes missing/foreign images', () => {
  const image = { id: 1, storyId: 7, imageUrl: '/1' };
  const material = { storyId: 7, shots: [], unassignedImages: [image], warehouseImages: [image, { id: 2, storyId: 8, imageUrl: '/2' }, {id: 3, imageUrl: '/3', availability: 'missing'}] } as unknown as StoryMaterialState;
  expect(composerImages(material, 'en').map(i => i.imageId)).toEqual([1]);
});
it('retains explicit asset versions and rejects two versions of one asset kind', () => {
  const assets = [1,2].map(id => ({ key: `asset:v${id}`, label: `Person V${id}`, imageUrl: '/person', kind: 'character' as const, assetId: 'a', versionId: `v${id}` }));
  const draft = compileImageDraft(`Person ${referenceToken('asset:v1')}`, assets, {imageIds:[],assets:{}});
  expect(draft.references.assets).toEqual({character:{assetId:'a',versionId:'v1'}});
  expect(() => compileImageDraft(`Person ${assets.map(a => referenceToken(a.key)).join(' ')}`, assets, {imageIds:[],assets:{}})).toThrow('duplicate-asset-kind');
});
