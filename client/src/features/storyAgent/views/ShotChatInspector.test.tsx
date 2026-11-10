import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { UiLanguageContext } from "@/features/uiLanguage/UiLanguage";
import { emptyStoryboardFieldVersions } from "@shared/storyboardFieldVersions";
vi.mock("@/lib/trpc", () => ({
  trpc: {
    storyAgent: { chatImageRevisions: { useQuery: () => ({ data: [] }) } },
  },
}));
import { ShotChatInspector } from "./ShotChatInspector";
afterEach(() => vi.unstubAllGlobals());
it("shows the selected shot and bound history in English, using the existing composer", () => {
  vi.stubGlobal("React", React);
  const html = renderToStaticMarkup(
    <UiLanguageContext.Provider
      value={{ language: "en", setLanguage: () => {} }}
    >
      <ShotChatInspector
        storyId={1}
        shot={{ shotNo: 2, stableShotId: "a", promptDraft: "colorful pixels" }}
        fields={emptyStoryboardFieldVersions()}
        imageUrl="/current.png"
        archiveImages={[
          { id: 1, imageUrl: "/original.png", shotIdentity: "a" },
          { id: 2, imageUrl: "/rejected.png", parentImageId: 1 },
          { id: 3, imageUrl: "/unassigned.png", assignment: "unassigned" },
          { id: 4, imageUrl: "/other.png", shotIdentity: "b" },
        ]}
        messages={[
          {
            id: "m",
            role: "user",
            content: "brighten the face",
            timestamp: 42,
            selectionQuote: {
              sourceType: "shot",
              sourceId: "a",
              selectedText: "a",
              storyId: 1,
              stableShotId: "a",
            },
          },
        ]}
      />
    </UiLanguageContext.Provider>
  );
  expect(html).toContain("Shot 02 · History");
  expect(html).toContain('src="/current.png"');
  expect(html).toContain("brighten the face");
  expect(html).toContain("Chat request");
  expect(html).toContain("History · 1 records");
  expect(html).not.toMatch(/第|修改|图片|历史/);
  expect(html).not.toContain("max-h-52"); // History uses the conversation scroll surface, not the composer.
  expect(html).not.toContain("textarea");
  expect(html).toContain("/original.png");
  expect(html).toContain("/rejected.png");
  expect(html).toContain("Older images without a shot");
  expect(html).toContain("/unassigned.png");
  expect(html).not.toContain("/other.png");
});
