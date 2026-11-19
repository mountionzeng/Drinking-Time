import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({pending:vi.fn(),propose:vi.fn(),quote:vi.fn(),recover:vi.fn(),render:vi.fn(),state:{activeStoryId:7,storyScopeEpoch:1,storyShots:[{shotNo:3,stableShotId:"s3"}],messages:[] as any[],setMessages:vi.fn()}}));
vi.mock("@/lib/trpc",()=>({trpc:{storyAgent:{proposeShotContentEdit:{useMutation:()=>({mutateAsync:m.propose})},recoverStoryboardImage:{useMutation:()=>({mutateAsync:m.recover})}},useUtils:()=>({storyAgent:{pendingStoryboardImages:{fetch:m.pending},visualUnderstanding:{quote:{fetch:m.quote}}}})}}));
vi.mock("@/features/uiLanguage/UiLanguage",()=>({useUiLanguage:()=>({language:"zh"})}));
vi.mock("./spine/storySpine",()=>({storySpineStore:{getState:()=>m.state}}));
import { mergeContentEdits,useShotContentChat } from "./useShotContentChat";
import { parseShotContentEdits } from "@shared/shotContentEdit";
const proposal=()=>({stableShotId:"s3",shotNo:3,images:[1,2,3].map(imageId=>({imageId,imageUrl:`/${imageId}`})),proposals:[1,2].map((imageId,index)=>({imageId,instruction:index?"云层更厚；其他不变":"森林更多树种；其他不变",clauses:parseShotContentEdits(index?"云层更厚":"森林更多树种")!,confidence:"low",reasons:[],alternatives:[3]}))});
function setup(selection?: Parameters<typeof useShotContentChat>[0]["selection"]){let api!:ReturnType<typeof useShotContentChat>;function Host(){api=useShotContentChat({storyId:7,selection,render:m.render});return null;}renderToStaticMarkup(<Host/>);return api;}
beforeEach(()=>{vi.stubGlobal("React",React);vi.clearAllMocks();m.state.messages=[];m.pending.mockResolvedValue([]);m.state.activeStoryId=7;m.propose.mockResolvedValue(proposal());m.quote.mockResolvedValue({estimatedCny:0.01,fingerprint:"same"});m.render.mockResolvedValue({status:"success"});});

it("keeps every clause on the explicitly selected image and waits for new approval", async () => {
 const text="这张图最后几个云还是蓝色的，你需要调一下，还有就是我希望云的部分再多一点。还有这个树太整齐了，我希望他乱一点。";
 const selection={sourceType:"storyboard-image" as const,storyId:7,stableShotId:"s3",shotNo:3,imageId:2110};
 const result=proposal();result.proposals=[{...result.proposals[0],imageId:2110}];m.propose.mockResolvedValue(result);
 const api=setup(selection);await api.handle(text);
 expect(m.propose).toHaveBeenCalledWith({storyId:7,stableShotId:"s3",text:`修改第3镜图片 #2110：${text}`});
 expect(m.quote).toHaveBeenCalledTimes(1);expect(m.quote).toHaveBeenCalledWith(expect.objectContaining({imageId:2110,instruction:text}));
 expect(m.render).not.toHaveBeenCalled();
 const messages=m.state.setMessages.mock.calls.flatMap(([update])=>update([]));
 expect(messages.at(-1).content).toContain("尚未开始改图");expect(messages.at(-1).content).toContain("回复“确认”接受本次费用，或“取消”");
 selection.imageId=2111;await api.handle("确认");await Promise.resolve();
 expect(m.render).not.toHaveBeenCalled();
});

it("rejects a mismatched target before quoting instead of silently editing another image", async () => {
 const api=setup({sourceType:"storyboard-image",storyId:7,stableShotId:"s3",shotNo:3,imageId:2110});
 await api.handle("这张图云层多一点，树木乱一点");
 expect(m.quote).not.toHaveBeenCalled();expect(m.render).not.toHaveBeenCalled();
 const messages=m.state.setMessages.mock.calls.flatMap(([update])=>update([]));
 expect(messages.at(-1).content).toContain("选图与报价目标不一致");
});

it("offers the original request after refresh without reviving the old quote", async () => {
 m.state.messages=[{role:"user",content:"这张图云层多一点"},{role:"assistant",content:"待确认，刷新后需重新核对报价。",selectionQuote:{storyId:7}}];
 const api=setup();expect(api.statusMessage).toContain("历史报价不可直接确认");expect(api.resumeInstruction).toBe("这张图云层多一点");
 expect(await api.handle("确认")).toBe(false);expect(m.render).not.toHaveBeenCalled();expect(m.quote).not.toHaveBeenCalled();
});
it("quotes all images once, cancellation invokes neither renderer nor recovery",async()=>{
 const api=setup();expect(await api.handle("第3镜森林更多树种，云层更厚")).toBe(true);
 expect(m.quote).toHaveBeenCalledTimes(2);expect(m.render).not.toHaveBeenCalled();
 await api.handle("取消");expect(m.render).not.toHaveBeenCalled();expect(m.recover).not.toHaveBeenCalled();
 expect(await api.handle("确认")).toBe(false);
});
it("stops the batch after the first failed image instead of purchasing the next",async()=>{
 m.render.mockResolvedValue({status:"error",message:"provider failed"});const api=setup();
 await api.handle("第3镜森林更多树种，云层更厚");await api.handle("确认");
 await vi.waitFor(()=>expect(m.render).toHaveBeenCalledTimes(1));
 expect(m.render.mock.calls[0][0]).toMatchObject({preconfirmed:true,readingQuote:{fingerprint:"same"},imageId:1});
});
it("rejects an expired quote before paying and ignores late findings after switching stories",async()=>{
 const api=setup();await api.handle("第3镜森林更多树种，云层更厚");m.quote.mockResolvedValue({estimatedCny:0.04,fingerprint:"new"});await api.handle("确认");
 await vi.waitFor(()=>expect(m.quote).toHaveBeenCalledTimes(3));expect(m.render).not.toHaveBeenCalled();
 m.state.activeStoryId=8;expect(await api.handle("确认")).toBe(false);
});
it("merges multiple edits assigned to one image before quoting it again",async()=>{
 const api=setup();await api.handle("第3镜森林更多树种，云层更厚");await api.handle("云层用图片 #1");
 expect(m.quote).toHaveBeenCalledTimes(3);
 expect(m.quote.mock.calls[2][0].instruction).toContain("森林更多树种");expect(m.quote.mock.calls[2][0].instruction).toContain("云层更厚");
 const source=proposal().proposals;source[1].imageId=1;expect(mergeContentEdits(source as any)).toHaveLength(1);expect(source[0].instruction).not.toContain("云层");
});
it("recovers the exact accepted receipt and halts after its failure",async()=>{
 m.render.mockResolvedValue({status:"success",requestId:"receipt-1"});m.recover.mockResolvedValue({status:"error",error:"failed"});const api=setup();
 await api.handle("第3镜森林更多树种，云层更厚");await api.handle("确认");
 await vi.waitFor(()=>expect(m.recover).toHaveBeenCalledWith({storyId:7,requestId:"receipt-1"}));expect(m.render).toHaveBeenCalledTimes(1);
});

it("cancels while finding and ignores the late proposal",async()=>{
 let finish!:(value:ReturnType<typeof proposal>)=>void;
 m.propose.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
 const api=setup();const pending=api.handle("第3镜森林更多树种，云层更厚");
 expect(await api.handle("取消")).toBe(true);finish(proposal());await pending;
 expect(m.quote).not.toHaveBeenCalled();expect(m.render).not.toHaveBeenCalled();
});
it("does not submit after a late quote if the user cancels",async()=>{
 const api=setup();await api.handle("第3镜森林更多树种，云层更厚");
 let finish!:(value:unknown)=>void;m.quote.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
 await api.handle("确认");await api.handle("取消");finish({estimatedCny:0.01,fingerprint:"same"});
 await vi.waitFor(()=>expect(m.state.setMessages).toHaveBeenCalled());
 expect(m.render).not.toHaveBeenCalled();
});
it("quotes the pinned image without heuristics or purchasing before confirmation",async()=>{
 const api=setup();await api.proposeFrame({storyId:7,stableShotId:"s3",shotNo:3,imageId:999,imageUrl:"/api/images/ref.png",timelineFrame:90,sourceTimeSec:3,shotTimeSec:3,origin:"paused-preview",timelineVersion:16},"这一帧更细腻，其余不变");
 expect(m.propose).not.toHaveBeenCalled();expect(m.quote).toHaveBeenCalledWith(expect.objectContaining({imageId:999,instruction:"这一帧更细腻，其余不变"}));expect(m.render).not.toHaveBeenCalled();await api.handle("取消");expect(m.render).not.toHaveBeenCalled();
});

it("routes an explicit image edit to a quote without requiring a selected thumbnail",async()=>{
 const api=setup();const text="修改第03镜图片 #2046，只让色彩更细腻，明暗不变";
 expect(await api.handle(text)).toBe(true);
 expect(m.propose).toHaveBeenCalledWith({storyId:7,stableShotId:"s3",text});
 expect(m.render).not.toHaveBeenCalled();
});
it("reports reused analysis without charging it again or starting generation", async () => {
  m.quote.mockResolvedValue({ estimatedCny: 0, fingerprint: "cached", cached: true });
  const api = setup();
  await api.handle("第3镜森林更多树种，云层更厚");
  const messages = m.state.setMessages.mock.calls.flatMap(([update]) => update([]));
  expect(messages.at(-1)?.content).toContain("已复用 2 张图的读图与美术提示词");
  expect(messages.at(-1)?.content).toContain("3.24 算力");
  expect(m.render).not.toHaveBeenCalled();
  await api.handle("取消");
});
it("quotes one GPT Image 2 edit with cached reading and sends it only after confirmation", async () => {
  const text = "修改第03镜图片 #2046，使用302 GPT Image 2原图编辑，颜色更细腻，其他不变。";
  const selected = proposal();
  selected.proposals = [{ ...selected.proposals[0], instruction: text }];
  m.propose.mockResolvedValue(selected);
  m.quote.mockResolvedValue({ estimatedCny: 0, fingerprint: "gpt-cached", cached: true });
  const api = setup();
  await api.handle(text);
  const messages = m.state.setMessages.mock.calls.flatMap(([update]) => update([]));
  expect(messages.at(-1)?.content).toContain("2.86 算力");
  expect(m.render).not.toHaveBeenCalled();
  await api.handle("确认");
  await vi.waitFor(() => expect(m.render).toHaveBeenCalledTimes(1));
  expect(m.render.mock.calls[0][0]).toMatchObject({ imageProvider: "gpt-image", instruction: text, readingQuote: { estimatedCny: 0 } });
});

it("quotes one cheaper FLUX Kontext Pro edit with cached reading and sends it only after confirmation", async () => {
  const text = "修改第03镜图片 #2046，使用302 FLUX Kontext Pro原图编辑，颜色更细腻，其他不变。";
  const selected = proposal();
  selected.proposals = [{ ...selected.proposals[0], instruction: text }];
  m.propose.mockResolvedValue(selected);
  m.quote.mockResolvedValue({ estimatedCny: 0, fingerprint: "gpt-cached", cached: true });
  const api = setup();
  await api.handle(text);
  const messages = m.state.setMessages.mock.calls.flatMap(([update]) => update([]));
  expect(messages.at(-1)?.content).toContain("0.54 算力");
  expect(m.render).not.toHaveBeenCalled();
  await api.handle("确认");
  await vi.waitFor(() => expect(m.render).toHaveBeenCalledTimes(1));
  expect(m.render.mock.calls[0][0]).toMatchObject({ imageProvider: "gpt-image", instruction: text, readingQuote: { estimatedCny: 0 } });
});

it("shows an unknown-request warning and carries its exact acknowledgement only after a fresh confirmation", async () => {
  m.pending.mockResolvedValue([{requestId:"old-unknown",shotIdentity:"s3",canContinue:true,recoverable:false}]);
  const api=setup();await api.handle("第3镜森林更多树种，云层更厚");
  const messages=m.state.setMessages.mock.calls.flatMap(([update])=>update([]));
  expect(messages.at(-1).content).toContain("另开一次付费任务");
  expect(m.render).not.toHaveBeenCalled();await api.handle("确认");
  await vi.waitFor(()=>expect(m.render).toHaveBeenCalled());
  expect(m.render.mock.calls[0][0]).toMatchObject({continueAfterUnknownRequestId:"old-unknown"});
});
it("blocks a new quote before any paid reading when an existing task is still active",async()=>{
  m.pending.mockResolvedValue([{requestId:"active",shotIdentity:"s3",canContinue:false,recoverable:true}]);
  const api=setup();await api.handle("第3镜森林更多树种");await api.handle("确认");
  expect(m.quote).not.toHaveBeenCalled();expect(m.render).not.toHaveBeenCalled();
});
