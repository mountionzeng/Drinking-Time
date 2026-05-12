import type { NayinElement } from './nayin';

type FaviconPreset = {
  bg: string;
  stroke: string;
  paths: string;
};

// Hand-drawn SVG drink icons for favicon — matches WuxingDrinkIcon style
const FAVICON_BY_ELEMENT: Record<NayinElement, FaviconPreset> = {
  metal: {
    bg: '#fff2d9',
    stroke: '#8a6b2a',
    paths: `<path d="M7 8h10v10a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3V8z" fill="#f0c75e" stroke-width="1.4"/>
      <path d="M7 8c0-1.5 1-3 5-3s5 1.5 5 3" fill="#fff8e0" stroke-width="1.4"/>
      <path d="M17 11h2a2 2 0 0 1 0 4h-2" fill="none" stroke-width="1.4"/>
      <circle cx="10" cy="12" r="0.8" fill="#fff8e0" opacity="0.7"/>
      <circle cx="13" cy="14" r="0.6" fill="#fff8e0" opacity="0.5"/>`,
  },
  wood: {
    bg: '#eaf8ea',
    stroke: '#3d6b48',
    paths: `<path d="M6 14c0-4 3-8 6-10 3 2 6 6 6 10a6 6 0 0 1-12 0z" fill="#b8e0b8" stroke-width="1.4"/>
      <path d="M12 4v16" fill="none" stroke-width="1" opacity="0.4"/>
      <path d="M9 10c2 1 4 1 6 0" fill="none" stroke-width="1" opacity="0.3"/>
      <path d="M8 18c0 1 1.5 2.5 4 2.5s4-1.5 4-2.5" fill="none" stroke-width="1.4"/>`,
  },
  water: {
    bg: '#e8f2f6',
    stroke: '#4A7A8A',
    paths: `<circle cx="12" cy="12" r="7" fill="#D8E8F0" stroke-width="1.4"/>
      <path d="M9 9c1-2 5-2 6 0" fill="none" stroke-width="1.2" opacity="0.5"/>
      <circle cx="12" cy="12" r="4.5" fill="none" stroke-width="1"/>
      <path d="M10 15c1 1 3 1 4 0" fill="none" stroke-width="1.2"/>
      <circle cx="14" cy="10" r="0.7" fill="#9AC5D6"/>`,
  },
  fire: {
    bg: '#fdece6',
    stroke: '#6b2a22',
    paths: `<path d="M6 13c0 0 0-4 2-6 1 2 2 3 4 3s3-2 3-4c2 3 3 5 3 7a6 6 0 0 1-12 0z" fill="#e8a090" stroke-width="1.4"/>
      <path d="M8 19h8" fill="none" stroke-width="1.4"/>
      <path d="M7 19c-1 0-2 0.5-2 1.5h14c0-1-1-1.5-2-1.5" fill="#c45a4a" stroke-width="1.2"/>
      <circle cx="12" cy="7" r="0.5" fill="none" stroke-width="0.8" opacity="0.5"/>`,
  },
  earth: {
    bg: '#f6eee7',
    stroke: '#4a3228',
    paths: `<path d="M7 8h10v9a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3V8z" fill="#c4a882" stroke-width="1.4"/>
      <path d="M7 8h10" stroke-width="1.8"/>
      <path d="M17 11h2a2 2 0 0 1 0 4h-2" fill="none" stroke-width="1.4"/>
      <path d="M9 5c0-1 1-2 3-2s3 1 3 2" fill="none" stroke-width="1" opacity="0.4"/>
      <ellipse cx="12" cy="9.5" rx="3.5" ry="1" fill="#a07868" opacity="0.4"/>`,
  },
};

const FAVICON_RELS = ['icon', 'shortcut icon', 'apple-touch-icon'] as const;

function buildFaviconSvg(preset: FaviconPreset): string {
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <rect width="24" height="24" rx="5" fill="${preset.bg}" />
  <g transform="translate(12,12) scale(1.2) translate(-12,-12)" stroke="${preset.stroke}" stroke-linecap="round" stroke-linejoin="round" fill="none">
    ${preset.paths}
  </g>
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
  const svg = buildFaviconSvg(preset);
  const href = `data:image/svg+xml,${encodeURIComponent(svg)}`;

  FAVICON_RELS.forEach((rel) => {
    const link = ensureFaviconLink(rel);
    link.type = 'image/svg+xml';
    link.href = href;
  });
}
