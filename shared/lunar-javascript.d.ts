declare module "lunar-javascript" {
  interface EightChar {
    toString(): string;
    getYear(): string;
    getMonth(): string;
    getDay(): string;
    getTime(): string;
  }

  interface Lunar {
    getEightChar(): EightChar;
    getYearInGanZhi(): string;
    getMonthInChinese(): string;
    getDayInChinese(): string;
  }

  interface SolarInstance {
    getLunar(): Lunar;
  }

  export const Solar: {
    fromYmdHms(
      year: number,
      month: number,
      day: number,
      hour: number,
      minute: number,
      second: number
    ): SolarInstance;
  };
}
