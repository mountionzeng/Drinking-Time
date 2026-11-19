import { beforeEach, expect, it } from 'vitest';
process.env.DATABASE_URL = '';
import { resetMemoryStateForTesting } from '../repositories/runtime';
import { createStory, getStoryById, updateStory } from '../repositories/stories';
import { createGeneratedImage, getStoryGeneratedImages } from '../repositories/images';
import { inlineImageToken, inlineChatInstruction } from '../../shared/inlineChatImages';
import { recoverChatImageRemix } from './chatImageRemixRecovery';
beforeEach(() => resetMemoryStateForTesting());
async function fixture() {
  const story = await createStory({userId:123,title:'recovery',body:{}});
  const source = await createGeneratedImage({storyId:story.id,userId:123,imageUrl:'/source',isCurrent:true,shotIdentity:'s3'});
  const text = `${inlineImageToken(source.id)} 云更白，森林更嫩`;
  const body = {shots:[{stableShotId:'s3',shotNo:3}], editingTimeline:{revision:35}, messages:[
    {id:'u',who:'u',text,timestamp:1},
    {id:'q',who:'s',text:'已收到 1 张引用，尚未开始改图',timestamp:2,selectionQuote:{storyId:story.id,stableShotId:'s3'}},
  ]};
  await updateStory(story.id,123,{body});
  const make = (prompt=inlineChatInstruction(text),userId=123)=>createGeneratedImage({storyId:story.id,userId,imageUrl:'/candidate',isCurrent:false,generationType:'inpaint',prompt:`gateway ${prompt} end`});
  return {story,source,body,make,input:{storyId:story.id,userId:123,quoteMessageId:'q'}};
}
it('recovers the exact saved result idempotently without adopting or replacing timeline data',async()=>{
  const f=await fixture();const image=await f.make();const before=await getStoryGeneratedImages(f.story.id,123);
  expect(await recoverChatImageRemix(f.input)).toMatchObject({imageId:image.id,stableShotId:'s3',sourceImageIds:[f.source.id]});
  await recoverChatImageRemix(f.input);
  expect(await getStoryGeneratedImages(f.story.id,123)).toEqual(before);
  const body=(await getStoryById(f.story.id,123))!.body as any;
  expect(body.editingTimeline).toEqual(f.body.editingTimeline);
  expect(body.shotConversationMedia).toHaveLength(1);
});
it('does not guess from a partial instruction, foreign owner, or missing result',async()=>{
  const f=await fixture();expect(await recoverChatImageRemix(f.input)).toBeNull();
  await f.make('森林更嫩');await f.make(undefined,124);
  expect(await recoverChatImageRemix(f.input)).toBeNull();
  await expect(recoverChatImageRemix({...f.input,userId:124})).rejects.toThrow();
});
it('stops on multiple exact candidates instead of selecting one',async()=>{
  const f=await fixture();await f.make();await f.make();
  await expect(recoverChatImageRemix(f.input)).rejects.toThrow('多个已保存候选');
  expect((await getStoryById(f.story.id,123))!.body).not.toHaveProperty('shotConversationMedia');
});
it('never claims a result before this quote or after the next quote',async()=>{
  const f=await fixture();const image=await f.make();const created=+new Date(image.createdAt);
  f.body.messages[1].timestamp=created+1;await updateStory(f.story.id,123,{body:f.body});
  expect(await recoverChatImageRemix(f.input)).toBeNull();
  f.body.messages[1].timestamp=2;
  f.body.messages.push({...f.body.messages[1],id:'q2',timestamp:created});
  await updateStory(f.story.id,123,{body:f.body});expect(await recoverChatImageRemix(f.input)).toBeNull();
});
it('requires a surviving shot and reference from this story',async()=>{
  const f=await fixture();await f.make();f.body.shots=[];
  await updateStory(f.story.id,123,{body:f.body});expect(await recoverChatImageRemix(f.input)).toBeNull();
});
