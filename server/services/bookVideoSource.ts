import { createHash } from "node:crypto";
import { writingModuleTexts, validWritingStyle } from "../../shared/bookWritingStyle";
import { listChapters } from "../repositories/chapters";
import { getStoryImageAssets } from "./imageAssets";
import { readBookImage } from "../../shared/bookImageBlock";
import { readBookAudio } from "../../shared/bookAudioBlock";
import { listOwnedStoryAudioAssets } from "./storyAudioAssets";
import type { BookVideoRecord } from "../../shared/bookVideoCreation";
import {
  imagePackParagraphs,
  type IllustrationPlacement,
} from "../../shared/articleIllustrations";
export async function readBookVideoSource(input: {
  storyId: number;
  userId: number;
}) {
  const chapters = await listChapters(input.storyId, input.userId);
  if (!chapters.length) return null;
  const assets = await getStoryImageAssets(input.storyId, input.userId);
  const audioAssets = await listOwnedStoryAudioAssets(input);
  const musicAssets: NonNullable<BookVideoRecord["musicAssets"]> = [];
  const seenMusic = new Set<number>();
  let missingMusic = 0;
  const lines: string[] = [];
  const dialogueLines = new Set<number>();
  let hasDialogueClassification = false;
  const pending: Array<{ assetId: number; line: number }> = [];
  const seen = new Set<number>();
  let missingImages = 0;
  const addImage = (url: string, line: number) => {
    const asset = assets.find(
      a =>
        a.imageUrl === url &&
        a.availability !== "missing" &&
        a.status !== "rejected"
    );
    if (!asset) {
      missingImages++;
      return;
    }
    if (!seen.has(asset.id)) {
      pending.push({ assetId: asset.id, line });
      seen.add(asset.id);
    }
  };
  for (const chapter of chapters) {
    const chapterStart = lines.length;
    const style = chapter.blocks.writingStyle;
    const validStyle = style && validWritingStyle(chapter.blocks.body,style);
    const modules=writingModuleTexts(chapter.blocks.body,style);
    for (const [moduleIndex,moduleText] of modules.entries()) {
      const isDialogue=Boolean(validStyle && style[moduleIndex]?.videoRole==='dialogue');
      for (const line of moduleText.split("\n")) {
      const audio = readBookAudio(line.trim());
      if (audio) {
        // Narration belongs to its original text, not to an adapted video's music bed.
        if (audio.kind === "music") {
          const asset =
            audio.storyId === input.storyId &&
            audioAssets.find(
              a =>
                a.id === audio.assetId &&
                a.status === "ready" &&
                (a.durationFrames ?? 0) > 0 &&
                a.mediaKind !== "narration"
            );
          if (!asset) missingMusic++;
          else if (!seenMusic.has(asset.id)) {
            musicAssets.push({
              assetId: asset.id,
              title: audio.title || asset.displayName,
              durationFrames: asset.durationFrames!,
            });
            seenMusic.add(asset.id);
          }
        }
        continue;
      }
      const image = readBookImage(line.trim());
      if (!image) {
        if(isDialogue && line.trim()) { hasDialogueClassification=true; dialogueLines.add(lines.length); }
        lines.push(line);
        continue;
      }
      addImage(image.url, lines.length);
      }
    }
    // Old layout-only pictures are established selections too. Never sweep the warehouse.
    for (const page of chapter.layout?.pages ?? []) {
      let anchor = chapterStart;
      for (const module of page.modules) {
        if (module.kind === "image") addImage(module.imageUrl, anchor);
        else {
          const bind = Array.isArray(module.bind)
            ? module.bind.at(-1)
            : module.bind;
          const index = chapter.blocks.blockIds.indexOf(bind ?? "");
          const text = chapter.blocks.body.split("\n").filter(l => l.trim())[
            index
          ];
          if (text) {
            const offset = lines.slice(chapterStart).indexOf(text);
            if (offset >= 0) anchor = chapterStart + offset + 1;
          }
        }
      }
    }
  }
  pending.sort((a, b) => a.line - b.line);
  const body = lines.join("\n").trim();
  const rawBody=lines.join('\n'),trimOffset=rawBody.length-rawBody.trimStart().length;
  let position=0;
  const dialogueRanges=hasDialogueClassification ? lines.flatMap((line,index)=>{
    const start=position; position+=line.length+1;
    return dialogueLines.has(index) ? [{start:Math.max(0,start-trimOffset),end:Math.min(body.length,start+line.length-trimOffset)}] : [];
  }) : undefined;
  const paragraphs = imagePackParagraphs(body);
  const illustrations: IllustrationPlacement[] = pending.map(p => {
    const before = lines.slice(0, p.line).join("\n").trim();
    const previous = imagePackParagraphs(before).at(-1);
    // Locate by occurrence in the whole manuscript so duplicate paragraphs are stable.
    const count = imagePackParagraphs(before).length;
    return {
      assetId: p.assetId,
      after: previous ? (paragraphs[count - 1]?.anchor ?? null) : null,
    };
  });
  const starts = lines.flatMap((text, index) =>
    /^\s*(?:#{1,6}\s*)?(?:\*\*)?第\s*[零〇一二三四五六七八九十百\d]+\s*幕(?:\s|[·：:.、*]|$)/u.test(text)
      ? [index] : []
  );
  // A title before the images owns every following image until the next act.
  // Leading prose belongs to the opening act so the full source remains covered.
  const bookScenes = starts.length ? starts.map((start, index) => {
    const from = index === 0 ? 0 : start;
    const end = starts[index + 1] ?? lines.length + 1;
    return {
      id: `book-scene-${index + 1}`,
      text: lines.slice(from, end).join("\n").trim(),
      ...(hasDialogueClassification ? {dialogueText:lines.slice(from,end).filter((_,i)=>dialogueLines.has(from+i)).join('\n')} : {}),
      referenceImageIds: pending.filter(p => (index === 0 || p.line > from) && p.line <= end).map(p => p.assetId),
    };
  }) : undefined;
  return {
    layout: { body, illustrations, ...(dialogueRanges ? {dialogueRanges} : {}), ...(bookScenes ? { bookScenes } : {}) },
    missingImages,
    musicAssets,
    missingMusic,
    sourceHash: createHash("sha256")
      .update(
        JSON.stringify(
          chapters.map(c => ({
            id: c.id,
            title: c.title,
            body: c.blocks.body,
            ...(c.blocks.writingStyle?.some(row=>row.videoRole==='dialogue') ? {dialogueModules:c.blocks.writingStyle.map(row=>({id:row.id,lineCount:row.lineCount??1,role:row.videoRole??null}))} : {}),
            position: c.position,
            ...(c.layout ? { layout: c.layout } : {}),
          }))
        )
      )
      .digest("hex"),
  };
}
