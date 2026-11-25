import { expect, it, vi } from 'vitest';
const invoke = vi.hoisted(()=>vi.fn(async (_messages: import('../_core/llm').Message[], ..._rest: unknown[])=>({text:'图1的云更蓝，图2的树更疏。',modelLabel:'mock'})));
vi.mock('../_core/agentChannel',()=>({hasStoryAgentCompute:()=>true,invokeAgent:invoke}));
import { replyFromStoryAgent } from './storyReply';
it('passes interleaved images into the actual model conversation without extracting edits or generating media',async()=>{
  const content=[{type:'text' as const,text:'比较图1'}, {type:'image_url' as const,image_url:{url:'data:image/png;base64,AA',detail:'high' as const}}, {type:'text' as const,text:'和图2'}, {type:'image_url' as const,image_url:{url:'data:image/png;base64,BB',detail:'high' as const}}];
  const result=await replyFromStoryAgent({message:'比较图1和图2',inlineImageContent:content,allowStoryTitleSuggestion:false});
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke.mock.calls[0][0].at(-1)).toEqual({role:'user',content});
  expect(result.reply).toContain('图1');expect(result.toolCalls).toEqual([]);expect(result.card).toBeNull();
});
it.each([undefined, "publishing" as const])("guides the web reply towards one available next step in %s mode",async interactionMode=>{
  invoke.mockClear();
  await replyFromStoryAgent({ message:"我想讨论这个镜头", allowStoryTitleSuggestion:false, guideNextStep:true, interactionMode });
  const replyCall = invoke.mock.calls.find(([messages])=>messages.at(-1)?.content === "我想讨论这个镜头");
  expect(replyCall?.[0][0].content).toContain("只描述当前已知可用的操作");
  expect(replyCall?.[0][0].content).toContain("区分用户的动机与委托人期待");
});
