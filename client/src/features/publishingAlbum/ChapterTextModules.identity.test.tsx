import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { ChapterTextModules } from './ChapterTextModules';
import { validWritingStyle, writingModuleTexts } from '@shared/bookWritingStyle';
const hooks=vi.hoisted(()=>({effects:[] as Array<()=>unknown>}));
vi.mock('react',async()=>({...await vi.importActual('react'),useLayoutEffect:(effect:()=>unknown)=>hooks.effects.push(effect)}));
afterEach(()=>{hooks.effects=[];vi.unstubAllGlobals();});
it('persists the rendered legacy module IDs before a conversion without changing line breaks',()=>{
  vi.stubGlobal('React',React);
  const save=vi.fn(), body='第一段\n\n第二段';
  renderToStaticMarkup(<ChapterTextModules value={body} disabled={false} onChange={()=>{}} onFormattedChange={save} selection={{current:null}}/>);
  hooks.effects.forEach(effect=>effect());
  expect(save).toHaveBeenCalledOnce();
  const [savedBody,style]=save.mock.calls[0];
  expect(savedBody).toBe(body);
  expect(validWritingStyle(body,style)).toBe(true);
  expect(writingModuleTexts(body,style)).toEqual(['第一段','','第二段']);
  expect(new Set(style.map((row:any)=>row.id)).size).toBe(3);
});
it('does not replace existing multiline module identity',()=>{
  vi.stubGlobal('React',React);
  const save=vi.fn(), style=[{id:'kept',format:'text' as const,parentId:null,collapsed:false,lineCount:2}];
  renderToStaticMarkup(<ChapterTextModules value={'第一行\n第二行'} writingStyle={style} disabled={false} onChange={()=>{}} onFormattedChange={save} selection={{current:null}}/>);
  hooks.effects.forEach(effect=>effect());
  expect(save).not.toHaveBeenCalled();
});
