import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  VideoMediaVersionSelect,
  type VideoMediaVersionBinding,
} from "./VideoMediaVersionSelect";
import { UiLanguageContext } from "@/features/uiLanguage/UiLanguage";

vi.stubGlobal("React", React);
const binding: VideoMediaVersionBinding = {
  pending: false,
  onRestore: async () => {},
  history: {
    current: { music: "new" },
    entries: [
      {
        id: "old",
        kind: "music",
        planId: "film",
        number: 1,
        createdAt: 1000,
        authorName: "岱",
        intent: "保存声音素材与剪辑设置",
        label: "V02.1",
      },
      {
        id: "new",
        kind: "music",
        planId: "film",
        number: 2,
        createdAt: 2000,
        authorName: "岱",
        intent: "保存声音素材与剪辑设置",
        label: "V02.2",
      },
    ],
  },
};
describe("media version menu", () => {
  it("shows saved history and the selected version without adding a button", () => {
    const html = renderToStaticMarkup(
      <VideoMediaVersionSelect kind="music" binding={binding} />
    );
    expect(html).toContain('aria-label="声音版本"');
    expect(html).toContain('value="new" selected=""');
    expect(html).toContain("V02.1");
    expect(html).toContain("岱");
    expect(html).not.toContain("<button");
    expect(
      renderToStaticMarkup(
        <VideoMediaVersionSelect kind="subtitles" binding={binding} />
      )
    ).toBe("");
  });
  it("disables switching while saving and translates the labels", () => {
    const html = renderToStaticMarkup(
      <UiLanguageContext.Provider
        value={{ language: "en", setLanguage: () => {} }}
      >
        <VideoMediaVersionSelect
          kind="music"
          binding={{ ...binding, pending: true }}
        />
      </UiLanguageContext.Provider>
    );
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-label="Audio versions"');
    expect(html).toContain("Saved audio and editing settings");
  });
});
