import { readBookAudio } from "@shared/bookAudioBlock";
import { readBookImage } from "@shared/bookImageBlock";
import { shotActionHeading, shotOutputLabels, type ShotOutput } from "@shared/bookShotActions";
import { readShotField } from "@shared/bookShotFormat";
import type { WritingBlock } from "./chapterBlockTree";

type Paragraph = { start: number; output: ShotOutput };

export function continuesShotHeading(previous: WritingBlock | undefined, current: WritingBlock) {
  if (!previous || previous.format !== "text" || current.format !== "text" || previous.parentId !== current.parentId) return false;
  const header = shotActionHeading(previous.text);
  if (!header || header.inline) return false;
  const next = shotActionHeading(current.text);
  return Boolean(next && next.output === header.output && next.inline && !next.detail);
}

/** Old manuscripts store the heading and its following paragraphs in separate modules. */
export function shotParagraphs(blocks: WritingBlock[]) {
  const formats = new Map<string, Paragraph>();
  let section: Paragraph | undefined;
  for (const [i, block] of blocks.entries()) {
    if (block.format !== "text" || block.parentId !== blocks[i - 1]?.parentId) section = undefined;
    if (block.format !== "text" || readBookAudio(block.text) || readBookImage(block.text)) continue;
    const heading = shotActionHeading(block.text);
    if (block.videoRole === "dialogue" && heading?.output !== "narration") {
      if (section?.output !== "narration") section = { start: i, output: "narration" };
    } else if (heading) {
      if (!section || !continuesShotHeading(blocks[i - 1], block)) section = { start: i, output: heading.output };
    } else if (readShotField(block.text.split("\n", 1)[0]) || !block.parentId || blocks[section?.start ?? -1]?.videoRole === "dialogue") section = undefined;
    if (section) formats.set(block.id, section);
    // The next module continues the last field, never the first field of a mixed module.
    if (block.text.split("\n").slice(1).some(line => readShotField(line))) section = undefined;
  }
  return formats;
}

/** Change just the manuscript heading. Keep the original module IDs, paragraph text and cue timing. */
export function setShotParagraphFormat(blocks: WritingBlock[], index: number, output: ShotOutput, formats = shotParagraphs(blocks)) {
  const selected = blocks[index];
  const section = formats.get(selected.id);
  if (section?.output === output) return blocks;
  const header = section && shotActionHeading(blocks[section.start].text);
  const wholeSection = section?.start === index && header && !header.inline;
  const dedicatedHeader = section && section.start + 1 === index && header && !header.inline;
  const start = dedicatedHeader ? section.start : index;
  const nextBody = !wholeSection && section
    ? blocks.findIndex((row, i) => i > index && formats.get(row.id) === section)
    : -1;
  const block = blocks[start];
  const parsed = shotActionHeading(block.text);
  const heading = block.videoRole === "dialogue" && parsed?.output !== "narration" ? undefined : parsed;
  const body = block.text.slice(heading?.prefix.length ?? 0);
  const label = shotOutputLabels[output].name + (heading?.detail.replace(/^ · (开场|结束|参考)/, "｜$1") ?? "");
  const separator = heading?.prefix.endsWith("\n") ? (block.text.includes("\n") ? "\n" : "") : "：";
  return blocks.map((row, i) => {
    if (i === start) return { ...row, text: label + separator + body, videoRole: undefined };
    if (section && i === nextBody) {
      const label = shotOutputLabels[section.output].name + (header?.detail.replace(/^ · /, "｜") ?? "");
      return { ...row, text: label + "：" + row.text, videoRole: undefined };
    }
    if (section && formats.get(row.id) === section && (wholeSection || i === index)) {
      if (row.videoRole === "dialogue") {
        // A spoken sentence can literally start with a reserved cue, e.g. “音乐：…”.
        const text = readShotField(row.text.split("\n", 1)[0]) ? shotOutputLabels[output].name + "：" + row.text : row.text;
        return { ...row, text, videoRole: undefined };
      }
      if (continuesShotHeading(blocks[i - 1], row)) {
        const cue = shotActionHeading(row.text)!;
        return { ...row, text: shotOutputLabels[output].name + "：" + row.text.slice(cue.prefix.length) };
      }
    }
    return row;
  });
}
