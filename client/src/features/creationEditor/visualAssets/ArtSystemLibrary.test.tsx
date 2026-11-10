import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ArtSystemDetails } from "./ArtSystemLibrary";
import { normalizeStoryArtDirection } from "@shared/artDirection";
import { UiLanguageContext } from "@/features/uiLanguage/UiLanguage";
it("shows versions, authorship and a downloadable creative Skill without production buttons", () => {
  vi.stubGlobal("React", React);
  const recipe = { version: 1, updatedAt: 100, system: { name: "Paper world", editorName: "Alice", intent: "soft", referenceImageIds: [8], confirmedAt: 100 }, style: ["paper"] };
  const direction = normalizeStoryArtDirection({ recipe, recipeVersions: [recipe] });
  const html = renderToStaticMarkup(<UiLanguageContext.Provider value={{ language: "en", setLanguage: () => {} }}><ArtSystemDetails storyId={1} direction={direction} images={[{ id: 8, imageUrl: "/ref.png" }]} /></UiLanguageContext.Provider>);
  expect(html).toContain("Art system version"); expect(html).toContain("Download Skill"); expect(html).toContain('download="art-system-v1-SKILL.md"');
  expect(html).toContain("Alice"); expect(html).toContain("/ref.png"); expect(html).not.toContain("<button");
  vi.unstubAllGlobals();
});
