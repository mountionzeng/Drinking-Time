import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({create:vi.fn(),send:vi.fn(),useConversation:vi.fn()}));
vi.mock('@/features/nayin/NayinContext',()=>({useNayin:()=>({element:'metal',visualTheme:'shiguang'})}));
vi.mock('@/lib/trpc',()=>({trpc:{storyAgent:{storyUpsert:{useMutation:()=>({mutateAsync:mocks.create})}},useUtils:()=>({storyAgent:{storyList:{invalidate:vi.fn()}}})}}));
vi.mock('./useMobileConversation',()=>({useMobileConversation:(input:unknown)=>{mocks.useConversation(input);return {historyState:'loading',canSend:false,isSubmitting:false,recoveryReady:false,recoveryTurns:[],messages:[],submit:mocks.send};}}));
import {MobileNewStoryCompanion} from './MobileNewStoryCompanion';
describe('new-story launcher',()=>{
 it('starts with no story scope and no creation or inference while closed',()=>{
  const html=renderToStaticMarkup(<MobileNewStoryCompanion userId={7}/>);
  expect(html).toContain('找小忆，聊一个新故事');
  expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain('role="dialog"');
  expect(mocks.useConversation).toHaveBeenCalledWith({userId:7,storyId:0});
  expect(mocks.create).not.toHaveBeenCalled();expect(mocks.send).not.toHaveBeenCalled();
 });
});
