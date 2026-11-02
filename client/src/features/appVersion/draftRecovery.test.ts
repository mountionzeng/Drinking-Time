import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearRecoveredDraft, prepareDraftRecoveryUrl, readRecoveredDraft, registerDraftRecovery, updateRecoveredDraft } from './draftRecovery';
let data: Map<string,string>;
let release: (() => void) | undefined;
const draft = { title:'本机标题', body:'标题\n正文', baseVersion:3, writingStyle:[{id:'h',format:'heading1',collapsed:true},{id:'p',format:'text',parentId:'h'}] };
const raw = JSON.stringify(draft);
beforeEach(() => {
  data = new Map([['chapter-writing:9:12:2', '另一页草稿']]);
  vi.stubGlobal('localStorage', { getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>data.set(key,value),removeItem:(key:string)=>data.delete(key) });
  vi.stubGlobal('window', {location:{search:''}});
  release = registerDraftRecovery(()=>({scope:'9:12',chapterId:2,storyId:12,raw}));
});
afterEach(()=>{release?.(); vi.unstubAllGlobals();});
it('opens the exact story and transfers formatting/base without overwriting another tab cache',()=>{
  const url = new URL(prepareDraftRecoveryUrl('http://localhost:3000/editing'));
  expect(url.searchParams.get('storyId')).toBe('12');
  window.location.search=url.search;
  expect(readRecoveredDraft('9:12',2)).toBe(raw);
  expect(data.get('chapter-writing:9:12:2')).toBe('另一页草稿');
  expect(readRecoveredDraft('10:12',2)).toBeNull();
  expect(readRecoveredDraft('9:12',3)).toBeNull();
});
it('retains edits made after recovery and only clears an exact acknowledged snapshot',()=>{
  window.location.search=new URL(prepareDraftRecoveryUrl('http://localhost:3000/editing')).search;
  const newer=JSON.stringify({...draft,body:'继续修改'});
  updateRecoveredDraft('9:12',2,newer);
  clearRecoveredDraft('9:12',2,raw);
  expect(readRecoveredDraft('9:12',2)).toBe(newer);
  clearRecoveredDraft('9:12',2,newer);
  expect(readRecoveredDraft('9:12',2)).toBeNull();
});
it('does not navigate when browser storage cannot retain the live draft',()=>{
  vi.spyOn(localStorage,'setItem').mockImplementation(()=>{throw new Error('quota');});
  expect(()=>prepareDraftRecoveryUrl('http://localhost:3000/editing')).toThrow('quota');
  expect(data.get('chapter-writing:9:12:2')).toBe('另一页草稿');
});
it('uses independent recovery copies on repeated attempts',()=>{
  const first=new URL(prepareDraftRecoveryUrl('http://localhost:3000/editing'));
  const second=new URL(prepareDraftRecoveryUrl('http://localhost:3000/editing'));
  expect(first.search).not.toBe(second.search);
  window.location.search=first.search;clearRecoveredDraft('9:12',2,raw);
  window.location.search=second.search;expect(readRecoveredDraft('9:12',2)).toBe(raw);
});
it('does not leave a stale editor registered after unmount',()=>{
  release!();expect(prepareDraftRecoveryUrl('http://localhost:3000/editing')).toBe('http://localhost:3000/editing');
});
