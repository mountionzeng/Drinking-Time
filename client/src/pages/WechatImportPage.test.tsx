import { UiLanguageContext } from "@/features/uiLanguage/UiLanguage";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { WechatImportView } from "./WechatImportPage";
const props = {
  rows: [
    {
      storyId: "story-a",
      revisionId: "revision-a",
      version: 1,
      title: "虚构河边故事",
      updatedAt: "2026-11-02",
      importedStoryId: null,
    },
  ],
  selected: new Set<string>(),
  onSelect: vi.fn(),
  onImport: vi.fn(),
  onRetry: vi.fn(),
  onMore: vi.fn(),
  loading: false,
  busy: false,
  hasMore: false,
  results: [],
  continueHref: "/editing",
};
it("starts unselected, provides skip, and explains copy semantics", () => {
  const html = renderToStaticMarkup(<WechatImportView {...props} />);
  expect(html).not.toContain("checked=");
  expect(html).toContain("disabled=");
  expect(html).toContain("暂不导入");
  expect(html).toContain("另存一份");
  expect(html).toContain("可折叠标题");
});
it("distinguishes unavailable from empty and gives a retry", () => {
  const html = renderToStaticMarkup(
    <WechatImportView {...props} rows={[]} error="未开放" />
  );
  expect(html).toContain('role="alert"');
  expect(html).toContain("重试读取");
  expect(html).not.toContain("暂无可导入");
});
it("already imported rows open the saved book and cannot be selected again", () => {
  const html = renderToStaticMarkup(
    <WechatImportView
      {...props}
      rows={[{ ...props.rows[0], importedStoryId: 123 }]}
    />
  );
  expect(html).toContain("已导入 · 打开");
  expect(html).toContain("/editing?storyId=123");
  expect(html).toContain('type="checkbox"');
  expect(html).toContain("disabled=");
});

it("translates import controls but keeps the WeChat story title unchanged", () => {
 const html=renderToStaticMarkup(<UiLanguageContext.Provider value={{language:"en",setLanguage:()=>{}}}><WechatImportView {...props}/></UiLanguageContext.Provider>);
 expect(html).toContain("Bring your WeChat stories to the web");
 expect(html).toContain("Skip import and continue on the web");
 expect(html).toContain("虚构河边故事");
 expect(html).not.toContain("导入所选");
});
