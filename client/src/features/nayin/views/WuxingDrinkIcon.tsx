/**
 * WuxingDrinkIcon — Hand-drawn SVG drink illustrations for each element.
 * 金 Beer · 木 Tea · 水 Coconut · 火 Teapot · 土 Coffee
 */
import type React from 'react';
import type { NayinElement } from '@/features/nayin/nayin';

interface Props {
  element: NayinElement;
  size?: number;
  className?: string;
}

function BeerMug() {
  return (
    <svg viewBox="0 0 90 100" fill="none" stroke="#7A5B1F" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22,20 C25,12 35,9 42,14 C46,8 56,8 60,15 C68,13 73,20 70,28 L22,30 Z" fill="#F6E29C" strokeWidth="1.4"/>
      <path d="M28,18 c2,-3 6,-3 7,1" strokeWidth="1" opacity=".6"/>
      <path d="M50,14 c2,-2 5,-1 5,2" strokeWidth="1" opacity=".6"/>
      <path d="M22,30 L24,82 C24,86 26,89 30,89 L62,89 C66,89 68,86 68,82 L70,30" fill="#F2D86A" strokeWidth="1.6"/>
      <path d="M70,42 C82,44 82,68 70,72" strokeWidth="1.4" fill="none"/>
      <path d="M70,48 C76,50 76,66 70,68" strokeWidth="0.9" fill="none" opacity=".5"/>
      <circle cx="34" cy="48" r="2" fill="#fff7d2" strokeWidth=".8"/>
      <circle cx="44" cy="58" r="1.4" fill="#fff7d2" strokeWidth=".8"/>
      <circle cx="56" cy="44" r="1.6" fill="#fff7d2" strokeWidth=".8"/>
      <circle cx="40" cy="70" r="1.2" fill="#fff7d2" strokeWidth=".7"/>
      <circle cx="52" cy="68" r="1" fill="#fff7d2" strokeWidth=".7"/>
      <circle cx="46" cy="6" r="1.6" strokeWidth=".9" opacity=".7"/>
      <circle cx="56" cy="3" r="1.1" strokeWidth=".7" opacity=".5"/>
      <circle cx="38" cy="2" r="1" strokeWidth=".7" opacity=".5"/>
      <path d="M30,40 L32,75" strokeWidth=".8" opacity=".5"/>
    </svg>
  );
}

function TeaBowl() {
  return (
    <svg viewBox="0 0 90 100" fill="none" stroke="#33532B" strokeLinecap="round" strokeLinejoin="round">
      <path d="M30,18 c-3,-6 4,-8 1,-14" strokeWidth="1.1" opacity=".7"/>
      <path d="M44,14 c-3,-5 3,-7 0,-12" strokeWidth="1.1" opacity=".7"/>
      <path d="M58,18 c-3,-6 4,-8 1,-14" strokeWidth="1.1" opacity=".7"/>
      <ellipse cx="45" cy="38" rx="28" ry="6" fill="#fff" strokeWidth="1.5"/>
      <path d="M17,38 C18,60 30,80 45,80 C60,80 72,60 73,38" fill="#E5EFD3" strokeWidth="1.6"/>
      <ellipse cx="45" cy="84" rx="34" ry="5" fill="#fff" strokeWidth="1.4"/>
      <path d="M11,84 C13,90 30,93 45,93 C60,93 77,90 79,84" strokeWidth="1.4" fill="none"/>
      <ellipse cx="45" cy="38" rx="24" ry="4" fill="#A9C66B" strokeWidth=".8" opacity=".7"/>
      <path d="M38,38 q3,-3 7,0 q-3,3 -7,0" fill="#5D8A4A" strokeWidth=".8"/>
      <path d="M50,40 q2,-2 5,0 q-2,2 -5,0" fill="#5D8A4A" strokeWidth=".7"/>
      <path d="M73,40 q8,-4 6,-12 q-3,-3 -6,2" strokeWidth="1.2" fill="none"/>
      <ellipse cx="80" cy="29" rx="3" ry="1.6" fill="#A9C66B" strokeWidth=".8" transform="rotate(-30 80 29)"/>
    </svg>
  );
}

function Coconut() {
  return (
    <svg viewBox="0 0 90 100" fill="none" stroke="#4A7A8A" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22,52 C22,30 38,20 50,22 C62,24 72,38 70,58 C68,78 50,86 38,82 C26,78 22,68 22,52 Z" fill="#D8E8F0" strokeWidth="1.6"/>
      <path d="M30,40 c4,4 8,4 14,0" strokeWidth=".6" opacity=".5"/>
      <path d="M30,52 c6,6 14,6 22,0" strokeWidth=".6" opacity=".5"/>
      <path d="M32,64 c4,3 12,3 18,0" strokeWidth=".6" opacity=".5"/>
      <path d="M40,30 c4,2 10,2 14,-2" strokeWidth=".6" opacity=".5"/>
      <path d="M52,8 L60,30" strokeWidth="1.6"/>
      <path d="M50,12 L58,32" strokeWidth="1.6"/>
      <path d="M51,11 L59,31" stroke="#EAF2F6" strokeWidth="1"/>
      <path d="M55,4 c-2,3 -2,6 1,6 c3,0 3,-3 1,-6 z" fill="#9AC5D6" strokeWidth=".8"/>
      <path d="M16,84 q6,-6 14,-2 q4,-6 12,-3 q5,-5 14,0 q6,-3 12,2" strokeWidth="1.4" fill="none"/>
      <path d="M22,90 q4,-3 8,-1" strokeWidth="1" opacity=".6"/>
      <path d="M58,92 q4,-3 8,0" strokeWidth="1" opacity=".6"/>
      <circle cx="14" cy="78" r="1" fill="#9AC5D6" strokeWidth=".5"/>
      <circle cx="78" cy="80" r="1.2" fill="#9AC5D6" strokeWidth=".5"/>
      <circle cx="82" cy="72" r=".8" fill="#9AC5D6" strokeWidth=".5"/>
    </svg>
  );
}

function Teapot() {
  return (
    <svg viewBox="0 0 90 100" fill="none" stroke="#6B2A22" strokeLinecap="round" strokeLinejoin="round">
      <path d="M28,16 c-4,-7 4,-9 0,-16" strokeWidth="1.2" opacity=".7"/>
      <path d="M42,12 c-4,-7 4,-9 0,-16" strokeWidth="1.2" opacity=".7"/>
      <path d="M56,16 c-4,-7 4,-9 0,-16" strokeWidth="1.2" opacity=".7"/>
      <circle cx="42" cy="22" r="3" fill="#C0473A" strokeWidth="1.2"/>
      <path d="M42,25 L42,30" strokeWidth="1.2"/>
      <path d="M22,30 C22,26 30,24 42,24 C54,24 62,26 62,30 Z" fill="#E08775" strokeWidth="1.5"/>
      <path d="M16,32 C14,52 18,72 32,80 C46,86 60,84 70,72 C78,62 78,46 74,32 Z" fill="#D6604A" strokeWidth="1.6"/>
      <path d="M14,40 C6,38 2,46 6,52 C10,52 14,50 16,46 Z" fill="#D6604A" strokeWidth="1.4"/>
      <path d="M74,38 C84,40 86,58 76,62" strokeWidth="1.5" fill="none"/>
      <path d="M28,58 C40,62 56,62 66,58" strokeWidth="0.9" opacity=".5"/>
      <circle cx="34" cy="46" r="1.2" fill="#FAE5DD" strokeWidth=".5" opacity=".8"/>
      <circle cx="50" cy="42" r="1" fill="#FAE5DD" strokeWidth=".5" opacity=".7"/>
      <path d="M44,90 c-2,-4 2,-6 0,-10 c4,4 6,2 4,8 c-1,4 -3,5 -4,2 z" fill="#E89373" strokeWidth=".9" opacity=".7"/>
    </svg>
  );
}

function CoffeeMug() {
  return (
    <svg viewBox="0 0 90 100" fill="none" stroke="#4A2E1B" strokeLinecap="round" strokeLinejoin="round">
      <path d="M34,16 c-3,-6 3,-8 0,-14" strokeWidth="1.1" opacity=".6"/>
      <path d="M50,12 c-3,-6 3,-8 0,-14" strokeWidth="1.1" opacity=".6"/>
      <ellipse cx="45" cy="86" rx="34" ry="5" fill="#D9C8AC" strokeWidth="1.4"/>
      <path d="M11,86 C13,92 30,95 45,95 C60,95 77,92 79,86" strokeWidth="1.4"/>
      <path d="M20,32 L18,76 C18,82 24,86 30,86 L60,86 C66,86 72,82 72,76 L70,32 Z" fill="#B58968" strokeWidth="1.7"/>
      <path d="M22,46 L68,46" strokeWidth=".7" opacity=".4"/>
      <path d="M22,68 L68,68" strokeWidth=".7" opacity=".4"/>
      <ellipse cx="45" cy="32" rx="25" ry="4" fill="#D9C8AC" strokeWidth="1.4"/>
      <ellipse cx="45" cy="32" rx="22" ry="3" fill="#3E2516" strokeWidth=".6"/>
      <path d="M30,32 c4,-2 8,2 14,0 c5,-2 9,1 12,0" stroke="#A87858" strokeWidth=".8" fill="none" opacity=".8"/>
      <path d="M70,42 C84,46 86,68 70,72" strokeWidth="1.6" fill="none"/>
      <path d="M70,48 C78,50 80,64 70,66" strokeWidth=".8" opacity=".5" fill="none"/>
      <ellipse cx="20" cy="92" rx="3" ry="1.6" fill="#4A2E1B" strokeWidth=".6" transform="rotate(-20 20 92)"/>
      <path d="M17,92 q3,-1 6,0" stroke="#F0E6D6" strokeWidth=".6"/>
    </svg>
  );
}

/** 每个元素的饮品线稿，供 EmotiveWuxingIcon 等组件叠加表情时复用。 */
export const WUXING_DRINK_ART: Record<NayinElement, () => React.JSX.Element> = {
  metal: BeerMug,
  wood: TeaBowl,
  water: Coconut,
  fire: Teapot,
  earth: CoffeeMug,
};

/** 每个元素线稿使用的墨色，叠加层（手脚/五官）沿用同色保持手绘一致感。 */
export const WUXING_DRINK_INK: Record<NayinElement, string> = {
  metal: '#7A5B1F',
  wood: '#33532B',
  water: '#4A7A8A',
  fire: '#6B2A22',
  earth: '#4A2E1B',
};

const ICON_MAP = WUXING_DRINK_ART;

export default function WuxingDrinkIcon({ element, size = 36, className = '' }: Props) {
  const Icon = ICON_MAP[element];
  return (
    <div
      className={`inline-flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      <Icon />
    </div>
  );
}
