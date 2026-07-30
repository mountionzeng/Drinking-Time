import { Solar } from "lunar-javascript";

export interface BirthBazi {
  year: string;
  month: string;
  day: string;
  time: string;
  label: string;
}

export interface BirthDatePillars {
  year: string;
  month: string;
  day: string;
  label: string;
}

export interface BirthLunarDate {
  yearGanzhi: string;
  month: string;
  day: string;
  label: string;
}

function parseBirthDate(birthDate: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function calculateBirthDatePillars(
  birthDate: string
): BirthDatePillars | null {
  const date = parseBirthDate(birthDate);
  if (!date) return null;

  try {
    const eightChar = Solar.fromYmdHms(
      date.year,
      date.month,
      date.day,
      12,
      0,
      0
    )
      .getLunar()
      .getEightChar();
    const pillars = {
      year: eightChar.getYear(),
      month: eightChar.getMonth(),
      day: eightChar.getDay(),
    };
    if (Object.values(pillars).some(value => !value)) return null;
    return {
      ...pillars,
      label: `年柱 ${pillars.year} · 月柱 ${pillars.month} · 日柱 ${pillars.day}`,
    };
  } catch {
    return null;
  }
}

export function calculateBirthLunarDate(
  birthDate: string
): BirthLunarDate | null {
  const date = parseBirthDate(birthDate);
  if (!date) return null;

  try {
    const lunar = Solar.fromYmdHms(
      date.year,
      date.month,
      date.day,
      12,
      0,
      0
    ).getLunar();
    const result = {
      yearGanzhi: lunar.getYearInGanZhi(),
      month: lunar.getMonthInChinese(),
      day: lunar.getDayInChinese(),
    };
    if (Object.values(result).some(value => !value)) return null;
    return {
      ...result,
      label: `农历${result.yearGanzhi}年${result.month}月${result.day}`,
    };
  } catch {
    return null;
  }
}

export function calculateBirthBazi(
  birthDate: string,
  birthTime?: string
): BirthBazi | null {
  const date = parseBirthDate(birthDate);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(birthTime ?? "");
  if (!date || !timeMatch) return null;

  const [, hourText, minuteText] = timeMatch;
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  try {
    const eightChar = Solar.fromYmdHms(
      date.year,
      date.month,
      date.day,
      hour,
      minute,
      0
    )
      .getLunar()
      .getEightChar();
    const pillars = {
      year: eightChar.getYear(),
      month: eightChar.getMonth(),
      day: eightChar.getDay(),
      time: eightChar.getTime(),
    };
    if (Object.values(pillars).some(value => !value)) return null;
    return {
      ...pillars,
      label: `${pillars.year}年 · ${pillars.month}月 · ${pillars.day}日 · ${pillars.time}时`,
    };
  } catch {
    return null;
  }
}

export function calculateBirthPillarsLabel(
  birthDate: string,
  birthTime?: string
): string | null {
  const bazi = calculateBirthBazi(birthDate, birthTime);
  if (bazi) return bazi.label;

  const pillars = calculateBirthDatePillars(birthDate);
  return pillars
    ? `${pillars.year}年 · ${pillars.month}月 · ${pillars.day}日`
    : null;
}
