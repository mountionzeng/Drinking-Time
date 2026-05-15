/**
 * 纳音五行 (Nayin Five Elements) Calculator
 * 
 * Design: The Grading Desk — Color Grading Console Aesthetic
 * Each day maps to one of the Five Elements via the 60 Jiazi cycle,
 * and each element corresponds to a beverage color theme.
 */

import { solarToLunar, type LunarDate } from './lunar';

export type NayinElement = 'metal' | 'wood' | 'water' | 'fire' | 'earth';

export interface BeverageTheme {
  element: NayinElement;
  elementCn: string;
  beverage: string;
  beverageCn: string;
  emoji: string;
  colorName: string;
  hex: string;
  hexDim: string;
  hexBright: string;
}

// Heavenly Stems (天干)
const STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'] as const;
// Earthly Branches (地支)
const BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'] as const;

// Traditional 纳音 sequence for 60 Jiazi — one name per two-day pair.
// 甲子乙丑→海中金, 丙寅丁卯→炉中火, … 壬戌癸亥→大海水
const NAYIN_PAIR_NAMES = [
  '海中金', '炉中火', '大林木', '路旁土', '剑锋金',
  '山头火', '涧下水', '城头土', '白蜡金', '杨柳木',
  '井泉水', '屋上土', '霹雳火', '松柏木', '长流水',
  '沙中金', '山下火', '平地木', '壁上土', '金箔金',
  '覆灯火', '天河水', '大驿土', '钗钏金', '桑柘木',
  '大溪水', '沙中土', '天上火', '石榴木', '大海水',
] as const;

const NAYIN_PAIR_ELEMENTS: NayinElement[] = [
  'metal', 'fire', 'wood', 'earth', 'metal', 'fire', 'water', 'earth', 'metal', 'wood',
  'water', 'earth', 'fire', 'wood', 'water', 'metal', 'fire', 'wood', 'earth', 'metal',
  'fire', 'water', 'earth', 'metal', 'wood', 'water', 'earth', 'fire', 'wood', 'water',
];

export const BEVERAGE_THEMES: Record<NayinElement, BeverageTheme> = {
  metal: {
    element: 'metal',
    elementCn: '金',
    beverage: 'Beer',
    beverageCn: '啤酒',
    emoji: '🍺',
    colorName: 'Amber Gold',
    hex: '#c89b3c',
    hexDim: '#8a6b2a',
    hexBright: '#f0c75e',
  },
  wood: {
    element: 'wood',
    elementCn: '木',
    beverage: 'Longjing',
    beverageCn: '龙井',
    emoji: '🍵',
    colorName: 'Jade Green',
    hex: '#5d9b6a',
    hexDim: '#3d6b48',
    hexBright: '#7db88a',
  },
  water: {
    element: 'water',
    elementCn: '水',
    beverage: 'Coconut',
    beverageCn: '椰汁',
    emoji: '🥥',
    colorName: 'Warm Cream',
    hex: '#d9cdb8',
    hexDim: '#a89b84',
    hexBright: '#f2e8d5',
  },
  fire: {
    element: 'fire',
    elementCn: '火',
    beverage: 'Dahongpao',
    beverageCn: '大红袍',
    emoji: '🫖',
    colorName: 'Deep Amber Red',
    hex: '#923a2f',
    hexDim: '#6b2a22',
    hexBright: '#c45a4a',
  },
  earth: {
    element: 'earth',
    elementCn: '土',
    beverage: 'Coffee',
    beverageCn: '咖啡',
    emoji: '☕',
    colorName: 'Rich Brown',
    hex: '#7a5c4f',
    hexDim: '#4a3228',
    hexBright: '#a07868',
  },
};

/**
 * Return the current Beijing (UTC+8) calendar date as {year, month, day}.
 * Uses Intl.DateTimeFormat so the result does not depend on the
 * client's local timezone.
 */
export function getCstDate(now: Date = new Date()): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

/**
 * Milliseconds until the next CST midnight. Used to schedule a daily refresh.
 */
export function msUntilNextCstMidnight(now: Date = new Date()): number {
  // Compute today's CST midnight as a UTC instant. CST = UTC+8,
  // so CST midnight {y,m,d} 00:00 is UTC {y,m,d-1} 16:00.
  const { y, m, d } = getCstDate(now);
  const todayCstMidnightUTC = Date.UTC(y, m - 1, d, -8, 0, 0);
  const nextCstMidnightUTC = todayCstMidnightUTC + 24 * 3600 * 1000;
  return Math.max(1000, nextCstMidnightUTC - now.getTime());
}

/**
 * Calculate the day's Heavenly Stem and Earthly Branch (日柱天干地支)
 * for a given {y, m, d} — intended to be CST-normalized. Reference date
 * 2000-01-07 is 甲子日 (Jiazi day, index 0 in the 60-cycle).
 */
function getDayStemBranch(y: number, m: number, d: number): { stem: string; branch: string; ganzhiIndex: number } {
  const refUTC = Date.UTC(2000, 0, 7);
  const targetUTC = Date.UTC(y, m - 1, d);
  const diffDays = Math.floor((targetUTC - refUTC) / 86400000);

  let idx = diffDays % 60;
  if (idx < 0) idx += 60;

  const stemIdx = idx % 10;
  const branchIdx = idx % 12;

  return {
    stem: STEMS[stemIdx],
    branch: BRANCHES[branchIdx],
    ganzhiIndex: idx,
  };
}

/**
 * Calculate Nayin Five Element by ganzhi index in 60 Jiazi cycle.
 * Traditional rule: each adjacent Jiazi pair shares one Nayin.
 */
function calcNayinByGanzhiIndex(ganzhiIndex: number): { element: NayinElement; name: string } {
  const pairIdx = Math.floor(ganzhiIndex / 2);
  return {
    element: NAYIN_PAIR_ELEMENTS[pairIdx],
    name: NAYIN_PAIR_NAMES[pairIdx],
  };
}

export interface TodayNayin {
  element: NayinElement;
  theme: BeverageTheme;
  ganzhi: string;
  stem: string;
  branch: string;
  /** Full 纳音 name for today's 日柱, e.g. "大海水" */
  nayinName: string;
  /** Beijing-time calendar date (the "official" day) */
  cstDate: { y: number; m: number; d: number };
  /** Formatted CST date, e.g. "2026-04-18" */
  cstDateStr: string;
  /** Lunar calendar breakdown for the CST date */
  lunar: LunarDate;
}

/**
 * Get today's Nayin element, beverage theme, and lunar date — all based on
 * Beijing time (UTC+8). Pass a `now` for testing.
 */
export function getTodayNayin(now: Date = new Date()): TodayNayin {
  const { y, m, d } = getCstDate(now);
  const { stem, branch, ganzhiIndex } = getDayStemBranch(y, m, d);
  const { element, name: nayinName } = calcNayinByGanzhiIndex(ganzhiIndex);
  const lunar = solarToLunar(y, m, d);

  return {
    element,
    theme: BEVERAGE_THEMES[element],
    ganzhi: `${stem}${branch}`,
    stem,
    branch,
    nayinName,
    cstDate: { y, m, d },
    cstDateStr: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    lunar,
  };
}

/**
 * Get all five themes for preview/testing
 */
export function getAllThemes(): BeverageTheme[] {
  return Object.values(BEVERAGE_THEMES);
}
