import type { ImagePackOptions } from './imagePackComposition';

/** A paper change repaints the current modules; it never imports new source text. */
export function withModuleBackground(session: ImagePackOptions, current: ImagePackOptions): ImagePackOptions {
  return { ...session, texture: current.texture, textureSeed: current.textureSeed,
    bodyTextureUrl: current.bodyTextureUrl, paperPalette: current.paperPalette };
}

export function moduleContentBasis(options: ImagePackOptions): string {
  const { texture, textureSeed, bodyTextureUrl, paperPalette, ...content } = options;
  return JSON.stringify(content);
}
