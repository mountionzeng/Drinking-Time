import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCstDate, getTodayNayin, msUntilNextCstMidnight } from '../../client/src/features/nayin/nayin';
import { currentChinaShichen } from '../../shared/shichen';

afterEach(() => vi.unstubAllGlobals());

describe.each([
  ['missing Intl', undefined],
  ['missing formatToParts', { DateTimeFormat: function DateTimeFormat() {} }],
])('mini-game date compatibility: %s', (_name, intl) => {
  it('preserves Beijing date at midnight, leap day and year rollover', () => {
    vi.stubGlobal('Intl', intl);
    expect(getCstDate(new Date('2026-12-31T15:59:59Z'))).toEqual({ y: 2026, m: 12, d: 31 });
    expect(getCstDate(new Date('2026-12-31T16:00:00Z'))).toEqual({ y: 2027, m: 1, d: 1 });
    expect(getCstDate(new Date('2024-02-28T16:00:00Z'))).toEqual({ y: 2024, m: 2, d: 29 });
    expect(msUntilNextCstMidnight(new Date('2026-09-08T15:59:58Z'))).toBe(2000);
  });

  it('matches the existing Web Nayin result throughout a complete 60-day cycle', () => {
    const dates = Array.from({ length: 60 }, (_, day) => new Date(Date.UTC(2026, 8, 1 + day, 16)));
    const expected = dates.map(date => getTodayNayin(date));
    vi.stubGlobal('Intl', intl);
    expect(dates.map(date => getTodayNayin(date))).toEqual(expected);
  });

  it('matches existing Beijing shichen across every hourly boundary', () => {
    const dates = Array.from({ length: 48 }, (_, hour) => new Date(Date.UTC(2026, 8, 8, hour)));
    const expected = dates.map(date => currentChinaShichen(date));
    vi.stubGlobal('Intl', intl);
    expect(dates.map(date => currentChinaShichen(date))).toEqual(expected);
  });
});
