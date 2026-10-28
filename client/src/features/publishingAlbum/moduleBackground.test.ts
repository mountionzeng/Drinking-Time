import { legacyModuleStorageKey, moduleStorageKey } from "./imagePackModules";
import { describe, expect, it } from 'vitest';
import { moduleContentBasis, withModuleBackground } from './moduleBackground';
import type { ImagePackOptions } from './imagePackComposition';
const original: ImagePackOptions = { title: '故事', body: '手动正文', fontId: 'song', style: 'paper', includeCover: false, texture: 'paper', textureSeed: 1 };
describe('live module background', () => {
  it('applies paper and image backgrounds without adopting unrelated source changes', () => {
    const next = { ...original, body: '外部新正文', bodyTextureUrl: '/background.png', textureSeed: 2 };
    const updated = withModuleBackground(original, next);
    expect(updated.bodyTextureUrl).toBe('/background.png');
    expect(updated.body).toBe(original.body);
    expect(moduleContentBasis(updated)).toBe(moduleContentBasis(original));
    expect(moduleContentBasis(updated)).not.toBe(moduleContentBasis(next));
    expect(withModuleBackground(updated, original).bodyTextureUrl).toBeUndefined();
  });
  it('keeps source, font and image changes isolated', () => {
    for (const patch of [{ body: '新正文' }, { fontId: 'other' }, { coverUrl: '/other.png' }, { illustrations: [{ imageUrl: '/new.png', after: null }] }]) {
      expect(moduleContentBasis({ ...original, ...patch })).not.toBe(moduleContentBasis(original));
    }
  });
});

it('finds the existing platform layout when opening a chapter', () => {
  const source = JSON.stringify(original);
  const chapter = JSON.stringify({ fitOverflowText: true, ...original });
  expect(legacyModuleStorageKey('same-story', chapter)).toBe(moduleStorageKey('same-story', source));
  expect(legacyModuleStorageKey('other-story', chapter)).not.toBe(moduleStorageKey('same-story', source));
});
