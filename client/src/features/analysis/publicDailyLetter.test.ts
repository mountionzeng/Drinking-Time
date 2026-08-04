import { describe, expect, it } from "vitest";
import { publicDailyLetterForDate } from "./publicDailyLetter";

describe("publicDailyLetterForDate", () => {
  it("gives signed-out visitors a stable letter for each day", () => {
    const monday = publicDailyLetterForDate("2026-08-03");
    const tuesday = publicDailyLetterForDate("2026-08-04");

    expect(monday.date).toBe("2026-08-03");
    expect(monday.paragraphs).toHaveLength(3);
    expect(monday.attention).not.toContain("猫");
    expect(tuesday.attention).not.toBe(monday.attention);
  });

  it("does not pretend to know a visitor's private circumstances", () => {
    const letters = Array.from({ length: 7 }, (_, offset) =>
      publicDailyLetterForDate(`2026-08-${String(offset + 3).padStart(2, "0")}`)
    );
    const text = letters
      .flatMap(letter => [letter.attention, ...letter.paragraphs])
      .join("\n");

    expect(text).not.toMatch(/年龄|住在|出生|八字|生肖|命运/);
  });
});
