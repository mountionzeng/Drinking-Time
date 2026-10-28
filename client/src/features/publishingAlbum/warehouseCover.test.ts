import { expect, it } from "vitest";
import { warehouseCover } from "./warehouseCover";
import type { ModuleDocument } from "./imagePackModules";
const original: ModuleDocument = {
  version: 1,
  pages: [
    {
      label: "正文",
      modules: [
        {
          id: "text1",
          kind: "text",
          text: "保留文字",
          fontSize: 24,
          contentWidth: 600,
          contentHeight: 40,
          alignment: "start",
          rect: { x: 20, y: 20, width: 600, height: 40 },
        },
      ],
    },
  ],
};
it("adds a cropped cover without replacing body modules or mutating the source", () => {
  const next = warehouseCover(original, "/photo.png", "我的书", 1600, 900);
  expect(original.pages).toHaveLength(1);
  expect(next.pages[1]).toBe(original.pages[0]);
  expect(next.pages[0].modules[0]).toMatchObject({
    id: "cover-image",
    crop: { height: 1, width: 0.421875 },
  });
  expect(next.pages[0].modules[1]).toMatchObject({ text: "我的书" });
});
it("replaces only the cover image and keeps all existing text and page count", () => {
  const first = warehouseCover(original, "/first.png", "我的书", 900, 1200);
  const next = warehouseCover(first, "/second.png", "另一个标题", 900, 1600);
  expect(next.pages).toHaveLength(2);
  expect(next.pages[0].modules[1]).toBe(first.pages[0].modules[1]);
  expect(first.pages[0].modules[0]).toMatchObject({ imageUrl: "/first.png" });
  expect(next.pages[0].modules[0]).toMatchObject({ imageUrl: "/second.png" });
});
