import { expect, it } from 'vitest';
import { inlineImageToken as t } from '@shared/inlineChatImages';
import { compileInlineChatDraft, continueInlineImageEdit, selectedRegionReply } from './inlineChatDraft';
import { buildChatImageRemixRequest } from './chatImageRefs';
import { normalizeChatMessages } from './types';
const images = [2109,2110].map(imageId => ({imageId, imageUrl:`/api/images/${imageId}.png`, label:`图片 #${imageId}`}));
it.each(['我的意思是只留一个飞机就好了', '不是这个范围，你只需要去掉一个飞机和他的尾巴就好了', '把小的飞机给去掉'])('recognizes object removal without dropping the correction: %s', text => {
  const draft = compileInlineChatDraft(`${t(2110)} ${text}`, images);
  expect(draft.edit).toBe(true);
  expect(draft.instruction).toContain(text);
  expect(continueInlineImageEdit(text, 2110, images)).toBe(`${t(2110)} ${text}`);
});
it('routes the failed plane-size feedback with its explicit image into a quote, preserving every word', () => {
  const available = [{imageId:2123,imageUrl:'/api/images/2123.png',label:'图片 #2123'}];
  const text = '我喜欢这张，但是有个问题是只有一个飞机飞机大一点';
  const draft = compileInlineChatDraft(`${text}${t(2123)}`, available);
  expect(draft.edit).toBe(true);
  expect(draft.refs.map(ref => ref.imageId)).toEqual([2123]);
  expect(buildChatImageRemixRequest(draft)).toMatchObject({
    referenceImageUrl:'/api/images/2123.png',
    explicitInstruction:`${text}图1（图片 #2123）`,
  });
  expect(continueInlineImageEdit(text,2123,available)).toBe(`${t(2123)} ${text}`);
});
it.each(['飞机大一点','飞机再小一点点','把飞机调大一点','请把飞机放大','飞机缩小一些'])('recognizes size feedback as a pending edit: %s', text => {
  expect(compileInlineChatDraft(`${t(2110)} ${text}`,images).edit).toBe(true);
});
it.each(['飞机不要大一点','别把飞机放大','不需要飞机再小一点','不想把飞机缩小','飞机大一点好吗','哪架飞机大一点','飞机为什么变大了','这架飞机比那架大一点','飞机本来就大一点','飞机已经放大了','我喜欢这张，飞机大小正好'])('keeps size questions, observations and refusals out of the edit route: %s', text => {
  expect(compileInlineChatDraft(`${t(2110)} ${text}`,images).edit).toBe(false);
  expect(continueInlineImageEdit(text,2110,images)).toBe(text);
});
it('recognizes separate edits without treating 分别修改 as the negative 别修改', () => {
  for (const text of ['这两张原图要分别修改', '各自分别调整颜色', '分别改图，保留各自飞机'])
    expect(compileInlineChatDraft(`${t(2109)}${t(2110)} ${text}`, images).edit).toBe(true);
  for (const text of ['别修改', '请别修改', '两张图都别修改', '不要分别修改', '不要生成'])
    expect(compileInlineChatDraft(`${t(2109)}${t(2110)} ${text}`, images).edit).toBe(false);
});
it('sends actual URLs in inline order with each instruction still beside the correct image', () => {
  const draft = compileInlineChatDraft(`修改${t(2110)}的云，参考${t(2109)}的树，保留${t(2110)}的亮度`, images);
  expect(draft.edit).toBe(true);
  const request = buildChatImageRemixRequest(draft);
  expect(request).toMatchObject({referenceImageUrl:'/api/images/2110.png', referenceContextImageUrls:['/api/images/2109.png'], explicitInstruction:'修改图1（图片 #2110）的云，参考图2（图片 #2109）的树，保留图1（图片 #2110）的亮度'});
});
it('keeps comparison, advice and negated edits out of the paid generation route', () => {
  for (const text of ['哪张更好？','这张应该怎么修改','不要改图，只比较两图','建议如何调整？'])
    expect(compileInlineChatDraft(`${t(2109)}${text}${t(2110)}`,images).edit).toBe(false);
});
it('deleted atoms stop being references and unavailable images block sending', () => {
  expect(compileInlineChatDraft(`修改${t(2110)}`,images).refs.map(r=>r.imageId)).toEqual([2110]);
  expect(()=>compileInlineChatDraft(`修改${t(99)}`,images)).toThrow('尚未加载');
  expect(()=>compileInlineChatDraft(t(2110),images)).toThrow('写下');
});
it('the existing chat archive preserves the complete inline message through reload', () => {
  const content=`把${t(2110)}的颜色用于${t(2109)}`;
  expect(normalizeChatMessages([{id:'inline',role:'user',content,timestamp:1}],[])[0].content).toBe(content);
});

it('recognizes the user’s existing cloud/tree adjustment wording as an edit requiring a quote', () => {
  expect(compileInlineChatDraft(`${t(2110)}这张图最后几个云还是蓝色的，你需要调一下，还有就是我希望云的部分再多一点。还有这个树太整齐了，我希望他乱一点。`,images).edit).toBe(true);
});

it('continues the current image with the exact follow-up wording, preserving explicit references',()=>{
  const text='OK，我觉得云层亮部的颜色可以更白一点,森林的颜色，我希望更嫩一点。整体的饱和度提高一点点';
  expect(continueInlineImageEdit(text,2110,images)).toBe(`${t(2110)} ${text}`);
  expect(continueInlineImageEdit(text,2109,images)).toBe(`${t(2109)} ${text}`);
  for(const value of [`${t(2109)} ${text}`,'调整第02镜','修改首帧','调整选区','哪个更好？','不要改图']) expect(continueInlineImageEdit(value,2110,images)).toBe(value);
  expect(continueInlineImageEdit(text,2110,images,true)).toBe(text);
});

it('quotes the two failed combine requests using exactly the ordered warehouse images', async()=>{
  const {referenceWarehouseSelection}=await import('./inlineChatDraft');
  const selected=[2118,2117];const available=selected.map(imageId=>({imageId,imageUrl:`/${imageId}`,label:`#${imageId}`}));
  for(const text of ['这个有点过了，他们两张图综合一下','这两张图的颜色综合一下']) {
    const draft=compileInlineChatDraft(referenceWarehouseSelection(text,selected),available);
    expect(draft.edit).toBe(true);expect(draft.refs.map(i=>i.imageId)).toEqual(selected);expect(draft.instruction).toContain(text);
  }
  const explicit=`${t(2109)}综合一下`;
  expect(referenceWarehouseSelection(explicit,selected)).toBe(explicit);
  expect(()=>referenceWarehouseSelection('这两张图的颜色综合一下',[])).toThrow('请在仓库');
  expect(()=>referenceWarehouseSelection('这些图综合一下',[1,2,3,4,5])).toThrow('最多引用4张');
  for(const text of ['第03镜生成两张图','这两张图生成视频','背景音乐更小一点','继续改这张图','把那张图调亮']) {
    expect(referenceWarehouseSelection(text,selected)).toBe(text);
    expect(referenceWarehouseSelection(text,[])).toBe(text);
  }
  for(const text of ['这两张图哪个更好？','不要综合这两张图','不要混合这两张图']) expect(compileInlineChatDraft(referenceWarehouseSelection(text,selected),available).edit).toBe(false);
});

it('keeps a cited scope decision in its own review and preserves ordinary or multi-image edits', () => {
  const review = { phase: 'review', frames: [{ imageId: 2109 }], tasks: [] } as unknown as import('@shared/frameRegionReview').FrameRegionReview;
  expect(selectedRegionReply(t(2109) + ' 确认范围', 2109, review)).toBe('确认范围');
  for (const request of [t(2110) + ' 确认范围', t(2110) + t(2109) + ' 确认范围', t(2109) + ' 调整饱和度'])
    expect(selectedRegionReply(request, 2109, review)).toBeNull();
});
