import { validWritingStyle, writingModuleTexts, type BookWritingStyle } from "@shared/bookWritingStyle";
import { shotOutputSource } from "@shared/bookShotActions";
import { readBookShotChapter } from "@shared/bookShotDocument";
import type { BookShotLink } from "@shared/bookShotLinks";

type PicturePart = { id: string; text: string };
export type PictureSelection = PicturePart & {
  prompt?: string; selectionId?: string; parts?: PicturePart[];
  shotOwner?: string; sceneLink?: BookShotLink; precedingShots?: number;
};
type Writing = { body: string; writingStyle?: BookWritingStyle };

export function matchesPictureScene(source: PictureSelection, writing: Writing) {
  if (!source.shotOwner) return true;
  const shot = readBookShotChapter({ id: 0, blocks: writing }, undefined, source.precedingShots)
    .shots.find(s => s.moduleId === source.shotOwner);
  return Boolean(shot) && JSON.stringify(shot?.link?.reason === "同一场景" ? shot.link : undefined) === JSON.stringify(source.sceneLink);
}

function pictureRows(doc: Writing) {
  if (!doc.writingStyle || !validWritingStyle(doc.body, doc.writingStyle)) return [];
  const texts = writingModuleTexts(doc.body, doc.writingStyle);
  return doc.writingStyle.map((row, i) => ({ ...row, text: texts[i] }));
}

/** Read the selected saved input without granting an old draft a new save token. */
export function matchesSavedPictureSource(source: PictureSelection, local: Writing, saved: Writing) {
  if (!matchesPictureScene(source, local) || !matchesPictureScene(source, saved)) return false;
  const before = pictureRows(local);
  const after = pictureRows(saved);
  const parts = source.parts ?? [source];
  if (!parts.length || !parts.some(p => p.id === source.id && p.text === source.text)) return false;
  for (const part of parts) {
    const left = before.find(row => row.id === part.id);
    const right = after.find(row => row.id === part.id);
    if (!left || !right || left.text !== part.text || right.text !== part.text ||
        left.parentId !== right.parentId || left.format !== right.format || left.videoRole !== right.videoRole) return false;
  }
  if (source.prompt === undefined) return true;
  const project = (rows: typeof before) => shotOutputSource(rows, rows.findIndex(r => r.id === source.selectionId), "image");
  const l = project(before), r = project(after);
  return Boolean(l && r && l.owner.id === r.owner.id && [l,r].every(s =>
    s.prompt === source.prompt && s.parts.length === parts.length &&
    s.parts.every((p,i) => p.id === parts[i].id && p.text === parts[i].text)));
}
