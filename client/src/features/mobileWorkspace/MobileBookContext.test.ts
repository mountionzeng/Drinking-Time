import { followsWritingSource } from "./mobileMemoryFollowup";
import { describe, expect, it } from 'vitest';
import { mobileBookSource } from './MobileBookContext';
import type { DesktopWritingSession } from '@/features/writingCompanion/desktopWritingSession';
const session = { storyId: 3, snapshot: { module: { storyId:3, scope:'9:3:chapter:2', moduleId:'a', kind:'text', page:1,pageCount:1,rect:{x:24,y:48,width:100,height:52},text:'第一行\n第二行',pageText:'第一行\n第二行',selection:{count:2,ids:['a','b']} } } } as DesktopWritingSession;
describe('mobile book context', () => {
  it('keeps selected modules and line breaks in the existing companion contract', () => {
    const source=mobileBookSource(session,9,3);
    expect(source?.module).toBe(session.snapshot.module);
    expect(source?.title).toBe('已选 2 个模块');
    expect(source?.content).toContain('第一行\n第二行');
    expect(source?.kind).toBe('layout');
  });
  it('rejects other accounts, stories and unselected drafts', () => {
    expect(mobileBookSource(session,8,3)).toBeNull();
    expect(mobileBookSource(session,9,4)).toBeNull();
    expect(mobileBookSource(null,9,3)).toBeNull();
  });
});

it('follows a newly edited module in the same story instead of keeping the old module id', () => {
  const previous = mobileBookSource(session, 9, 3)!;
  const next = { ...previous, id: 'another-module', module: { ...previous.module!, moduleId: 'b', text: '正在编辑的新模块' } };
  expect(followsWritingSource(previous, next)).toBe(true);
  expect(followsWritingSource(previous, { ...next, storyId: 4 })).toBe(false);
  expect(followsWritingSource(previous, { ...next, kind: 'memory' })).toBe(false);
});
