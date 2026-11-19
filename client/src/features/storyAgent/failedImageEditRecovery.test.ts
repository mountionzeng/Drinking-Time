import {expect,it} from 'vitest';
import {inlineImageToken} from '@shared/inlineChatImages';
import {failedImageEditRecovery,quotedImageEditRecovery,recoveredImageEditQuoteMessages} from './failedImageEditRecovery';
import {archiveMessagesFrom} from './StoryAgentContext';
import {normalizeChatMessages,type ChatMessage} from './types';

const text='这飞机他太大了，大一倍就可以，另外他还是两个飞机把小的飞机给去掉';
const user:ChatMessage={id:'u',role:'user',timestamp:1,content:text,
  selectionQuote:{sourceType:'storyboard-image',sourceId:'2126',storyId:1217,stableShotId:'shot-3',shotNo:3,imageId:2126,selectedText:'图片 #2126'}};
const failed:ChatMessage={id:'f',role:'assistant',timestamp:2,content:'这条消息未完成：对话服务连接中断。原话和当前选图已保留，没有自动重试。'};
const images=[{imageId:2126,imageUrl:'/api/images/2126.png',label:'#2126'},{imageId:2123,imageUrl:'/api/images/2123.png',label:'#2123'}];

it('recovers arbitrary original feedback against its saved image without parsing edit vocabulary or calling a model',()=>{
  const request=failedImageEditRecovery([user,failed],1217,images)!;
  expect(request).toMatchObject({instruction:text,ref:images[0],stableShotId:'shot-3',shotNo:3,storyId:1217});
  const quote=recoveredImageEditQuoteMessages(request,'2.86 算力',3);
  expect(quote[0].content).toBe(`${inlineImageToken(2126)} ${text}`);
  expect(quote[1].content).toContain('确认后才会提交');
  expect(quote[1].content).toContain('此前未完成的文字请求没有重试');
  expect(failedImageEditRecovery([user,failed,...quote],1217,images)).toBeNull();
});
it('retains the original image and words after archive/reload',()=>{
  const restored=normalizeChatMessages(archiveMessagesFrom([user,failed],[]),[]);
  expect(failedImageEditRecovery(restored,1217,images)?.instruction).toBe(text);
  expect(failedImageEditRecovery(restored,1217,images)?.ref.imageId).toBe(2126);
});
it('restores a saved quote without relying on the failed edit vocabulary or replaying payment',()=>{
  const request=failedImageEditRecovery([user,failed],1217,images)!;
  const quote=recoveredImageEditQuoteMessages(request,'2.86 算力',3);
  const restored=normalizeChatMessages(archiveMessagesFrom([user,failed,...quote],[]),[]);
  expect(quotedImageEditRecovery(restored,1217,images)).toEqual(request);
  expect(quotedImageEditRecovery(restored,999,images)).toBeNull();
  expect(quotedImageEditRecovery(restored,1217,images.slice(1))).toBeNull();
  expect(quotedImageEditRecovery([...restored,{...failed,id:'cancel',content:'已取消'}],1217,images)).toBeNull();
  expect(quotedImageEditRecovery([user,failed,{...quote[0],content:'another request'},quote[1]],1217,images)).toBeNull();
});
it('uses the explicit inline image rather than the last selected image',()=>{
  const inline={...user,content:`${inlineImageToken(2123)} ${text}`};
  expect(failedImageEditRecovery([inline,failed],1217,images)?.ref.imageId).toBe(2123);
});
it('never substitutes a missing image, another story, a region, or a multi-image plan',()=>{
  expect(failedImageEditRecovery([user,failed],999,images)).toBeNull();
  expect(failedImageEditRecovery([user,failed],1217,images.slice(1))).toBeNull();
  expect(failedImageEditRecovery([{...user,selectionQuote:{...user.selectionQuote!,selection:{kind:'text',start:0,end:2}}},failed],1217,images)).toBeNull();
  expect(failedImageEditRecovery([{...user,content:`${inlineImageToken(2123)}${inlineImageToken(2126)}${text}`},failed],1217,images)).toBeNull();
});
it('does not offer recovery for successful responses, interrupted image generation or a newer conversation turn',()=>{
  for(const content of ['图片任务已受理，请等待','我喜欢飞机','已生成图片'])
    expect(failedImageEditRecovery([user,{...failed,content}],1217,images)).toBeNull();
  expect(failedImageEditRecovery([user,failed,{...user,id:'new'}],1217,images)).toBeNull();
});
