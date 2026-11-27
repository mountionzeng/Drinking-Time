import { readFile, stat } from "node:fs/promises";
import { localImagePathForUrl } from "./imageAssets";
import { isWechatImportImage, readOwnedWechatImage } from "./wechatVideoImage";
import { localBookPage } from "./bookPageOcr";
import {
  pictureSourcePages,
  pageExcerpts,
} from "../../shared/pictureSourcePages";
import type { BookPageReading } from "../../shared/bookPageReading";
import type { ShotTextTrial } from "../../shared/shotTextTrial";

/** Caller supplies an owned imported image row or an owned chapter illustration. Never fetch a remote URL. */
export async function readBookPage(input: {
  owner: number;
  url: string;
  caption: string;
  ownedImport: boolean;
  sources: ShotTextTrial[];
}): Promise<BookPageReading | undefined> {
  const { owner, url, caption, sources } = input;
  const citation = pictureSourcePages(caption).pages[0];
  const title = caption.match(/《([^》]{1,100})》/u)?.[1];
  const declared = Boolean(
    (citation || /书页|扫描页|文献扫描/u.test(caption)) &&
      !/合影|插[画像]|照片|人像|封面|图版/u.test(caption)
  );
  const explicit =
    declared && citation && title
      ? pageExcerpts(sources, citation.page, title)
      : [];
  const cited = (
    row: (typeof explicit)[number],
    page: string
  ): BookPageReading => ({
    label:
      (row.source.match(/《[^》]+》/u)?.[0] ?? title ?? "书页") +
      "第" +
      page +
      "页",
    origin: "资料摘录",
    text: row.text.replace(/^\s*第[^页\n]{1,24}页\s*[:：]?\s*/u, "").trim(),
  });
  if (explicit.length === 1) return cited(explicit[0], citation!.page);
  const fallback: BookPageReading | undefined = declared
    ? { label: caption, origin: "待核对", text: "" }
    : undefined;
  try {
    let bytes: Buffer | null = null;
    if (isWechatImportImage(url))
      bytes = await readOwnedWechatImage(url, owner);
    else if (input.ownedImport && /^\/api\/images\/[\w.%-]+$/u.test(url)) {
      const file = localImagePathForUrl(url);
      if (file && (await stat(file)).size <= 30 * 1024 * 1024)
        bytes = await readFile(file);
    }
    if (!bytes?.length) return fallback;
    const read = await localBookPage(bytes);
    if (!declared && !read.textPage) return;
    const page = read.page || citation?.page;
    if (page) {
      const compact = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "");
      const original = compact(read.text);
      const matches = pageExcerpts(sources, page, title).filter(row =>
        (compact(row.text).match(/.{8}/gu) ?? []).some(fragment =>
          original.includes(fragment)
        )
      );
      if (matches.length === 1) return cited(matches[0], page);
    }
    if (!read.text) return fallback;
    return {
      label:
        title && page
          ? "《" + title + "》第" + page + "页"
          : page
            ? "第" + page + "页"
            : "书页资料",
      origin: "本机识字",
      text: read.text,
    };
  } catch {
    return fallback;
  }
}
