import { describe, expect, it, vi } from "vitest";
vi.mock("../repositories/emotionLetters", () => ({ getEmotionDailyLetter: vi.fn(), getEmotionAnalysisProfile: vi.fn() }));
vi.mock("../_core/llm", () => ({ invokeLLM: vi.fn() }));
import { translateDailyLetter } from "./dailyLetterTranslation";

function deps(summary = "今天可以慢一点。") {
  return {
    getLetter: vi.fn().mockResolvedValue({ dailyReference: { summary } }),
    getProfile: vi.fn().mockResolvedValue(null),
    invoke: vi.fn().mockResolvedValue({ choices: [{ message: { content: "You can take today a little slower." }, finish_reason: "stop" }] }),
  };
}
describe("daily letter reading translations", () => {
  it("deduplicates concurrent reads but isolates users, languages and changed source", async () => {
    const d = deps();
    const results = await Promise.all(Array.from({ length: 5 }, () => translateDailyLetter(9101, "2026-10-18", "en", d)));
    expect(d.invoke).toHaveBeenCalledTimes(1);
    expect(results[0]).toEqual({ sourceSummary: "今天可以慢一点。", summary: "You can take today a little slower." });
    await translateDailyLetter(9102, "2026-10-18", "en", d);
    await translateDailyLetter(9101, "2026-10-18", "fr", d);
    d.getLetter.mockResolvedValue({ dailyReference: { summary: "新版本，今天可以休息。" } });
    await translateDailyLetter(9101, "2026-10-18", "en", d);
    expect(d.invoke).toHaveBeenCalledTimes(4);
    expect(d.getLetter).toHaveBeenCalledWith(9102, "2026-10-18");
  });
  it("rechecks source access even when a translation is cached", async () => {
    const d = deps();
    await translateDailyLetter(9103, "2026-10-18", "en", d);
    d.getLetter.mockResolvedValue(null);
    await expect(translateDailyLetter(9103, "2026-10-18", "en", d)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(d.invoke).toHaveBeenCalledTimes(1);
  });
  it("does not cache a failed or Chinese response; allows an explicit retry", async () => {
    const d = deps();
    d.invoke.mockResolvedValueOnce({ choices: [{ message: { content: "还是中文。" }, finish_reason: "stop" }] });
    await expect(translateDailyLetter(9104, "2026-10-18", "en", d)).rejects.toMatchObject({ code: "BAD_GATEWAY" });
    await translateDailyLetter(9104, "2026-10-18", "en", d);
    expect(d.invoke).toHaveBeenCalledTimes(2);
  });
  it("does not use a profile letter from a different date", async () => {
    const d = deps();
    d.getLetter.mockResolvedValue(null);
    d.getProfile.mockResolvedValue({ dailyReference: { todayDate: "2026-10-17", summary: "旧信" } });
    await expect(translateDailyLetter(9105, "2026-10-18", "en", d)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(d.invoke).not.toHaveBeenCalled();
  });
});
