import type { NayinElement, TodayNayin } from './nayin';

export interface DailyDrinkPresentation {
  element: NayinElement;
  title: string;
  subtitle: string;
  drinkNote: string;
  motionHint: string;
}

export const WELCOME_HERO_TITLE = '小酌 · Drinking Time';

export const WELCOME_HERO_SUBTITLE = [
  '倒一杯，随便聊聊。',
  '那些在桌上讲过的八卦、深夜微信里没说完的话、',
  '都是好故事。',
  '在这里，慢慢说。',
].join('\n');

export const DAILY_DRINK_PRESENTATION: Record<NayinElement, DailyDrinkPresentation> = {
  metal: {
    element: 'metal',
    title: WELCOME_HERO_TITLE,
    subtitle: WELCOME_HERO_SUBTITLE,
    drinkNote: '啤酒 · 金',
    motionHint: 'bubble',
  },
  wood: {
    element: 'wood',
    title: WELCOME_HERO_TITLE,
    subtitle: WELCOME_HERO_SUBTITLE,
    drinkNote: '龙井 · 木',
    motionHint: 'steam',
  },
  water: {
    element: 'water',
    title: WELCOME_HERO_TITLE,
    subtitle: WELCOME_HERO_SUBTITLE,
    drinkNote: '椰汁 · 水',
    motionHint: 'tide',
  },
  fire: {
    element: 'fire',
    title: WELCOME_HERO_TITLE,
    subtitle: WELCOME_HERO_SUBTITLE,
    drinkNote: '大红袍 · 火',
    motionHint: 'ripple',
  },
  earth: {
    element: 'earth',
    title: WELCOME_HERO_TITLE,
    subtitle: WELCOME_HERO_SUBTITLE,
    drinkNote: '咖啡 · 土',
    motionHint: 'swirl',
  },
};

export function getDailyDrinkPresentation(element: NayinElement) {
  return DAILY_DRINK_PRESENTATION[element];
}

export function formatTodayIdentity(today: TodayNayin) {
  return [
    today.cstDateStr,
    `农历${today.lunar.monthCn}${today.lunar.dayCn}`,
    `${today.ganzhi}日`,
    today.nayinName,
  ].join(' · ');
}
