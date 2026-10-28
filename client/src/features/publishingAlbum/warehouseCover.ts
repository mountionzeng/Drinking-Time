import type { ModuleDocument } from "./imagePackModules";

/** Replace only the cover image, preserving every body page and the original asset. */
export function warehouseCover(
  document: ModuleDocument,
  url: string,
  title: string,
  width: number,
  height: number
): ModuleDocument {
  const ratio = width / height,
    target = 3 / 4;
  const crop =
    ratio > target
      ? { x: (1 - target / ratio) / 2, y: 0, width: target / ratio, height: 1 }
      : { x: 0, y: (1 - ratio / target) / 2, width: 1, height: ratio / target };
  const image = {
    id: "cover-image",
    kind: "image" as const,
    imageUrl: url,
    rect: { x: 0, y: 0, width: 900, height: 1200 },
    crop,
  };
  const index = document.pages.findIndex(page =>
    page.modules.some(module => module.id === "cover-image")
  );
  if (index >= 0)
    return {
      ...document,
      pages: document.pages.map((page, i) =>
        i === index
          ? {
              ...page,
              modules: page.modules.map(module =>
                module.id === "cover-image" ? image : module
              ),
            }
          : page
      ),
    };
  if (document.pages.length >= 9)
    throw new Error("排版已满9页，请先腾出一页再添加封面。");
  return {
    ...document,
    pages: [
      {
        label: "封面",
        modules: [
          image,
          {
            id: "cover-title",
            kind: "text",
            text: title,
            fontSize: 60,
            alignment: "center",
            backdrop: true,
            contentWidth: 774,
            contentHeight: 228,
            rect: { x: 63, y: 840, width: 774, height: 228 },
          },
        ],
      },
      ...document.pages,
    ],
  };
}
