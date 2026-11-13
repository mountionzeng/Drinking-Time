import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { MailboxPartPicker } from "./MailboxPartPicker";
import { UiLanguageContext } from "@/features/uiLanguage/UiLanguage";
vi.stubGlobal("React", React);
it("shows exact selected content and the narrow ongoing privacy boundary in English", () => {
  const changed = vi.fn();
  const html = renderToStaticMarkup(
    <UiLanguageContext.Provider
      value={{ language: "en", setLanguage: () => {} }}
    >
      <MailboxPartPicker
        parts={[
          {
            key: "paragraph:1:a",
            kind: "text",
            group: "Chapter 1",
            label: "A short selected paragraph",
          },
          { key: "video:1", kind: "video", group: "Film", label: "#1" },
        ]}
        value={["paragraph:1:a"]}
        onChange={changed}
      />
    </UiLanguageContext.Provider>
  );
  expect(html).toContain("A short selected paragraph");
  expect(html).toContain("stay private");
  expect(html.match(/checked=""/g)).toHaveLength(1);
  expect(html).not.toContain("勾选");
  expect(changed).not.toHaveBeenCalled();
});
it("describes mini-program sending as an independent copy without promising automatic updates", () => {
  const html = renderToStaticMarkup(
    <UiLanguageContext.Provider
      value={{ language: "en", setLanguage: () => {} }}
    >
      <MailboxPartPicker
        parts={[]}
        value={[]}
        onChange={() => {}}
        continuous={false}
      />
    </UiLanguageContext.Provider>
  );
  expect(html).toContain("independent copy");
  expect(html).toContain("send again");
  expect(html).not.toContain("后续修改");
});
