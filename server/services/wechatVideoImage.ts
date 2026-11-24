import { createHash } from "node:crypto";
import { readBookImage } from "../../shared/bookImageBlock";
import { writingModuleTexts } from "../../shared/bookWritingStyle";
import type { StoryChapter } from "../../drizzle/schema";
import { chapterMediaUrl, readChapterMedia } from "../chapterMediaStore";
import { ENV } from "../_core/env";
import { ownsWechatImportImage, indexWechatStoryboardImageUrls } from "../repositories/wechatBookImport";

const wechatPath =
  /^\/api\/wechat-import\/media\/([a-f0-9]{64}\.(?:jpg|png|webp))$/;
export async function readOwnedWechatImage(
  url: string,
  userId: number
): Promise<Buffer | null> {
  const match = wechatPath.exec(url);
  if (!match || !Number.isSafeInteger(userId) || userId < 1) return null;
  const key = `chapters/${userId}/${match[1]}`;
  if (!(await ownsWechatImportImage(userId, key))) return null;
  const bytes = await readChapterMedia(key);
  return bytes &&
    createHash("sha256").update(bytes).digest("hex") === match[1].slice(0, 64)
    ? bytes
    : null;
}

/** Index only existing, verified private images when a user explicitly imports a storyboard. */
export async function indexWechatStoryboardImages(input: {
  storyId: number;
  userId: number;
  chapters: StoryChapter[];
}) {
  const urls = [
    ...new Set(
      input.chapters.flatMap(chapter =>
        writingModuleTexts(
          chapter.blocks.body,
          chapter.blocks.writingStyle
        ).flatMap(text => {
          const url = readBookImage(text)?.url;
          return url && wechatPath.test(url) ? [url] : [];
        })
      )
    ),
  ];
  for (const url of urls) {
    if (!(await readOwnedWechatImage(url, input.userId)))
      throw new Error("微信导入的图片无法读取，请检查原稿素材。");
  }
  await indexWechatStoryboardImageUrls({ ...input, urls });
}
export const isWechatImportImage = (url: string) => wechatPath.test(url);

export function privateReferenceOrigin() {
  try {
    const url = new URL(ENV.appOrigin);
    if (url.protocol === "https:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash &&
      !/^(?:localhost|.*\.localhost|127\..*|\[::1\])$/i.test(url.hostname)) return url.origin;
  } catch { /* Local workstations may have no public origin. */ }
  return null;
}

/** A private original is shared with the image provider only by a short-lived signed URL. */
export async function wechatProviderReference(
  url: string,
  userId: number
): Promise<string> {
  const match = wechatPath.exec(url);
  if (!match) return url;
  if (!(await readOwnedWechatImage(url, userId)))
    throw new Error("无权读取微信导入的图片或图片已失效");
  const origin = privateReferenceOrigin();
  if (!origin) throw new Error("本机私有图片缺少供应商可读取的 HTTPS 地址");
  return `${origin}${chapterMediaUrl(`chapters/${userId}/${match[1]}`)}`;
}
