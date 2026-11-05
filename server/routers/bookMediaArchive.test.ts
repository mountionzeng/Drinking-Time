import {expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({resolve:vi.fn(),describe:vi.fn(),save:vi.fn(),quote:vi.fn()}));
vi.mock('../services/storyNarration',()=>({quoteStoryNarration:m.quote}));
vi.mock('../services/bookModuleSource',()=>({resolveBookModuleSource:m.resolve,describeBookModule:m.describe}));
vi.mock('../repositories/memoryCards',()=>({insertMemoryCard:m.save}));
import {bookMediaRouter} from './bookMedia';
it('passes every selected narration ID and authenticated owner to the quote service',async()=>{
 m.quote.mockResolvedValue({quoteToken:'signed'});
 const caller=bookMediaRouter.createCaller({user:{id:7},req:{},res:{}} as any);
 await caller.quoteNarration({storyId:1,chapterId:2,moduleId:'a',moduleIds:['a','b']});
 expect(m.quote).toHaveBeenCalledWith(expect.objectContaining({storyId:1,userId:7,bookTarget:{chapterId:2,moduleId:'a',moduleIds:['a','b']}}));
});
it('persists generated text before returning it for automatic insertion',async()=>{
 m.resolve.mockResolvedValue({fingerprint:'source'});m.describe.mockResolvedValue('图中的雨天');m.save.mockResolvedValue({id:'saved'});
 const caller=bookMediaRouter.createCaller({user:{id:7},req:{},res:{}} as any);
 expect(await caller.describe({storyId:1,chapterId:2,moduleId:'a'})).toMatchObject({text:'图中的雨天',cardId:'saved'});
 expect(m.save).toHaveBeenCalledWith(7,expect.objectContaining({content:'图中的雨天',origin:'assistant',sourceStoryId:1}));
 m.save.mockRejectedValue(new Error('保存失败'));await expect(caller.describe({storyId:1,chapterId:2,moduleId:'a'})).rejects.toThrow('保存失败');
});
