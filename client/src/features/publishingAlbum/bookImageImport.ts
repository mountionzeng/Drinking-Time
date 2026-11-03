import { blobToBase64 } from "@/lib/imageUpload";

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
export type BookImageSource = File | { url: string };
const imageMime = (file: File) =>
  file.type.toLowerCase() ||
  ({
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
  }[file.name.split(".").at(-1)?.toLowerCase() ?? ""] ??
    "");

/** Read the transfer synchronously: clipboard and drop data expire after the event. */
export function bookImageSources(
  transfer: Pick<DataTransfer, "files" | "items" | "getData">
): BookImageSource[] {
  const files = Array.from(transfer.files ?? []);
  if (!files.length)
    for (const item of Array.from(transfer.items ?? [])) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
  if (files.length) return files;
  const html = transfer.getData("text/html");
  if (!html) return [];
  // Parse inertly; no clipboard markup is inserted into the page.
  const template = document.createElement("template");
  template.innerHTML = html;
  // A copied article fragment still belongs to the normal text-paste path.
  // Do not silently discard its words just because it also contains an image.
  if (template.content.textContent?.trim()) return [];
  return Array.from(template.content.querySelectorAll("img[src]")).map(
    image => ({ url: image.getAttribute("src")! })
  );
}

export function mightContainBookImages(transfer: Pick<DataTransfer, "types">) {
  return Array.from(transfer.types).some(type =>
    ["Files", "text/html"].includes(type)
  );
}

export async function prepareBookImage(source: BookImageSource) {
  let file: File;
  if ("url" in source) {
    if (
      !/^(https?:\/\/|data:image\/(png|jpeg|webp);base64,)/i.test(source.url) ||
      source.url.length > MAX_IMAGE_BYTES * 1.4
    )
      throw new Error("无法读取这张图片，请先保存到本地，再拖入文章。");
    let response: Response;
    try {
      response = await fetch(source.url, {
        credentials: "omit",
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new Error("来源不允许直接读取图片，请先保存到本地，再拖入文章。");
    }
    if (
      !response.ok ||
      Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES
    )
      throw new Error("图片读取失败或超过30MB，请保存到本地后检查。");
    const blob = await response.blob();
    file = new File([blob], "粘贴的图片", { type: blob.type });
  } else file = source;
  const mimeType = imageMime(file);
  if (
    !["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(mimeType)
  )
    throw new Error("请使用 PNG、JPG 或 WebP 图片。");
  if (!file.size || file.size > MAX_IMAGE_BYTES)
    throw new Error("每张图片请控制在30MB以内。");
  return {
    fileName: (file.name || "粘贴的图片").slice(0, 300),
    mimeType,
    fileBase64: await blobToBase64(file),
  };
}

/** One batch, original order, no automatic retries after an unknown upload result. */
export async function importBookImages(
  sources: BookImageSource[],
  upload: (
    image: Awaited<ReturnType<typeof prepareBookImage>>
  ) => Promise<string>,
  current: () => boolean,
  progress: (done: number, total: number) => void
) {
  const urls: string[] = [],
    errors: string[] = [];
  if (sources.length > 20)
    throw new Error("一次最多加入20张图片，请分批拖入。");
  for (let index = 0; index < sources.length; index++) {
    if (!current()) break;
    progress(index + 1, sources.length);
    try {
      const image = await prepareBookImage(sources[index]);
      if (!current()) break;
      urls.push(await upload(image));
    } catch (error) {
      errors.push(
        `${index + 1}: ${error instanceof Error ? error.message : "图片导入失败"}`
      );
    }
  }
  return { urls, errors };
}
