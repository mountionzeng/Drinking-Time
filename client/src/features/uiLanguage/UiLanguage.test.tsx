import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "./messages.json";
import {
  UI_LANGUAGE_KEY,
  readUiLanguage,
  translateUi,
  UiLanguageContext,
  useUiText,
  validUiLanguage,
} from "./UiLanguage";
import { MobileNavBar } from "../mobileWorkspace/MobileNavBar";
import { MobileStoryStageBar } from "../mobileWorkspace/MobileStoryWorkspace";

afterEach(() => vi.unstubAllGlobals());
describe("mobile interface languages", () => {
  it("validates persisted choices and handles blocked storage", () => {
    for (const language of ["zh", "en", "fr"]) {
      vi.stubGlobal("window", {
        localStorage: {
          getItem: (key: string) => (key === UI_LANGUAGE_KEY ? language : null),
        },
      });
      expect(readUiLanguage()).toBe(language);
    }
    vi.stubGlobal("window", { localStorage: { getItem: () => "de" } });
    expect(readUiLanguage()).toBe("zh");
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("blocked");
      },
    });
    expect(readUiLanguage()).toBe("zh");
    expect(validUiLanguage("fr-FR")).toBe(false);
  });
  it("has complete translations with matching interpolation placeholders", () => {
    const placeholders = (s: string) =>
      [...s.matchAll(/\{\d+\}/g)].map(m => m[0]).sort();
    for (const [source, translations] of Object.entries(messages)) {
      for (const language of ["en", "fr"] as const) {
        expect(translations[language].trim(), source).not.toBe("");
        expect(placeholders(translations[language]), source).toEqual(
          placeholders(source)
        );
      }
    }
  });
  it("interpolates without interpreting content as another translation", () => {
    expect(
      translateUi("fr", "{0} · 版本 {1}", ["我的日历 <b>été</b>", 2])
    ).toBe("我的日历 <b>été</b> · Version 2");
    expect(translateUi("zh", "{0} · 版本 {1}", ["原文", 2])).toBe(
      "原文 · 版本 2"
    );
    expect(translateUi("en", "未登记的新提示")).toBe("未登记的新提示");
  });
  it("translates navigation and all stages through context, keeping user text intact", () => {
    function Example() {
      const t = useUiText();
      return (
        <>
          <span>{t("我的语言")}</span>
          <p>我的日历 — 原始作品文字</p>
          <MobileNavBar current="me" onNavigate={() => {}} />
          <MobileStoryStageBar stage="memory" onChange={() => {}} />
        </>
      );
    }
    const markup = renderToStaticMarkup(
      <UiLanguageContext.Provider
        value={{ language: "fr", setLanguage: () => {} }}
      >
        <Example />
      </UiLanguageContext.Provider>
    );
    expect(markup).toContain("Ma langue");
    expect(markup).toContain("Retour aux histoires");
    for (const text of [
      "Souvenirs",
      "Textes",
      "Vidéos",
      "我的日历 — 原始作品文字",
    ])
      expect(markup).toContain(text);
    expect(renderToStaticMarkup(<Example />)).toContain("我的语言");
  });
});
