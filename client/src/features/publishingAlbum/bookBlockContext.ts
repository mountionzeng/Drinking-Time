import { bookImageUrl } from "./bookImageBlock";
import type { LayoutModuleContext } from '@shared/layoutModuleContext';
import { lineContextExcerpt, linePosition } from '@shared/lineModules';
import type { WritingBlock } from './chapterBlockTree';
import { layoutBookBlocks } from './bookBlockLayout';

/** Book editing and layout discussion share the same bounded, read-only chat contract. */
export function bookBlockContext(
  blocks: WritingBlock[], selectedId: string | null,
  source: { storyId: number; scope: string; chapterId: string },
): LayoutModuleContext | null {
  const layouts = layoutBookBlocks(blocks);
  const selected = layouts.find(item => item.block.id === selectedId);
  if (!selected) return null;
  const { block, index, placement } = selected;
  const lines = blocks.map(item => ({ id: item.id, text: item.text.slice(0, 20_000) }));
  const position = linePosition(source.chapterId, lines, index)!;
  return {
    storyId: source.storyId, scope: source.scope, moduleId: block.id, kind: bookImageUrl(block.text) ? 'image' : 'text',
    ...(bookImageUrl(block.text) ? {imageUrl:bookImageUrl(block.text)!} : {}),
    page: placement.page + 1,
    pageCount: Math.max(...layouts.map(item => item.placement.page + 1)),
    rect: { ...placement.rect }, fontSize: placement.fontSize,
    emphasis: block.emphasis ?? 'normal', backdrop: Boolean(block.backdrop),
    text: bookImageUrl(block.text) ? "文章插图" : block.text.slice(0, 12_000),
    pageText: layouts.filter(item => item.placement.page === placement.page).map(item => item.block.text).join('\n').slice(0, 16_000),
    // Local editor ids identify the discussion target, not server-owned chapter blocks.
    line: { source: 'layout', position,
      excerpt: lineContextExcerpt({ lines: lines.map(item => item.text), index, limit: 6000 }) },
  };
}
