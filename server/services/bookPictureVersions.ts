import { TRPCError } from "@trpc/server";
import { readBookImage, bookImageText } from "../../shared/bookImageBlock";
import type { ManuscriptContent } from "../../shared/bookWorkflow";
import {
  writingModuleTexts,
  type BookWritingStyle,
} from "../../shared/bookWritingStyle";
import {
  getImageSignalsForImages,
  getStoryGeneratedImages,
} from "../repositories/images";
import { getStoryById } from "../repositories/stories";
import { jsonRecord } from "../repositories/storyValues";
import { resolveImageAvailability } from "./imageAssets";

type Images = Awaited<ReturnType<typeof getStoryGeneratedImages>>;
type Signals = Awaited<ReturnType<typeof getImageSignalsForImages>>;
type Manuscript = { body: string; writingStyle?: BookWritingStyle };

/** Record an adoption only when the same saved module actually changes from its declared source. */
export async function adoptedBookPictureChanges(
  storyId: number,
  owner: number,
  before: Manuscript,
  after: Manuscript
) {
  if (
    before.body === after.body ||
    !after.writingStyle?.some(row => row.revisedBookImageFrom)
  )
    return [];
  const oldText = writingModuleTexts(before.body, before.writingStyle);
  const newText = writingModuleTexts(after.body, after.writingStyle);
  const originals = new Map(
    before.writingStyle?.map((row, i) => [
      row.id,
      readBookImage(oldText[i])?.url,
    ])
  );
  const changes = new Map<string, string>();
  for (const [i, row] of after.writingStyle.entries()) {
    const source = row.revisedBookImageFrom;
    if (!source || originals.get(row.id) !== source) continue;
    const next = readBookImage(newText[i])?.url;
    if (next && next !== source) changes.set(next, source);
  }
  if (!changes.size) return [];
  const images = new Map(
    (await getStoryGeneratedImages(storyId, owner)).map(image => [
      image.imageUrl,
      image.id,
    ])
  );
  return [...changes].flatMap(([next, source]) => {
    const imageId = images.get(next),
      parentImageId = images.get(source);
    return imageId && parentImageId && imageId > parentImageId
      ? [{ imageId, parentImageId }]
      : [];
  });
}

export function manualImageChoice(signal: Signals[number]) {
  return (
    signal.action === "swipe_right" &&
    !/auto|generation|migration|backfill/i.test(
      String(jsonRecord(signal.metadata).source ?? "")
    )
  );
}

/** Follow only adopted edits. A common shot, matching prompt, or later generation is not a version link. */
export async function bookPictureVersions(
  images: Images,
  allSignals: Signals,
  owner: number,
  storyId: number
) {
  const byId = new Map(images.map(image => [image.id, image]));
  const parent = new Map<number, number>(),
    adopted = new Map<number, number>(),
    rejected = new Set<number>();
  const signals = allSignals
    .filter(
      s =>
        s.userId === owner &&
        s.storyId === storyId &&
        s.imageId != null &&
        byId.has(s.imageId)
    )
    .sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id
    );
  for (const [order, signal] of signals.entries()) {
    const image = byId.get(signal.imageId!)!;
    if (signal.action === "swipe_left") {
      rejected.add(image.id);
      continue;
    }
    const meta = jsonRecord(signal.metadata);
    const bookEdit =
      signal.action === "edit_complete" &&
      meta.source === "book_image_revision";
    const importedEdit =
      signal.action === "edit_complete" &&
      meta.source === "user_import" &&
      image.generationType === "inpaint" &&
      image.parentImageId != null;
    if (!bookEdit && !importedEdit && !manualImageChoice(signal)) continue;
    rejected.delete(image.id);
    const source = bookEdit
      ? meta.parentImageId
      : image.generationType === "inpaint"
        ? image.parentImageId
        : undefined;
    if (typeof source === "number" && source < image.id && byId.has(source))
      parent.set(image.id, source);
    adopted.set(image.id, order);
  }
  const root = (id: number) => {
    while (parent.has(id)) id = parent.get(id)!;
    return id;
  };
  const families = new Map<number, Set<number>>();
  for (const id of parent.keys()) {
    const family = root(id);
    const members = families.get(family) ?? new Set([family]);
    members.add(id);
    families.set(family, members);
  }
  const latest = new Map<number, Images[number]>();
  for (const members of families.values()) {
    const ordered = [...members]
      .filter(id => !rejected.has(id))
      .sort((a, b) => (adopted.get(b) ?? -1) - (adopted.get(a) ?? -1));
    for (const id of ordered) {
      const choice = byId.get(id)!;
      if (
        !choice.imageUrl ||
        (await resolveImageAvailability(choice.imageUrl)) === "missing"
      )
        continue;
      for (const member of members) latest.set(member, choice);
      break;
    }
  }
  return latest;
}

export async function bookPictureLookup(owner: number, storyId: number) {
  const images = await getStoryGeneratedImages(storyId, owner);
  const versions = await bookPictureVersions(
    images,
    await getImageSignalsForImages(images.map(i => i.id)),
    owner,
    storyId
  );
  const byId = new Map(
    images.map(image => [image.id, versions.get(image.id) ?? image])
  );
  const urls = new Map(
    images.flatMap(image => {
      const next = versions.get(image.id);
      return next && next.id !== image.id
        ? [[image.imageUrl, next.imageUrl] as const]
        : [];
    })
  );
  return { byId, urls };
}

/** Resolve image references for a new draft while preserving its source snapshot. */
export function bookPicturesForConversion(
  chapters: ManuscriptContent[],
  urls: Map<string, string>
) {
  if (!urls.size) return chapters;
  return chapters.map(chapter => {
    const body = chapter.blocks.body
      .split("\n")
      .map(line => {
        const image = readBookImage(line);
        const next = image && urls.get(image.url);
        return image && next
          ? bookImageText(
              next,
              image.crop,
              image.scale,
              image.frame,
              image.videoUrl
            )
          : line;
      })
      .join("\n");
    if (body === chapter.blocks.body) return chapter;
    const layout = chapter.layout && {
      ...chapter.layout,
      pages: chapter.layout.pages.map(page => ({
        ...page,
        modules: page.modules.map(module =>
          module.kind === "image" && urls.has(module.imageUrl)
            ? { ...module, imageUrl: urls.get(module.imageUrl)! }
            : module
        ),
      })),
    };
    return { ...chapter, blocks: { ...chapter.blocks, body }, layout };
  });
}

export async function latestBookPicture(
  owner: number,
  storyId: number,
  imageId: number
) {
  if (!(await getStoryById(storyId, owner)))
    throw new TRPCError({ code: "NOT_FOUND" });
  const image = (await bookPictureLookup(owner, storyId)).byId.get(imageId);
  if (!image)
    throw new TRPCError({ code: "NOT_FOUND", message: "这张图不属于当前故事" });
  if (
    !image.imageUrl ||
    (await resolveImageAvailability(image.imageUrl)) === "missing"
  )
    throw new TRPCError({ code: "NOT_FOUND", message: "图片文件暂不可用" });
  return { imageId: image.id, url: image.imageUrl };
}
