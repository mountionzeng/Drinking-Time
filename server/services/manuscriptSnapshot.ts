import { createHash } from "node:crypto";
import type { ManuscriptContent } from "../../shared/bookWorkflow";
export const manuscriptContents = (rows: ManuscriptContent[]) =>
  rows.map(({ title, blocks, layout }) => ({
    title,
    blocks: structuredClone(blocks),
    layout: structuredClone(layout),
  }));
export function manuscriptFingerprint(chapters: ManuscriptContent[]) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        chapters.map(({ title, blocks, layout }) => {
          const {
            attribution,
            manuscriptKind,
            manuscriptArchived,
            draftMirror,
            ...content
          } = blocks;
          return { title, blocks: content, layout };
        })
      )
    )
    .digest("hex");
}
