import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({applied:false,session:null as any,success:vi.fn(),error:vi.fn()}));
vi.mock('react',async()=>({...await vi.importActual<typeof import('react')>('react'),useEffect:(fn:()=>void)=>fn(),useState:()=>[state.applied,(value:boolean)=>{state.applied=value;}]}));
vi.mock('sonner',()=>({toast:{success:state.success,error:state.error}}));
vi.mock('@/features/uiLanguage/UiLanguage',()=>({useUiText:()=> (text:string)=>text}));
vi.mock('./bookModuleActions',()=>({useBookModuleActions:Object.assign((select:any)=>select({session:state.session}),{getState:()=>({session:state.session})})}));
import { BookRewriteButton } from './BookRewriteButton';
const proposal={text:'新正文',target:{storyId:7,scope:'chapter:2',parts:[{id:'a',text:'原文',start:0,end:2}]}};
beforeEach(()=>{
  vi.stubGlobal('React',React);vi.clearAllMocks();state.applied=false;
  state.session={storyId:7,scope:'chapter:2',modules:[{id:'a',text:'原文'}],replaceRewrite:vi.fn(()=>{state.session.modules=[{id:'a',text:'新正文'}];})};
});
it('one click applies the captured text, displays completion, and enables again after undo',()=>{
  let button=BookRewriteButton({proposal,storyId:7});
  expect(button.props.disabled).toBe(false);button.props.onClick();
  expect(state.session.replaceRewrite).toHaveBeenCalledWith(proposal.target,'新正文');
  button=BookRewriteButton({proposal,storyId:7});expect(button.props.disabled).toBe(true);expect(button.props.children.at(-1)).toBe('已替换');
  state.session.modules=[{id:'a',text:'原文'}];
  button=BookRewriteButton({proposal,storyId:7});expect(button.props.disabled).toBe(false);expect(button.props.children.at(-1)).toBe('替换选中内容');
});
it('does not allow a different story, source, deleted or changed original',()=>{
  expect(BookRewriteButton({proposal,storyId:8}).props.disabled).toBe(true);
  state.session.scope='other';expect(BookRewriteButton({proposal,storyId:7}).props.disabled).toBe(true);
  state.session.scope='chapter:2';state.session.modules=[{id:'a',text:'手动新文'}];expect(BookRewriteButton({proposal,storyId:7}).props.disabled).toBe(true);
  state.session.modules=[];expect(BookRewriteButton({proposal,storyId:7}).props.disabled).toBe(true);
});
it('checks the live editor again at click time',()=>{
  const button=BookRewriteButton({proposal,storyId:7}), previous=state.session;
  state.session=null;button.props.onClick();
  expect(previous.replaceRewrite).not.toHaveBeenCalled();expect(state.error).toHaveBeenCalled();
});
