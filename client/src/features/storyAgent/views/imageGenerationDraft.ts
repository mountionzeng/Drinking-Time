import { displayShotCode } from '@shared/shotIdentity';
import type { StoryMaterialState } from '@shared/storyMaterial';
import type { ImageAsset } from '@shared/imageAsset';
import { shotRenderReferencesSchema, type ShotRenderReferences } from '@shared/shotImageRender';
import { shotRenderReferenceOptions, selectedReferenceKeys, type RenderReferenceOption } from './ShotImageRenderControl';

export type ComposerImage = RenderReferenceOption & { image?: ImageAsset };
export type ImageGenerationDraft = { instruction: string; references: ShotRenderReferences };
export const referenceToken = (key: string) => `[[ref:${encodeURIComponent(key)}]]`;
export function promptParts(text: string): Array<{ text: string; key?: string }> {
  return text.split(/(\[\[ref:[^\]\n]+\]\])/g).filter(Boolean).map(part => {
    if (!part.startsWith('[[ref:')) return { text: part };
    try { return { text: part, key: decodeURIComponent(part.slice(6, -2)) }; }
    catch { return { text: part, key: '' }; }
  });
}
export function composerImages(material: StoryMaterialState, language: string): ComposerImage[] {
  const images = new Map<number, ImageAsset>();
  for (const image of [
    ...material.unassignedImages,
    ...material.shots.flatMap(shot => [...shot.imageVersions, ...(shot.relatedImages ?? []),
      ...(shot.currentImage ? [shot.currentImage] : []), ...(shot.imageGenerationReferences ?? []),
      ...(shot.imageGenerationReference ? [shot.imageGenerationReference] : [])]),
    ...(material.visualAssets?.images ?? []),
    ...(material.artSystemReference ? [material.artSystemReference.image] : []),
    ...(material.filmStyleReference?.image ? [material.filmStyleReference.image] : []),
    ...(material.warehouseImages ?? []),
  ]) {
    if (image.imageUrl && image.availability !== 'missing' && (!image.storyId || image.storyId === material.storyId)) images.set(image.id, image);
  }
  const zh = language.startsWith('zh');
  const shotCodes = new Map(material.shots.map(shot => [shot.stableShotId, displayShotCode(shot)]));
  function label(image: ImageAsset) {
    const ids = image.libraryShotIds ?? (image.shotIdentity ? [image.shotIdentity] : []);
    const codes = ids.flatMap(id => shotCodes.has(id) ? [shotCodes.get(id)!] : []);
    const source = codes.length ? (zh ? '镜头 ' : 'Shot ') + codes.join(' / ') : (zh ? '仓库图片' : 'Library image');
    return source + ' · #' + image.id;
  }
  return [
    ...shotRenderReferenceOptions(material).filter(option => option.kind),
    ...Array.from(images.values()).sort((a, b) => b.id - a.id).map(image => ({
      key: `image:${image.id}`, imageId: image.id, imageUrl: image.imageUrl, image,
      label: label(image),
    })),
  ];
}
export function initialImagePrompt(instruction: string, refs: ShotRenderReferences): string {
  const tokens = selectedReferenceKeys(refs).map(referenceToken).join(' ');
  return [instruction.trim(), tokens].filter(Boolean).join('\n\n');
}
/** The editor's atoms are the complete selection. Deleting a final occurrence removes the reference. */
export function compileImageDraft(document: string, options: ComposerImage[], initial: ShotRenderReferences): ImageGenerationDraft {
  const parts = promptParts(document);
  const keys = [...new Set(parts.filter(part => part.key !== undefined).map(part => part.key!))];
  const selected = keys.map(key => {
    const option = options.find(item => item.key === key);
    if (!option) throw new Error('missing-reference');
    return option;
  });
  if (selected.length > 4) throw new Error('reference-limit');
  const assets: ShotRenderReferences['assets'] = {};
  const imageIds: number[] = [];
  for (const option of selected) {
    if (option.kind) {
      if (assets[option.kind]) throw new Error('duplicate-asset-kind');
      assets[option.kind] = { assetId: option.assetId!, versionId: option.versionId! };
    } else if (option.imageId) imageIds.push(option.imageId);
  }
  if (!parts.some(part => part.key === undefined && part.text.trim())) throw new Error('empty-prompt');
  const instruction = parts.map(part => {
    if (part.key === undefined) return part.text;
    const option = selected.find(item => item.key === part.key)!;
    return option.imageId ? `图${imageIds.indexOf(option.imageId) + 1}` : `「${option.label}」`;
  }).join('').trim();
  const manifest = imageIds.length ? `\n\n参考图片按图1至图${imageIds.length}的顺序提供，仅使用描述中要求的内容。` : '';
  if ((instruction + manifest).length > 2000) throw new Error('prompt-limit');
  return { instruction: instruction + manifest, references: shotRenderReferencesSchema.parse({
    imageIds, assets, instructionMode: 'composed', filmStyleVersion: initial.filmStyleVersion,
    ...(initial.imagePurpose && imageIds.length === 1 && imageIds[0] === initial.imageIds[0] && !Object.keys(assets).length
      ? { imagePurpose: initial.imagePurpose } : {}),
  }) };
}

/** Read only text and known atomic references; pasted markup is never submitted. */
export function readImagePrompt(root: Node): string {
  const walk = (node: Node): string => {
    if (node.nodeType === 3) return node.textContent ?? '';
    if (node.nodeType !== 1) return '';
    const element = node as HTMLElement;
    if (element.hasAttribute('data-ref-key')) {
      const token = referenceToken(element.getAttribute('data-ref-key')!);
      return element.dataset.regionNote ? token + ' ' + element.dataset.regionNote : token;
    }
    if (element.tagName === 'BR') return '\n';
    const text = children(node);
    return /^(DIV|P)$/.test(element.tagName) ? text + '\n' : text;
  };
  const children = (node: Node) => Array.from(node.childNodes).reduce((result, child) => {
    const block = child.nodeType === 1 && /^(DIV|P)$/.test((child as Element).tagName);
    return result + (block && result && !result.endsWith('\n') ? '\n' : '') + walk(child);
  }, '');
  return children(root).replace(/\u00a0/g, ' ').replace(/\n+$/, '');
}
