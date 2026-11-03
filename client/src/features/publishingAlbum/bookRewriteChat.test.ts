import { expect, it, vi } from 'vitest';
import { bookRewriteChatSnapshot } from './bookRewriteChat';
import { DesktopChatQueue } from '../storyAgent/desktopChatQueue';
import type { BookModuleActions } from './bookModuleActions';
import type { WritingCompanionSnapshot } from '../writingCompanion/writingCompanionText';

it('fixes the exact source before queueing, including after later selection changes',()=>{
  const target={storyId:7,scope:'chapter:2',parts:[{id:'a',text:'前文原文后文',start:2,end:4}]};
  const editor={captureRewrite:vi.fn(()=>target)} as unknown as BookModuleActions;
  const snapshot={draft:'前文原文后文',cursor:2,scope:'chapter:2',module:{moduleId:'a'}} as WritingCompanionSnapshot;
  const queue=new DesktopChatQueue('test',null);
  queue.enqueue('改写',bookRewriteChatSnapshot(snapshot,editor));
  target.parts[0].text='后来选中';snapshot.module!.moduleId='b';
  expect(queue.snapshot().items[0].writingContext).toMatchObject({rewriteSource:'原文',module:{moduleId:'a'},bookRewriteTarget:{parts:[{text:'前文原文后文'}]}});
});
it('allows ordinary discussion when a target cannot be captured',()=>{
  const snapshot={draft:'正文',scope:'chapter:2',cursor:0,module:{moduleId:'a'}} as WritingCompanionSnapshot;
  expect(bookRewriteChatSnapshot(snapshot,null)).toBe(snapshot);
  expect(bookRewriteChatSnapshot(snapshot,{captureRewrite(){throw Error('已关闭');}} as unknown as BookModuleActions)).toBe(snapshot);
});
