import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ language: "en" }));
vi.mock("@/features/uiLanguage/UiLanguage", () => ({
  useUiLanguage: () => ({ language: m.language }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    creationAgent: {
      warehouseFiles: {
        useQuery: () => ({
          data: [
            {
              id: 1,
              name: "<script>file</script>.md",
              bytes: 1024,
              extension: "md",
              extractionNote: "已读取文本 / Text read",
              extractedText: "<script>doNotExecute()</script>",
            },
          ],
        }),
      },
    },
  },
}));
import { WarehouseFiles } from "./WarehouseFiles";
beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());
it("renders safe local text, authenticated download and English labels", () => {
  const html = renderToStaticMarkup(<WarehouseFiles storyId={7} />);
  expect(html).toContain("Local preview");
  expect(html).toContain("Download original");
  expect(html).toContain("Text read");
  expect(html).not.toContain("已读取文本");
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("/api/warehouse-files/7/1");
});
