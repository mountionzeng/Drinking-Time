import { beforeEach, expect, it, vi } from 'vitest';
import { inlineImageToken as t } from '../../shared/inlineChatImages';
const m=vi.hoisted(()=>({get:vi.fn(), materialize:vi.fn()}));
vi.mock('../repositories/images',()=>({getGeneratedImageById:m.get}));
vi.mock('./imageAssets',()=>({materializeImageInput:m.materialize}));
import { inlineChatImageContent } from './inlineChatImageContent';
beforeEach(()=>{vi.clearAllMocks();m.get.mockImplementation(async id=>({id,userId:8,storyId:7,imageUrl:`/image/${id}`}));m.materialize.mockImplementation(async url=>`data:${url}`);});
it('supplies full image content at the corresponding text position and resolves repeated references once',async()=>{
  const result=await inlineChatImageContent(`看${t(2110)}的云，再看${t(2109)}，比较${t(2110)}`,7,8);
  expect(result).toEqual([
    {type:'text',text:'看'}, {type:'text',text:'图1（图片 #2110）'}, {type:'image_url',image_url:{url:'data:/image/2110',detail:'high'}},
    {type:'text',text:'的云，再看'}, {type:'text',text:'图2（图片 #2109）'}, {type:'image_url',image_url:{url:'data:/image/2109',detail:'high'}},
    {type:'text',text:'，比较'}, {type:'text',text:'图1（图片 #2110）'},
  ]);
  expect(m.materialize).toHaveBeenCalledTimes(2);expect(m.materialize).toHaveBeenCalledWith('/image/2110',8);
});
it.each([{storyId:9,userId:8},{storyId:7,userId:9},null])('blocks foreign or missing images before reading their content (%j)',async row=>{
  m.get.mockResolvedValue(row && {...row,imageUrl:'/private'});
  await expect(inlineChatImageContent(t(2110),7,8)).rejects.toThrow('不属于');
  expect(m.materialize).not.toHaveBeenCalled();
});
it('rejects missing story and excess refs before database access',async()=>{
  await expect(inlineChatImageContent(t(1),undefined,8)).rejects.toThrow();
  await expect(inlineChatImageContent([1,2,3,4,5].map(t).join(''),7,8)).rejects.toThrow();
  expect(m.get).not.toHaveBeenCalled();
});
