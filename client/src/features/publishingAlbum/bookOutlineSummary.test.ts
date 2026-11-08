import { expect, it } from 'vitest';
import { bookAudioText } from '@shared/bookAudioBlock';
import { newWritingBlock, type WritingBlock } from './chapterBlockTree';
import { bookOutlineSummaries } from './bookOutlineSummary';
import { layoutBookBlocks } from './bookBlockLayout';

const rows = (): WritingBlock[] => [
  { ...newWritingBlock('场'), id: 'scene', format: 'scene' },
  { ...newWritingBlock('镜头', 'scene'), id: 'shot', format: 'shot', collapsed: true },
  { ...newWritingBlock('画面移动。', 'shot'), id: 'description' },
  { ...newWritingBlock('“你好！”\n再见。好的？', 'shot'), id: 'dialogue', videoRole: 'dialogue' },
  { ...newWritingBlock('', 'shot'), id: 'empty', videoRole: 'dialogue' },
  { ...newWritingBlock('![图片](/api/images/a.png)', 'shot'), id: 'image1' },
  { ...newWritingBlock('![图片](/api/images/b.png)', 'shot'), id: 'image2' },
  { ...newWritingBlock(bookAudioText(1, 2, '音乐'), 'shot'), id: 'music' },
  { ...newWritingBlock(bookAudioText(1, 3, '朗读', 'narration'), 'shot'), id: 'voice' },
];

it('counts actual descendant content even while folded, excluding headings and media markup', () => {
  const blocks = rows(), before = JSON.stringify(blocks);
  const stats = bookOutlineSummaries(blocks, { '/api/story-audio-asset/1/2': 12.25 });
  expect(stats.get('shot')).toMatchObject({ characters: 10, dialogue: 3, music: 1, musicSeconds: 12.25, unknownMusic: 0, narration: 1 });
  expect(stats.get('scene')?.shots).toBe(1);
  expect(stats.get('shot')?.images.map(image => image.id)).toEqual(['image1', 'image2']);
  expect(JSON.stringify(blocks)).toBe(before);
});

it('never treats a music suggestion or narration as produced music, and does not invent unknown duration', () => {
  const blocks = rows();
  expect(bookOutlineSummaries(blocks).get('shot')).toMatchObject({ music: 1, musicSeconds: 0, unknownMusic: 1 });
  blocks[7].text = '背景音乐：温暖钢琴，建议 15 秒（尚未制作）';
  expect(bookOutlineSummaries(blocks).get('shot')).toMatchObject({ music: 0, musicSeconds: 0, unknownMusic: 0, narration: 1 });
});

it('reserves summary and reference preview space, while retaining all original image modules on expansion', () => {
  const blocks = rows();
  const folded = layoutBookBlocks(blocks);
  expect(folded.map(row => row.block.id)).toEqual(['scene', 'shot']);
  for (const width of [900, 480]) {
    const expanded = layoutBookBlocks(blocks.map(b => ({ ...b, collapsed: false })), {}, width);
    expect(expanded.map(row => row.block.id)).toEqual(blocks.map(b => b.id));
    expect(expanded[1].placement.rect.x).toBeGreaterThan(expanded[0].placement.rect.x);
    expect(expanded[1].placement.rect.height).toBeGreaterThan(folded[1].placement.rect.height);
    expanded.slice(1).forEach((row, i) => {
      const previous = expanded[i].placement;
      expect(row.placement.page > previous.page || row.placement.rect.y >= previous.rect.y + previous.rect.height).toBe(true);
    });
  }
});
