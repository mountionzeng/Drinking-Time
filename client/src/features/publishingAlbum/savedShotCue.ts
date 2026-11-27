import { shotOutputSource, type ShotOutput } from "@shared/bookShotActions";
import { readProductionSeconds } from "@shared/bookShotProduction";

type CueRows = Parameters<typeof shotOutputSource>[0];

/** Compare the selected production inputs across a saved reading and the live editor. */
export function shotCueSourceKey(rows: CueRows, index: number, kind: ShotOutput) {
  const source = shotOutputSource(rows, index, kind);
  if (!source) return;
  const video = kind === "video" ? {
    images: source.images.map(row => [row.id, row.text]),
    seconds: readProductionSeconds(rows.filter(row => row.parentId === source.owner.id).map(row => row.text)),
  } : undefined;
  return JSON.stringify([source.owner.id, source.owner.text, source.label, source.prompt,
    source.parts.map(part => [part.id, part.text]), video]);
}
