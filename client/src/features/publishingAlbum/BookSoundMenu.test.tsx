import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { UiLanguageContext } from "@/features/uiLanguage/UiLanguage";
import { BookSoundMenu } from "./BookSoundMenu";
vi.stubGlobal("React", React);
it.each([
  ["text", "有声书", "Audiobook"],
  ["storyboard", "台词", "Dialogue"],
] as const)(
  "has one closed sound entry and localized choices for %s",
  (kind, zh, en) => {
    const props = {
      storyId: 1,
      chapterId: 2,
      kind,
      disabled: false,
      onInsert: vi.fn(),
    };
    for (const language of ["zh", "en"] as const) {
      const html = renderToStaticMarkup(
        <UiLanguageContext.Provider value={{ language, setLanguage: () => {} }}>
          <BookSoundMenu {...props} />
        </UiLanguageContext.Provider>
      );
      expect(html).toContain(
        language === "zh" ? "＋ 添加声音" : "＋ Add audio"
      );
      expect(html).toContain(language === "zh" ? zh : en);
      expect(html).toContain(
        language === "zh" ? "背景音乐" : "Background music"
      );
      expect(html).not.toContain("<details open");
      expect(props.onInsert).not.toHaveBeenCalled();
    }
  }
);
