import { describe, expect, it } from 'vitest';
import { captureBookRewrite, applyBookRewrite } from './bookRewrite';
import { blockBody, newWritingBlock } from './chapterBlockTree';
import { bookRewriteSource } from '@shared/bookRewrite';
import { normalizeChatMessages } from '../storyAgent/types';

const source = { storyId: 7, scope: 'account:7:chapter:2' };
const blocks = () => ['前文', '送一部分作品给另一个人。', 'You meet inside the work.', '后文'].map(text => newWritingBlock(text));
describe('chat rewrite target', () => {
  it('replaces only the captured modules, keeps surrounding blocks and the first ID', () => {
    const before = blocks();
    const target = captureBookRewrite(before, [before[1].id, before[2].id], source)!;
    const after = applyBookRewrite(before, target, '新的中文。\n\nNew English.').blocks;
    expect(blockBody(after)).toBe('前文\n新的中文。\n\nNew English.\n后文');
    expect(after[1].id).toBe(before[1].id);
    expect(after[0]).toEqual(before[0]);
    expect(after.at(-1)).toEqual(before.at(-1));
    expect(before[1].text).toBe('送一部分作品给另一个人。');
  });
  it('uses exact forward or backward character boundaries', () => {
    const before = blocks();
    const target = captureBookRewrite(before, [before[1].id, before[2].id], source, {
      anchor: {id:before[2].id,offset:3}, focus: {id:before[1].id,offset:1},
    })!;
    expect(bookRewriteSource(target)).toBe('一部分作品给另一个人。\nYou');
    expect(blockBody(applyBookRewrite(before,target,'改写').blocks)).toBe('前文\n送改写 meet inside the work.\n后文');
  });
  it('allows unrelated edits but rejects changed, missing, reordered or newly intervening source blocks', () => {
    const before = blocks();
    const target = captureBookRewrite(before, [before[1].id,before[2].id],source)!;
    expect(applyBookRewrite(before.map((b,i)=>i===0?{...b,text:'新前文'}:b),target,'新').blocks[0].text).toBe('新前文');
    for (const changed of [
      before.map((b,i)=>i===1?{...b,text:'手动修改'}:b),
      before.filter((_,i)=>i!==1),
      [before[0],before[2],before[1],before[3]],
      [before[0],before[1],newWritingBlock('新增'),before[2],before[3]],
    ]) expect(()=>applyBookRewrite(changed,target,'新')).toThrow('原文已变化');
  });
  it('does not target disjoint, media, hidden or oversized selections', () => {
    const before=blocks();
    expect(captureBookRewrite(before,[before[0].id,before[2].id],source)).toBeUndefined();
    const media={...before[1],text:'![图片](https://example.com/a.jpg)'};
    expect(captureBookRewrite([before[0],media],[before[0].id,media.id],source)).toBeUndefined();
    const heading={...before[0],format:'heading1' as const,collapsed:true};
    const hidden={...before[1],parentId:heading.id};
    expect(captureBookRewrite([heading,hidden],[heading.id,hidden.id],source)).toBeUndefined();
    expect(captureBookRewrite([{...before[0],text:'字'.repeat(12001)}],[before[0].id],source)).toBeUndefined();
  });
  it('restores a validated proposal from chat history and drops malformed metadata', () => {
    const before=blocks(), target=captureBookRewrite(before,[before[1].id],source)!;
    const message={id:'reply',role:'assistant',content:'新的正文',timestamp:1,bookRewrite:{text:'新的正文',target}};
    expect(normalizeChatMessages([message],[])[0].bookRewrite).toEqual(message.bookRewrite);
    expect(normalizeChatMessages([{...message,bookRewrite:{text:'新',target:{...target,parts:[{...target.parts[0],end:99999}]}}}],[])[0].bookRewrite).toBeUndefined();
  });
});
