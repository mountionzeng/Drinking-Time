import { z } from "zod";
import { inlineChatParts, type InlineChatPart } from "./inlineChatImages";

const unit = z.number().finite().min(0).max(1);
export const pictureRegionSchema = z.object({ left:unit, top:unit, right:unit, bottom:unit })
  .refine(r => r.right > r.left && r.bottom > r.top, "选区过小，请重新框选");
export type PictureRegion = z.infer<typeof pictureRegionSchema>;
export type RegionReading = { text:string; object:string; available:boolean };

export function pictureRegionNote(region:PictureRegion, reading:RegionReading, en:boolean) {
  const pct = (value:number) => Number((value * 100).toFixed(1)) + "%";
  const bounds = "x " + pct(region.left) + "–" + pct(region.right) + ", y " + pct(region.top) + "–" + pct(region.bottom);
  // Recognized lettering is a quote, never a second image reference or a user instruction.
  const literal = (s:string) => s.replace(/\[\[ref:/gi,"［［ref：").replace(/[\r\n]+/g," ").replace(/[「」〔〕]/g,"'").slice(0,160);
  const subject = reading.text ? (en ? "text " : "文字") + "「" + literal(reading.text) + "」"
    : reading.object ? (en ? "possible object: " : "可能是") + literal(reading.object) : "";
  return "〔" + (en ? "Region " : "选区 ") + bounds + (subject ? " · " + subject : "") + "〕";
}

const regionNotePattern = /〔(?:选区|Region) x [0-9.]+%–[0-9.]+%, y [0-9.]+%–[0-9.]+%(?: · [^〕]*)?〕/g;

/** OCR can contain verbs and questions. Only the user's words decide which chat action to take. */
export function withoutPictureRegionNotes(text: string) {
  return text.replace(regionNotePattern, "");
}

/** Keep the existing wire/archive format. Display the following region note inside its image chip. */
export function chatPictureParts(text: string): (InlineChatPart & { note?: string })[] {
  const parts = inlineChatParts(text);
  const result: (InlineChatPart & { note?: string })[] = [];
  for (const part of parts) {
    const previous = result.at(-1);
    const note = previous?.imageId && !part.imageId && part.text.trimStart().match(regionNotePattern)?.[0];
    if (note && part.text.trimStart().startsWith(note)) {
      previous.note = note;
      const tail = part.text.trimStart().slice(note.length);
      if (tail) result.push({ text: tail });
    } else {
      result.push(part);
    }
  }
  return result;
}

export function pictureRegionLabel(note: string, en: boolean) {
  const subject = note.slice(0, -1).split(" · ").slice(1).join(" · ")
    .replace(/^(?:文字|text )「(.*)」$/, "$1");
  return subject || (en ? "Selection" : "选区");
}

export type RegionMatch = { imageId:number; status:"source"|"matched"|"not-found"|"review"; region?:PictureRegion; detail:string };

export function regionFromNote(note: string) {
  const match = note.match(/^〔(?:选区|Region) x ([\d.]+)%–([\d.]+)%, y ([\d.]+)%–([\d.]+)%/);
  if (!match) return undefined;
  const [left,right,top,bottom] = match.slice(1).map(value => Number(value)/100);
  const parsed = pictureRegionSchema.safeParse({left,right,top,bottom});
  return parsed.success ? parsed.data : undefined;
}

/** OCR boxes can clip antialiased stroke tips. Display the same small margin that the eraser will use. */
export function localEraseBounds(region: PictureRegion, source: boolean): PictureRegion {
  if (source) return region;
  const margin = Math.min(.003, (region.bottom - region.top) * .10);
  return { left: Math.max(0, region.left - margin), top: Math.max(0, region.top - margin),
    right: Math.min(1, region.right + margin), bottom: Math.min(1, region.bottom + margin) };
}
