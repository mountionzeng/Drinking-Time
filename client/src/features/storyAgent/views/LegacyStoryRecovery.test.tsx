import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { LegacyStoryRecovery, LegacyStoryRecoveryEntry } from './LegacyStoryRecovery';
vi.stubGlobal('React',React);
afterEach(()=>vi.unstubAllGlobals());
it('never shows a startup banner even when real legacy content exists',()=>{
  vi.stubGlobal('React',React);
  const storage={length:1,key:()=> 'dt:storyAgent:1',getItem:(key:string)=>key==='dt:storyAgent:1'?JSON.stringify({title:'旧文',messages:[{role:'user',content:'曾经写过的文字'}]}):null};
  vi.stubGlobal('window',{localStorage:storage});
  const onImport=vi.fn();
  expect(renderToStaticMarkup(<LegacyStoryRecovery userId={1} onImport={onImport}/>)).toBe('');
  expect(onImport).not.toHaveBeenCalled();
  expect(renderToStaticMarkup(<LegacyStoryRecoveryEntry onOpen={vi.fn()}/>)).toContain('找回本机旧内容');
});
it('does not offer a recovery entry for empty or unreadable storage',()=>{
  vi.stubGlobal('React',React); vi.stubGlobal('window',{localStorage:{length:2,key:(i:number)=>`dt:storyAgent:${i}`,getItem:(key:string)=>key.endsWith(':0')?'{}':'{invalid'}});
  expect(renderToStaticMarkup(<LegacyStoryRecoveryEntry onOpen={vi.fn()}/>)).toBe('');
});
