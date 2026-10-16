import type { ModuleDocument } from "./imagePackModules";

/** Read the edited work in page/module order, including newly added text. */
export function imagePackCopyText(document: ModuleDocument): string {
  return document.pages
    .flatMap(page => page.modules)
    .flatMap(module =>
      module.kind === "text" && module.text.trim() ? [module.text] : []
    )
    .join("\n\n");
}

export async function joinImagePackPages(
  pages: Blob[],
  signal: AbortSignal
): Promise<Blob> {
  signal.throwIfAborted();
  if (!pages.length || pages.length > 9)
    throw new Error("请选择 1 至 9 张图片");
  if (pages.length === 1) return pages[0];

  // All pack pages are 3:4. Keep a nine-page strip below mobile canvas limits.
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 1200 * pages.length;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("此浏览器无法合成长图，请下载所选图片");
    for (const [index, page] of pages.entries()) {
      signal.throwIfAborted();
      const bitmap = await createImageBitmap(page);
      try {
        signal.throwIfAborted();
        context.drawImage(bitmap, 0, index * 1200, 900, 1200);
      } finally {
        bitmap.close();
      }
    }
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(value => {
        if (value) resolve(value);
        else reject(new Error("长图生成失败，请下载所选图片"));
      }, "image/png");
    });
    signal.throwIfAborted();
    return blob;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function copyImagePackPages(pages: Blob[], signal: AbortSignal) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")
    throw new Error("此浏览器不支持复制图片，请下载所选图片");
  const png = joinImagePackPages(pages, signal);
  // Start the clipboard request in the click gesture, before async PNG encoding.
  // Attaching a rejection handler also covers a synchronous clipboard denial.
  void png.catch(() => {});
  return navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}
