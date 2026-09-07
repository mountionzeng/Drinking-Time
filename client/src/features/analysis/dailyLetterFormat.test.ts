import { describe, expect, it } from "vitest";

import {
  dailyLetterDateLabel,
  dailyLetterParagraphs,
  dailyLetterTimestampLabel,
} from "./dailyLetterFormat";

describe("dailyLetterDateLabel", () => {
  it("reads a letter date as spoken Chinese, without zero padding", () => {
    expect(dailyLetterDateLabel("2026-09-08")).toBe("9月8日");
    expect(dailyLetterDateLabel("2026-12-31")).toBe("12月31日");
  });

  // 拿不准的输入原样返回：来信的日期是数据，不该由展示层去猜。
  it("returns anything it cannot parse unchanged", () => {
    expect(dailyLetterDateLabel("")).toBe("");
    expect(dailyLetterDateLabel("今天")).toBe("今天");
    expect(dailyLetterDateLabel("2026-9-8")).toBe("2026-9-8");
  });
});

describe("dailyLetterTimestampLabel", () => {
  // 时区必须钉死在中国：来信按中国日历切天，用户在哪儿读，「那天」都得是同一天。
  it("renders in Asia/Shanghai regardless of where it is read", () => {
    // 2026-09-08T13:30:00Z = 北京时间 21:30
    expect(dailyLetterTimestampLabel("2026-09-08T13:30:00.000Z")).toBe(
      "9/8 21:30"
    );
    // 同一瞬间跨了 UTC 的日界，北京时间仍是 9 月 9 日早上
    expect(dailyLetterTimestampLabel("2026-09-08T22:00:00.000Z")).toBe(
      "9/9 06:00"
    );
  });

  it("accepts a Date as well as a string", () => {
    expect(
      dailyLetterTimestampLabel(new Date("2026-09-08T13:30:00.000Z"))
    ).toBe("9/8 21:30");
  });

  it("renders nothing for absent or unusable values", () => {
    expect(dailyLetterTimestampLabel(null)).toBe("");
    expect(dailyLetterTimestampLabel(undefined)).toBe("");
    expect(dailyLetterTimestampLabel("")).toBe("");
    expect(dailyLetterTimestampLabel("不是时间")).toBe("");
  });
});

describe("dailyLetterParagraphs", () => {
  it("splits on blank lines and keeps the author's paragraphs", () => {
    expect(dailyLetterParagraphs("第一段\n\n第二段")).toEqual([
      "第一段",
      "第二段",
    ]);
  });

  // 段内的单个换行是作者写的换行，不是分段，必须原样留着。
  it("keeps single newlines inside a paragraph", () => {
    expect(dailyLetterParagraphs("上句\n下句\n\n另一段")).toEqual([
      "上句\n下句",
      "另一段",
    ]);
  });

  it("collapses runs of blank lines and drops empty ones", () => {
    expect(dailyLetterParagraphs("甲\n\n\n\n乙")).toEqual(["甲", "乙"]);
    expect(dailyLetterParagraphs("\n\n  \n\n")).toEqual([]);
    expect(dailyLetterParagraphs("")).toEqual([]);
  });
});
