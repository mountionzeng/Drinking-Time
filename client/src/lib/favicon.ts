import type { NayinElement } from './nayin';

type FaviconPreset = {
  emoji: string;
  bg: string;
};

// Keep icons in the "drink" family the user asked for: coconut / beer / tea.
const FAVICON_BY_ELEMENT: Record<NayinElement, FaviconPreset> = {
  metal: { emoji: '🍺', bg: '#fff2d9' },
  wood: { emoji: '🍵', bg: '#eaf8ea' },
  water: { emoji: '🥥', bg: '#f5f2e9' },
  fire: { emoji: '🫖', bg: '#fdece6' },
  earth: { emoji: '☕', bg: '#f6eee7' },
};

const FAVICON_RELS = ['icon', 'shortcut icon', 'apple-touch-icon'] as const;

function buildEmojiFaviconSvg(preset: FaviconPreset): string {
  // 24x24 viewBox + large text size makes the drink mark render
  // ~2x larger than the previous favicon visual density.
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <rect width="24" height="24" rx="5" fill="${preset.bg}" />
  <text x="12" y="17.2" text-anchor="middle" font-size="20">${preset.emoji}</text>
</svg>`.trim();
}

function ensureFaviconLink(rel: string): HTMLLinkElement {
  const selector = `link[rel="${rel}"]`;
  let link = document.head.querySelector(selector) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.rel = rel;
    document.head.appendChild(link);
  }
  return link;
}

export function setNayinFavicon(element: NayinElement): void {
  const preset = FAVICON_BY_ELEMENT[element];
  const svg = buildEmojiFaviconSvg(preset);
  const href = `data:image/svg+xml,${encodeURIComponent(svg)}`;

  FAVICON_RELS.forEach((rel) => {
    const link = ensureFaviconLink(rel);
    link.type = 'image/svg+xml';
    link.href = href;
  });
}
