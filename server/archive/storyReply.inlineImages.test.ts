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
