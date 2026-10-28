import { expect, it } from 'vitest';
import { restoreChapterWritingDraft, draftNeedsVersionReview } from './chapterWritingDraft';
const saved = {title:'VC',body:'服务器新稿',version:8};
it('never grants an unknown old cache the current server version', () => {
  const draft = restoreChapterWritingDraft(JSON.stringify({title:'旧题',body:'本机旧稿'}),saved);
  expect(draft.body).toBe('本机旧稿'); expect(draft.baseVersion).toBeNull();
  expect(draftNeedsVersionReview(draft,saved)).toBe(true);
});
it('preserves the actual base version when another browser saved newer writing', () => {
  const draft=restoreChapterWritingDraft(JSON.stringify({title:'VC',body:'本机编辑',baseVersion:7}),saved);
  expect(draft.baseVersion).toBe(7); expect(draftNeedsVersionReview(draft,saved)).toBe(true);
});
it('allows an unchanged or current-base draft without inventing a conflict', () => {
  expect(draftNeedsVersionReview(restoreChapterWritingDraft(JSON.stringify({title:'VC',body:'本机编辑',baseVersion:8}),saved),saved)).toBe(false);
  const same=restoreChapterWritingDraft(JSON.stringify({title:'VC',body:'服务器新稿',baseVersion:2}),saved);
  expect(same.baseVersion).toBe(8); expect(draftNeedsVersionReview(same,saved)).toBe(false);
});
it.each([null,'{broken','{}','{"title":9,"body":false}'])('falls back to server content without mutating invalid storage: %s', raw=>{
  expect(restoreChapterWritingDraft(raw,saved)).toEqual({title:'VC',body:'服务器新稿',baseVersion:8});
});
