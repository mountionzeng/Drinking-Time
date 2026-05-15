export type AlmanacStatus = 'ok' | 'partial' | 'unconfigured' | 'unavailable';

export interface AlmanacDirection {
  name: string;
  value: string;
}

export interface AlmanacHour {
  label: string;
  value: string;
}

export interface AlmanacMeta {
  lunarDate?: string | null;
  lunarMonth?: string | null;
  lunarDay?: string | null;
  ganzhiDay?: string | null;
  ganzhiMonth?: string | null;
  ganzhiYear?: string | null;
  zodiac?: string | null;
  solarTerm?: string | null;
  clash?: string | null;
  sha?: string | null;
  fetalGod?: string | null;
  pengzu?: string | null;
  fiveElements?: string | null;
  star?: string | null;
  dayOfficer?: string | null;
  festival?: string | null;
}

export interface AlmanacDay {
  date: string;
  provider: 'tianapi' | 'jisu';
  sourceLabel: string;
  status: AlmanacStatus;
  message: string | null;
  yi: string[];
  ji: string[];
  luckyHours: AlmanacHour[];
  directions: AlmanacDirection[];
  meta: AlmanacMeta;
  fetchedAt: string | null;
}

export function hasAuthorityBackedDetails(day: AlmanacDay | null | undefined) {
  if (!day) return false;
  return (
    day.yi.length > 0 ||
    day.ji.length > 0 ||
    day.luckyHours.length > 0 ||
    day.directions.length > 0 ||
    Object.values(day.meta).some(Boolean)
  );
}

export function hasCoreAlmanacAdvice(day: AlmanacDay | null | undefined) {
  if (!day) return false;
  return day.yi.length > 0 || day.ji.length > 0;
}

export function statusLabel(status: AlmanacStatus) {
  switch (status) {
    case 'ok':
      return '老黄历已接入';
    case 'partial':
      return '老黄历部分可用';
    case 'unconfigured':
      return '老黄历待配置';
    case 'unavailable':
      return '老黄历暂不可用';
  }
}

export function dailyAtmosphereLine(day: AlmanacDay | null | undefined) {
  if (!day || day.status === 'unconfigured') {
    return '今日先按纳音气息开场，老黄历接口配置后会补上宜忌细节。';
  }
  if (day.status === 'unavailable') {
    return '今日黄历暂时没有回来，先用纳音与农历陪你开场。';
  }
  if (hasCoreAlmanacAdvice(day)) {
    const yi = day.yi.slice(0, 2).join('、');
    const ji = day.ji.slice(0, 2).join('、');
    if (yi && ji) return `宜 ${yi}，忌 ${ji}。把它当作今天的创作气压就好。`;
    if (yi) return `宜 ${yi}。今天适合把灵感先安顿下来。`;
    if (ji) return `忌 ${ji}。绕开一点噪音，画面会更清楚。`;
  }
  return '今日气息已接入，展开看看适合放进创作台的细节。';
}

export function compactList(items: string[], max = 4) {
  const shown = items.slice(0, max);
  const extra = Math.max(0, items.length - shown.length);
  return {
    shown,
    extra,
  };
}
