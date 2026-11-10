import { readBookAudio } from '@shared/bookAudioBlock';
import { bookImageUrl } from '@shared/bookImageBlock';
import type { WritingBlock } from './chapterBlockTree';

export type BookOutlineSummary = {
  characters: number;
  dialogue: number;
  images: Array<{ id: string; url: string }>;
  shots: number;
  sections: number;
  music: number;
  musicSeconds: number;
  unknownMusic: number;
  narration: number;
};

/** Summaries are a projection of the actual subtree, never a second saved copy. */
export function bookOutlineSummaries(blocks: WritingBlock[], durations: Record<string, number> = {}) {
  const result = new Map<string, BookOutlineSummary>();
  for (const block of blocks) {
    const image = bookImageUrl(block.text), audio = readBookAudio(block.text);
    const text = block.format === 'text' && !image && !audio ? block.text : '';
    const seconds = audio ? durations[audio.url] : undefined;
    const known = seconds !== undefined && Number.isFinite(seconds) && seconds > 0;
    result.set(block.id, {
      characters: (text.match(/[\p{L}\p{N}]/gu) ?? []).length,
      dialogue: block.videoRole === 'dialogue'
        ? text.split(/[。！？!?\n]+|\.(?:\s|$)/u).filter(sentence => /[\p{L}\p{N}]/u.test(sentence)).length : 0,
      images: image ? [{ id: block.id, url: image }] : [],
      shots: block.format === 'shot' ? 1 : 0,
      sections: block.format === 'heading2' ? 1 : 0,
      music: audio?.kind === 'music' ? 1 : 0,
      musicSeconds: audio?.kind === 'music' && known ? seconds! : 0,
      unknownMusic: audio?.kind === 'music' && !known ? 1 : 0,
      narration: audio?.kind === 'narration' ? 1 : 0,
    });
  }
  // Children precede parents during accumulation; prepend to retain manuscript order.
  for (const block of [...blocks].reverse()) {
    const own = result.get(block.id)!, parent = block.parentId ? result.get(block.parentId) : undefined;
    if (!parent) continue;
    parent.images.unshift(...own.images);
    for (const key of ['characters', 'dialogue', 'shots', 'sections', 'music', 'musicSeconds', 'unknownMusic', 'narration'] as const)
      parent[key] += own[key];
  }
  return result;
}

export const BOOK_SHOT_SUMMARY_HEIGHT = 56;
export const BOOK_SHOT_IMAGES_HEIGHT = 108;
export function bookOutlineExtraHeight(block: WritingBlock, summary: BookOutlineSummary) {
  return block.format === 'shot'
    ? BOOK_SHOT_SUMMARY_HEIGHT + (!block.collapsed && summary.images.length ? BOOK_SHOT_IMAGES_HEIGHT : 0)
    : 0;
}
