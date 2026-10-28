import { describe, expect, it } from 'vitest';
import { layoutModuleContextSchema } from '@shared/layoutModuleContext';
import { bookBlockContext } from './bookBlockContext';
import { newWritingBlock } from './chapterBlockTree';
import { DesktopChatQueue } from '../storyAgent/desktopChatQueue';

const source = { storyId: 7, scope: 'account1:story7:chapter2:v3', chapterId: '2' };
describe('book block discussion context', () => {
  it('distinguishes identical and blank blocks, with their actual neighbours', () => {
    const blocks = ['重复', '', '重复', '尾段'].map(text => newWritingBlock(text));
    const context = bookBlockContext(blocks, blocks[2].id, source)!;
    expect(context.line?.position).toMatchObject({ index: 2, total: 4, prevText: '', nextText: '尾段', blockId: blocks[2].id });
    expect(layoutModuleContextSchema.safeParse(context).success).toBe(true);
    expect(bookBlockContext(blocks, blocks[1].id, source)?.text).toBe('');
  });
  it('drops deleted, collapsed or cleared targets and isolates source identity', () => {
    const heading = { ...newWritingBlock('标题'), format: 'heading1' as const, collapsed: true };
    const child = { ...newWritingBlock('子段'), parentId: heading.id };
    expect(bookBlockContext([heading, child], child.id, source)).toBeNull();
    expect(bookBlockContext([heading], child.id, source)).toBeNull();
    expect(bookBlockContext([heading], null, source)).toBeNull();
    expect(bookBlockContext([heading], heading.id, { ...source, storyId: 8, scope: 'new-story' })).toMatchObject({ storyId: 8, scope: 'new-story' });
  });
  it('carries the reflowed geometry and bounds long text', () => {
    const block = { ...newWritingBlock('文'.repeat(21000)), book: { page: 11, rect: { x: 20, y: 30, width: 200, height: 300 }, fontSize: 32 } };
    const context = bookBlockContext([block], block.id, source)!;
    expect(context).toMatchObject({ page: 1, pageCount: 1, rect: { x: 24, y: 48, width: 860 }, fontSize: 32 });
    expect(layoutModuleContextSchema.safeParse(context).success).toBe(true);
    expect(context.text).toHaveLength(12000);
    expect(context.line?.excerpt.length).toBeLessThanOrEqual(6000);
  });
  it('freezes the chosen block at send time while subsequent editing follows the latest text', () => {
    const block = newWritingBlock('原文');
    const module = bookBlockContext([block], block.id, source)!;
    const queue = new DesktopChatQueue('test', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    queue.enqueue('怎么继续写', { draft: block.text, cursor: 1, scope: source.scope, module });
    block.text = '刚刚写的新内容';
    expect(bookBlockContext([block], block.id, source)?.text).toBe(block.text);
    expect(queue.snapshot().items[0].writingContext?.module?.text).toBe('原文');
  });
});
