/**
 * Chinese Lunar Calendar (农历) — solar → lunar conversion.
 *
 * All dates are interpreted in Beijing time (UTC+8). The Shanghai calendar
 * is astronomical and advances at local midnight, so callers must pass a
 * CST-normalized (year, month, day).
 */

// Lunar year info table for years 1900-2099 (200 entries).
// Encoding (16 bits per year):
//   bits 16-13 (top 4):  month-length bitmap for first 4 of 12 months + leap flag byte
//   bits 12-1  (next 12): 1 = 30-day big month, 0 = 29-day small month, MSB = month 1
//   bits 4-1   (low 4):   leap month index (0 if none)
//   bit 16     (MSB):     leap month length (1 = 30, 0 = 29)
const LUNAR_INFO: number[] = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2, // 1900-1909
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977, // 1910-1919
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, // 1920-1929
  0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950, // 1930-1939
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557, // 1940-1949
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, // 1950-1959
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, // 1960-1969
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6, // 1970-1979
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570, // 1980-1989
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0, // 1990-1999
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, // 2000-2009
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930, // 2010-2019
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530, // 2020-2029
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, // 2030-2039
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, // 2040-2049
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0, // 2050-2059
  0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4, // 2060-2069
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0, // 2070-2079
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160, // 2080-2089
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252, // 2090-2099
];

const ZODIAC = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'] as const;
const STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'] as const;
const BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'] as const;
const LUNAR_MONTHS = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'] as const;
const LUNAR_DAYS = [
  '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十',
] as const;

function leapMonth(year: number): number {
  return LUNAR_INFO[year - 1900] & 0xf;
}
function leapMonthDays(year: number): number {
  return leapMonth(year) ? (LUNAR_INFO[year - 1900] & 0x10000 ? 30 : 29) : 0;
}
function monthDays(year: number, month: number): number {
  return LUNAR_INFO[year - 1900] & (0x10000 >> month) ? 30 : 29;
}
function yearDays(year: number): number {
  let sum = 348; // 12 * 29
  for (let i = 0x8000; i > 0x8; i >>= 1) {
    if (LUNAR_INFO[year - 1900] & i) sum += 1;
  }
  return sum + leapMonthDays(year);
}

export interface LunarDate {
  /** 农历年（数字，如 2026） */
  lunarYear: number;
  /** 农历月（1-12） */
  lunarMonth: number;
  /** 农历日（1-30） */
  lunarDay: number;
  /** 本月是否为闰月 */
  isLeap: boolean;
  /** 中文月份，例如 "三月" / "闰三月" */
  monthCn: string;
  /** 中文日期，例如 "初二" / "廿八" */
  dayCn: string;
  /** 年柱（天干地支），例如 "丙午" */
  yearGanzhi: string;
  /** 生肖，例如 "马" */
  zodiac: string;
}

/**
 * Convert a Gregorian date (CST) to its lunar date.
 * @param y Gregorian year (supported: 1900–2099)
 * @param m Gregorian month (1–12)
 * @param d Gregorian day (1–31)
 */
export function solarToLunar(y: number, m: number, d: number): LunarDate {
  if (y < 1900 || y > 2099) {
    throw new Error(`Lunar calendar supports 1900–2099 only, got ${y}`);
  }

  // Days since 1900-01-31 (lunar 1900 新年)
  const baseUTC = Date.UTC(1900, 0, 31);
  const targetUTC = Date.UTC(y, m - 1, d);
  let offset = Math.floor((targetUTC - baseUTC) / 86400000);

  // Walk years
  let lunarYear = 1900;
  let yDays = yearDays(lunarYear);
  while (lunarYear < 2100 && offset >= yDays) {
    offset -= yDays;
    lunarYear++;
    yDays = yearDays(lunarYear);
  }

  // Walk months
  const leap = leapMonth(lunarYear);
  let isLeap = false;
  let lunarMonth = 1;
  let mDays = 0;
  for (lunarMonth = 1; lunarMonth < 13 && offset >= 0; lunarMonth++) {
    // Regular month
    mDays = monthDays(lunarYear, lunarMonth);
    if (offset < mDays) break;
    offset -= mDays;
    // Leap month follows lunarMonth === leap
    if (leap && lunarMonth === leap) {
      mDays = leapMonthDays(lunarYear);
      if (offset < mDays) {
        isLeap = true;
        break;
      }
      offset -= mDays;
    }
  }

  const lunarDay = offset + 1;

  // Year ganzhi (立春 not taken into account — uses lunar new year boundary instead,
  // common in popular 农历 displays)
  const yearOffset = lunarYear - 1900 + 36; // 1900 = 庚子 (stemIdx 6, branchIdx 0)
  const stemIdx = ((yearOffset % 10) + 10) % 10;
  const branchIdx = ((yearOffset % 12) + 12) % 12;

  return {
    lunarYear,
    lunarMonth,
    lunarDay,
    isLeap,
    monthCn: `${isLeap ? '闰' : ''}${LUNAR_MONTHS[lunarMonth - 1]}`,
    dayCn: LUNAR_DAYS[lunarDay - 1] ?? `${lunarDay}`,
    yearGanzhi: `${STEMS[stemIdx]}${BRANCHES[branchIdx]}`,
    zodiac: ZODIAC[branchIdx],
  };
}
