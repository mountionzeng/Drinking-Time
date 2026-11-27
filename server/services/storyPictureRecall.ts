import { TRPCError } from "@trpc/server";
import { getStoryById, listUserStories } from "../repositories/stories";
import {
  getImageSignalsForImages,
  getStoryGeneratedImages,
} from "../repositories/images";
import { openedAccountImages } from "../repositories/memorySpace";
import { listChapters } from "../repositories/chapters";
import { authoredPictureMentions } from "../repositories/accountImages";
import { resolveImageAvailability } from "./imageAssets";
import { inlineChatParts } from "../../shared/inlineChatImages";
import {
  otherStoryPictures,
  pictureSearchTerms,
} from "../../shared/pictureRecall";
import { readBookImage } from "../../shared/bookImageBlock";
import { writingModuleTexts } from "../../shared/bookWritingStyle";
import { jsonRecord } from "../repositories/storyValues";
import { bookPictureVersions, manualImageChoice } from "./bookPictureVersions";

import { readBookPage } from "./bookPageReading";
import type { BookPageReading } from "../../shared/bookPageReading";
import type { ShotTextTrial } from "../../shared/shotTextTrial";

type Picture = {
  reading?: BookPageReading;
  storyId: number;
  storyTitle: string;
  imageId?: number;
  url: string;
  label: string;
  reason: "已采用" | "原稿已用" | "已提供" | "已引用" | "已点开";
};
const weights = { 已采用: 5, 原稿已用: 4, 已引用: 3, 已提供: 2, 已点开: 1 };
function safeImage(url: unknown): url is string {
  return (
    typeof url === "string" &&
    /^(?:\/api\/(?:images|wechat-import\/media)\/|\/uploads\/|https?:\/\/|data:image\/(?:png|jpeg|gif|webp);base64,)/iu.test(
      url
    )
  );
}
function records(value: unknown) {
  return Array.isArray(value) ? value.map(jsonRecord) : [];
}
function label(value: unknown) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, 220)
    : "";
}
/** Only deliberate actions and submitted originals qualify; listing or machine analysis is never an interaction. */
export async function storyPictures(
  owner: number,
  story: NonNullable<Awaited<ReturnType<typeof getStoryById>>>,
  opened: Set<number>,
  onlyUrls?: ReadonlySet<string>
) {
  const body = jsonRecord(story.body);
  const [images, chapters, mentions] = await Promise.all([
    getStoryGeneratedImages(story.id, owner),
    listChapters(story.id, owner, "all"),
    authoredPictureMentions(story.id, owner),
  ]);
  const byId = new Map(images.map(i => [i.id, i])),
    byUrl = new Map(images.map(i => [i.imageUrl, i]));
  const signals = await getImageSignalsForImages(images.map(i => i.id));
  const versions = await bookPictureVersions(images, signals, owner, story.id);
  const decisions = new Map<number, boolean>(),
    supplied = new Set<number>();
  for (const s of signals.sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id
  )) {
    if (s.userId !== owner || s.storyId !== story.id || s.imageId == null)
      continue;
    if (
      s.action === "edit_complete" &&
      jsonRecord(s.metadata).source === "user_import"
    )
      supplied.add(s.imageId);
    if (s.action === "swipe_left") decisions.set(s.imageId, false);
    if (
      manualImageChoice(s) ||
      (s.action === "edit_complete" &&
        jsonRecord(s.metadata).source === "book_image_revision")
    )
      decisions.set(s.imageId, true);
  }
  const captions = new Map<string,string>();
  const result = new Map<string, Picture & { searchText: string }>();
  function add(url: unknown, caption: unknown, reason: Picture["reason"]) {
    if (!safeImage(url)) return;
    const source = byUrl.get(url),
      image = (source && versions.get(source.id)) || source,
      id = image?.id;
    const resolved = image?.imageUrl ?? url;
    if (onlyUrls && !onlyUrls.has(resolved)) return;
    if (id != null && decisions.get(id) === false) return;
    const previous = result.get(resolved);
    const name = label(caption) || label(image?.prompt) || "图片";
    const searchText = [previous?.searchText, name]
      .filter(Boolean)
      .join(" ")
      .slice(0, 4000);
    if (
      previous &&
      weights[previous.reason] > weights[reason] &&
      reason !== "原稿已用"
    ) {
      previous.searchText = searchText;
      return;
    }
    result.set(resolved, {
      storyId: story.id,
      storyTitle: story.title,
      url: resolved,
      imageId: id,
      label: name,
      reason:
        previous && weights[previous.reason] > weights[reason]
          ? previous.reason
          : reason,
      searchText,
    });
  }
  for (const image of images) {
    if (decisions.get(image.id)) add(image.imageUrl, image.prompt, "已采用");
    else if (
      supplied.has(image.id) ||
      (image.generationType === "initial" &&
        !image.parentImageId &&
        image.prompt?.startsWith("导入素材："))
    )
      add(image.imageUrl, image.prompt, "已提供");
    else if (opened.has(image.id)) add(image.imageUrl, image.prompt, "已点开");
  }
  const turns: Record<string, unknown>[] = [
    ...records(body.messages),
    ...mentions.map(m => ({ ...m, role: "user" })),
  ];
  for (const msg of turns) {
    if (msg.role !== "user" && msg.who !== "u") continue;
    const content = msg.content ?? msg.text;
    add(msg.photoUrl, content, "已提供");
    if (typeof content !== "string" || !content.includes("[[ref:")) continue;
    try {
      const parts = inlineChatParts(content),
        words = parts
          .filter(p => !p.imageId)
          .map(p => p.text)
          .join("");
      for (const part of parts)
        if (part.imageId)
          add(byId.get(part.imageId)?.imageUrl, words, "已引用");
    } catch {
      /* Older malformed mentions do not establish an image reference. */
    }
  }
  for (const item of records(body.visualCanvasItems)) {
    if (item.source === "reference")
      add(
        item.originalImageUrl || item.imageUrl,
        item.title || jsonRecord(item.analysis).objective,
        "已提供"
      );
  }
  for (const chapter of chapters) {
    if (chapter.blocks.manuscriptArchived || chapter.blocks.shotTextOrigin)
      continue;
    const { blocks } = chapter;
    const stored = new Map(
      (blocks.illustrations ?? []).map(i => [
        i.key.split("/").at(-1),
        i.caption,
      ])
    );
    for (const item of blocks.illustrations ?? []) {
      const file = item.key.split("/").at(-1);
      if (!file || !item.key.startsWith("chapters/"+owner+"/")) continue;
      const url = "/api/wechat-import/media/"+file;
      if (item.caption) captions.set(url,item.caption);
      if (blocks.wechatImport && blocks.images?.[item.key]) add(url,item.caption || chapter.title,"已提供");
    }
    const cover = blocks.coverKey?.split("/").at(-1);
    let section = chapter.title;
    const words = writingModuleTexts(blocks.body, blocks.writingStyle);
    const descriptions = new Map<string, string>();
    words.forEach((line, i) => {
      const parent = blocks.writingStyle?.[i]?.parentId;
      if (parent && /^(?:画面(?:描述|提示词)?)[：:]/u.test(line))
        descriptions.set(parent, line.replace(/^[^：:]+[：:]/u, ""));
    });
    for (const [index, line] of words.entries()) {
      const format = blocks.writingStyle?.[index]?.format;
      if (format === "shot" || format?.startsWith("heading")) section = line;
      const url = readBookImage(line)?.url;
      if (!url) continue;
      const key = url.split("/").at(-1);
      if (byUrl.has(url))
        add(
          url,
          [
            section,
            descriptions.get(blocks.writingStyle?.[index]?.parentId ?? ""),
          ]
            .filter(Boolean)
            .join(" · "),
          "原稿已用"
        );
      else if (
        url.startsWith("/api/wechat-import/media/") &&
        (stored.has(key) || key === cover)
      )
        add(
          url,
          stored.get(key) ||
            (key === cover ? chapter.title + " · 封面" : section),
          "原稿已用"
        );
    }
  }
  const available = await Promise.all(
    [...result.values()].map(async p =>
      (await resolveImageAvailability(p.url)) === "missing" ? [] : [p]
    )
  );
  const pictures=available.flat();
  const sources:ShotTextTrial[]=Array.isArray(body.shotTextTrials) ? body.shotTextTrials.filter(r=>r?.state==="source" && typeof r.text==="string" && typeof r.source==="string") : [];
  // Read only submitted originals. Generated takes and revised photographs keep their visual role.
  for (const p of pictures) {
    const img=p.imageId == null ? undefined : byId.get(p.imageId);
    const ownedImport=Boolean(img && !img.parentImageId && (supplied.has(img.id) || img.prompt?.startsWith("导入素材：")));
    if (!ownedImport && !captions.has(p.url) && !p.url.startsWith("/api/wechat-import/media/")) continue;
    p.reading=await readBookPage({owner,url:p.url,caption:captions.get(p.url) ?? img?.prompt ?? p.label,ownedImport,sources});
    if (p.reading) p.searchText += " 书页资料 " + p.reading.label + " " + p.reading.text;
  }
  return pictures;
}
export async function findStoryPictures(
  owner: number,
  storyId: number,
  query: string,
  forManuscript = false
) {
  const current = await getStoryById(storyId, owner);
  if (!current)
    throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在或不可访问" });
  const opened = await openedAccountImages(owner);
  const terms = pictureSearchTerms(query);
  const accountWide = !forManuscript && otherStoryPictures(query);
  const othersOnly =
    /(?:其他|其它|别的)(?:的)?(?:故事|作品|项目)/u.test(query) &&
    !/(?:所有|包括这|也看这)/u.test(query);
  const scope = accountWide
    ? (await listUserStories(owner)).filter(
        s => !othersOnly || s.id !== storyId
      )
    : [current];
  let best: Array<Picture & { searchText: string; score: number }> = [];
  for (let at = 0; at < scope.length; at += 5) {
    const batches = await Promise.all(
      scope.slice(at, at + 5).map(async s => {
        const story =
          s.id === current.id ? current : await getStoryById(s.id, owner);
        return story ? storyPictures(owner, story, opened) : [];
      })
    );
    for (const p of batches.flat()) {
      if (forManuscript && p.reason === "已点开") continue;
      const words = (p.storyTitle + " " + p.searchText).toLowerCase();
      const hits = terms.filter(t => words.includes(t));
      if (terms.length && !hits.length) continue;
      best.push({
        ...p,
        score:
          hits.reduce((n, t) => n + Math.min(t.length, 8), 0) * 10 +
          weights[p.reason],
      });
    }
    best.sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.storyId === storyId) - Number(a.storyId === storyId) ||
        (b.imageId ?? 0) - (a.imageId ?? 0)
    );
    const seen = new Set<string>();
    best = best
      .filter(p => !seen.has(p.url) && Boolean(seen.add(p.url)))
      .slice(0, 8);
  }
  return best.map(({ score, searchText, ...picture }) => picture);
}

export async function storyPageReadings(owner:number, storyId:number, urls:readonly string[]) {
  const story=await getStoryById(storyId,owner);
  if (!story) throw new TRPCError({code:"NOT_FOUND",message:"故事不存在或不可访问"});
  if (!urls.length) return [];
  const hits=await storyPictures(owner,story,new Set(),new Set(urls));
  return hits.flatMap(p=>p.reading ? [{url:p.url,reading:p.reading}] : []);
}
