import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { UiLanguageContext } from "@/features/uiLanguage/UiLanguage";
import { DailyLetterBody } from "./DailyLetterBody";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/trpc", () => ({ trpc: { emotionAnalysis: { translatedDailyLetter: { useQuery: mocks.query } } } }));
const source = "今天，慢慢来。";
function render(language: "zh" | "en") {
  return renderToStaticMarkup(<UiLanguageContext.Provider value={{ language, setLanguage: vi.fn() }}>
    <DailyLetterBody summary={source} date="2026-10-18" />
  </UiLanguageContext.Provider>);
}
beforeEach(() => { mocks.query.mockReset(); });
it("keeps Chinese unchanged without requesting a translation", () => {
  expect(render("zh")).toContain(source);
  expect(mocks.query).not.toHaveBeenCalled();
});
it("renders the matching English letter and keeps private text out of query inputs", () => {
  mocks.query.mockReturnValue({ data: { sourceSummary: source, summary: "Take your time today." }, isSuccess: true });
  const html = render("en");
  expect(html).toContain("Take your time today.");
  expect(html).not.toContain(source);
  expect(JSON.stringify(mocks.query.mock.calls[0][0])).not.toContain(source);
  expect(mocks.query.mock.calls[0][1]).toMatchObject({ retry: false, refetchOnWindowFocus: false });
});
it("does not flash Chinese while English is pending", () => {
  mocks.query.mockReturnValue({ isSuccess: false, isError: false });
  expect(render("en")).toContain("Preparing your letter in English");
  expect(render("en")).not.toContain(source);
});
it("rejects a stale source and offers explicit retry rather than showing the wrong letter", () => {
  mocks.query.mockReturnValue({ isSuccess: true, data: { sourceSummary: "旧信", summary: "Old letter" } });
  const html = render("en");
  expect(html).toContain("Try again");
  expect(html).not.toContain("Old letter");
});
