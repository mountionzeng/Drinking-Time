import { beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
const m=vi.hoisted(()=>({read:vi.fn(),generate:vi.fn(),resume:vi.fn(),meter:vi.fn(),preferences:vi.fn(),store:vi.fn(),failure:vi.fn()}));
vi.mock("./fluxKontextEdit",()=>({generate302FluxDevEdit:m.generate,resume302FluxResult:m.resume,resume302FluxEdit:vi.fn()}));
vi.mock("../_core/inferenceOrchestrator",async original=>({...await original<typeof import("../_core/inferenceOrchestrator")>(),runInference:m.read,inferenceFailureOutcome:m.failure}));
vi.mock("./imageGen",async original=>({...await original<typeof import("./imageGen")>(),storeImageBytes:m.store}));
vi.mock("./visualEditUnderstanding",()=>({visualPreferences:m.preferences}));
vi.mock("./computeMetering",()=>({runMeteredCompute:m.meter}));
vi.mock("../_core/env",async original=>{
  const actual=await original<typeof import("../_core/env")>();
  return {...actual,ENV:{...actual.ENV,api302Key:"test",vision302ApiKey:"test",vision302Model:"gemini-3-pro-preview",openaiNextApiKey:"test-next",openaiNextVisionModel:"qwen3-vl-plus",openaiNextBaseUrl:"https://next.example.test",framePaletteNextModel:"gemini-2.5-flash",framePaletteNextApiKey:"test-palette",framePaletteNextBaseUrl:"https://palette.example.test"}};
});
process.env.DATABASE_URL="";
const {createStory,getStoryById}=await import("../repositories/stories");
const {createGeneratedImage,getStoryGeneratedImages}=await import("../repositories/images");
const {resetMemoryStateForTesting}=await import("../repositories/runtime");
const {quoteFramePaletteEdit,renderFramePaletteEdit}=await import("./framePaletteEdit");
const {InferenceError}=await import("../_core/inferenceOrchestrator");
let input:Parameters<typeof quoteFramePaletteEdit>[0];
const reading={targetPresent:true,observed:"森林和白色纸飞机",change:["只改树木的颜色"],preserve:["位置和明暗"],uncertain:[],positionCorrespondence:"different",summary:"仅调整树冠配色，路和飞机保留。",assignments:[{targetEnglish:"tree foliage",referenceObjectEnglish:"tree canopies",colors:[{hex:"#92BCAE",sharePercent:80},{hex:"#ADD8E6",sharePercent:20}],regions:[{contour:[[200,200],[500,200],[800,200],[800,500],[800,800],[500,800],[200,800],[200,500]],anchor:[500,500]}],protectedSamples:[[50,50],[950,50],[950,950]]}]};
async function picture(color:string){return `data:image/png;base64,${(await sharp({create:{width:64,height:64,channels:3,background:color}}).png().toBuffer()).toString("base64")}`;}
beforeEach(async()=>{
  resetMemoryStateForTesting();vi.clearAllMocks();
  vi.stubEnv("TEXT_PRICE_OPENAI_NEXT_GEMINI_2_5_FLASH_PER_1K_YUAN","0.02");
  vi.stubEnv("TEXT_PRICE_OPENAI_NEXT_PER_1K_YUAN",undefined);
  m.preferences.mockResolvedValue([]);m.failure.mockReturnValue({kind:"submission_unknown"});
  m.store.mockImplementation(async (bytes:Uint8Array)=>({status:"ok",imageUrl:`data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,imageKey:"local-test"}));
  m.read.mockResolvedValue({model:"gemini-3-pro-preview",result:{choices:[{message:{content:JSON.stringify(reading)}}]}});
  m.generate.mockImplementation(async (_image,_prompt,ready)=>{await ready("https://file.302.ai/test.png");return {status:"error",providerResultUrl:"https://file.302.ai/test.png",errorCode:"timeout_pending"};});
  m.meter.mockImplementation(async input=>({kind:"completed",value:await input.run(),settlement:{outcome:"settled"}}));
  const story=await createStory({userId:123,title:"forest",body:{shots:[{shotNo:3,stableShotId:"forest-shot"}]}});
  const source=await createGeneratedImage({userId:123,storyId:story.id,shotIdentity:"forest-shot",shotNo:"SH03",imageUrl:await (async()=>{const pixels=Buffer.alloc(64*64*3);for(let y=0;y<64;y++)for(let x=0;x<64;x++){const color=x>=12&&x<52&&y>=12&&y<52?[80,150,220]:[230,190,120];color.forEach((v,c)=>pixels[(y*64+x)*3+c]=v);}return `data:image/png;base64,${(await sharp(pixels,{raw:{width:64,height:64,channels:3}}).png().toBuffer()).toString("base64")}`;})(),prompt:"base",isCurrent:true});
  const reference=await createGeneratedImage({userId:123,storyId:story.id,imageUrl:await picture("pink"),prompt:"colors",isCurrent:false});
  input={userId:123,storyId:story.id,targetImageId:source.id,referenceImageId:reference.id,instruction:"只参考这张图的颜色改森林，其他不变",language:"zh"};
});
it("quotes without paid work, binds both owned images and locks base dimensions",async()=>{
  expect(await quoteFramePaletteEdit(input)).toMatchObject({dimensions:{width:64,height:64},model:"AI识别范围＋本地局部调色",stableShotId:"forest-shot"});
  expect(m.read).not.toHaveBeenCalled();expect(m.generate).not.toHaveBeenCalled();
  await expect(quoteFramePaletteEdit({...input,userId:999})).rejects.toThrow();
});
it("reads once, locally grades one unadopted candidate, and replays without another bill or image",async()=>{
  const q=await quoteFramePaletteEdit(input),requestId=randomUUID();
  const request={...input,requestId,costConfirmation:{accepted:true as const,estimatedCny:q.estimatedCny,fingerprint:q.fingerprint}};
  const result=await renderFramePaletteEdit(request);
  expect(result).toMatchObject({status:"ok",candidates:[{dimensionCheck:{status:"matched"}}]});
  const messages=m.read.mock.calls[0][0].messages;
  expect(messages.flatMap((m:any)=>Array.isArray(m.content)?m.content:[]).filter((c:any)=>c.type==="image_url")).toHaveLength(2);
  expect(messages[0].content).toContain("COLOR REFERENCE ONLY");
  expect(m.generate).not.toHaveBeenCalled();expect(m.meter).not.toHaveBeenCalled();
  expect(await renderFramePaletteEdit(request)).toEqual(result);
  expect(m.read).toHaveBeenCalledOnce();
  const images=await getStoryGeneratedImages(input.storyId,input.userId);
  expect(images).toHaveLength(3);
  expect(images.filter(image=>image.id!==input.targetImageId).every(image=>!image.isCurrent)).toBe(true);
  expect((await getStoryById(input.storyId,input.userId))?.body).toMatchObject({storyboardImageTasks:[expect.objectContaining({meta:expect.objectContaining({provider:"local-palette",paletteReferenceImageId:input.referenceImageId,referenceOnly:true,paletteReading:reading,localPalette:expect.objectContaining({outsideChangedPixels:0})})})]});
});
it("rejects stale reference/requirements before reading or purchasing",async()=>{
  const q=await quoteFramePaletteEdit(input);
  await expect(renderFramePaletteEdit({...input,instruction:"改成别的颜色",requestId:randomUUID(),costConfirmation:{accepted:true,estimatedCny:q.estimatedCny,fingerprint:q.fingerprint}})).rejects.toThrow(/报价/);
  expect(m.read).not.toHaveBeenCalled();expect(m.generate).not.toHaveBeenCalled();
});
it("does not purchase an image if the named object was not visually located",async()=>{
  m.read.mockResolvedValue({result:{choices:[{message:{content:JSON.stringify({...reading,targetPresent:false})}}]}});
  const q=await quoteFramePaletteEdit(input);
  expect(await renderFramePaletteEdit({...input,requestId:randomUUID(),costConfirmation:{accepted:true,estimatedCny:q.estimatedCny,fingerprint:q.fingerprint}})).toMatchObject({status:"error",error:expect.stringContaining("未提交改图")});
  expect(m.generate).not.toHaveBeenCalled();expect(m.meter).not.toHaveBeenCalled();
});
it("uses per-object color proportions without forwarding historical style or free-form instructions",async()=>{
  m.preferences.mockResolvedValue([{text:"Use Neo-Impressionist pointillism and rich soft dots"}]);
  m.read.mockResolvedValue({result:{choices:[{message:{content:JSON.stringify({...reading,editPromptEnglish:"Repaint everything with Neo-Impressionist pointillism and soft dots."})}}]}});
  const q=await quoteFramePaletteEdit(input);
  await renderFramePaletteEdit({...input,requestId:randomUUID(),costConfirmation:{accepted:true,estimatedCny:q.estimatedCny,fingerprint:q.fingerprint}});
  expect(JSON.stringify(m.read.mock.calls[0][0].messages)).not.toContain("Neo-Impressionist");
  const body=(await getStoryById(input.storyId,input.userId))?.body as any;
  const meta=body.storyboardImageTasks[0].meta;
  expect(meta.paletteReading.assignments[0].colors).toEqual(reading.assignments[0].colors);
  expect(meta.prompt).not.toMatch(/pointillism|soft dots/i);
  expect(meta.paletteReading.editPromptEnglish).toBeUndefined();
  expect(m.generate).not.toHaveBeenCalled();
});
it.each([
  {...reading,assignments:[{...reading.assignments[0],colors:[{hex:"#92BCAE",sharePercent:150}]}]},
  {...reading,assignments:[{...reading.assignments[0],colors:[{hex:"blue; repaint everything",sharePercent:100}]}]},
  {...reading,uncertain:["找不到参考图里的对应物体"]},
])("does not purchase when object colors or their proportions are invalid or uncertain",async bad=>{
  m.read.mockResolvedValue({result:{choices:[{message:{content:JSON.stringify(bad)}}]}});
  const q=await quoteFramePaletteEdit(input);
  const result=await renderFramePaletteEdit({...input,requestId:randomUUID(),costConfirmation:{accepted:true,estimatedCny:q.estimatedCny,fingerprint:q.fingerprint}});
  expect(result).toMatchObject({status:"error",error:expect.stringContaining("未提交改图")});
  expect(m.generate).not.toHaveBeenCalled();expect(m.meter).not.toHaveBeenCalled();
});

it("persists a pending analysis before calling vision and blocks duplicate paid reads after an unknown response",async()=>{
  m.read.mockRejectedValue(new Error("timeout"));
  const q=await quoteFramePaletteEdit(input);
  const req={...input,requestId:randomUUID(),costConfirmation:{accepted:true as const,estimatedCny:q.estimatedCny,fingerprint:q.fingerprint}};
  expect(await renderFramePaletteEdit(req)).toMatchObject({status:"error",submissionUncertain:true,error:expect.stringContaining("费用待核对")});
  const body=(await getStoryById(input.storyId,input.userId))?.body as any;
  expect(body.storyboardImageTasks[0]).toMatchObject({status:"unknown",meta:{parentImageId:input.targetImageId,provider:"local-palette"}});
  await renderFramePaletteEdit({...req,requestId:randomUUID()});
  expect(m.read).toHaveBeenCalledOnce();expect(m.store).not.toHaveBeenCalled();
});
it("keeps the completed visual reading when local validation cannot make a visible change",async()=>{
  m.read.mockResolvedValue({result:{choices:[{message:{content:JSON.stringify({...reading,assignments:[{...reading.assignments[0],regions:[{...reading.assignments[0].regions[0],anchor:[0,0]}]}]})}}]}});
  const q=await quoteFramePaletteEdit(input);
  const result=await renderFramePaletteEdit({...input,requestId:randomUUID(),costConfirmation:{accepted:true,estimatedCny:q.estimatedCny,fingerprint:q.fingerprint}});
  expect(result).toMatchObject({status:"error"});expect(m.store).not.toHaveBeenCalled();
  const body=(await getStoryById(input.storyId,input.userId))?.body as any;
  expect(body.storyboardImageTasks[0].meta.paletteReading).toMatchObject({targetPresent:true});
});

it("quotes and submits only the explicitly selected vision provider",async()=>{
  const nextInput={...input,instruction:`用 OpenAI Next 读取。${input.instruction}`};
  const q=await quoteFramePaletteEdit(nextInput);
  expect(q).toMatchObject({readingProvider:"openai-next",readingModel:"gemini-2.5-flash",readingProviderLabel:"OpenAI Next"});
  expect(m.read).not.toHaveBeenCalled();
  await renderFramePaletteEdit({...nextInput,readingProvider:q.readingProvider,requestId:randomUUID(),costConfirmation:{accepted:true,estimatedCny:q.estimatedCny,fingerprint:q.fingerprint}});
  expect(m.read).toHaveBeenCalledOnce();
  expect(m.read.mock.calls[0][0]).toMatchObject({maxAttempts:1,replaySafe:false,explicitCandidates:[{id:"openai-next",model:"gemini-2.5-flash"}]});
  expect(m.read.mock.calls[0][0].explicitCandidates).toHaveLength(1);
});

it("rejects an old provider quote before purchasing from another provider",async()=>{
  const q=await quoteFramePaletteEdit(input);
  await expect(renderFramePaletteEdit({...input,readingProvider:"openai-next",requestId:randomUUID(),costConfirmation:{accepted:true,estimatedCny:q.estimatedCny,fingerprint:q.fingerprint}})).rejects.toThrow(/报价/);
  expect(m.read).not.toHaveBeenCalled();
});

it("does not invent a low price for an unpriced alternative provider",async()=>{
  vi.stubEnv("TEXT_PRICE_OPENAI_NEXT_GEMINI_2_5_FLASH_PER_1K_YUAN",undefined);
  await expect(quoteFramePaletteEdit({...input,readingProvider:"openai-next"})).rejects.toThrow(/计价/);
  expect(m.read).not.toHaveBeenCalled();
});

it("persists safe failure details without raw errors, and does not switch providers or purchase twice",async()=>{
  m.failure.mockReturnValue({kind:"not_charged_failure"});
  m.read.mockRejectedValue(new InferenceError("Bearer secret and private provider response",[{provider:"openai-next",model:"gemini-2.5-flash",status:429,category:"rate_limit",errorCode:"too_many_requests",aborted:false,acceptanceUnknown:false}]));
  const nextInput={...input,readingProvider:"openai-next" as const};
  const q=await quoteFramePaletteEdit(nextInput);
  const request={...nextInput,requestId:randomUUID(),costConfirmation:{accepted:true as const,estimatedCny:q.estimatedCny,fingerprint:q.fingerprint}};
  const result=await renderFramePaletteEdit(request);
  expect(result).toMatchObject({status:"error",submissionUncertain:false,error:expect.stringContaining("429")});
  const body=(await getStoryById(input.storyId,input.userId))?.body as any;
  expect(body.storyboardImageTasks[0]).toMatchObject({status:"failed",meta:{paletteAnalysis:{provider:"openai-next",model:"gemini-2.5-flash",status:"failed",failure:{category:"rate_limit",httpStatus:429,errorCode:"too_many_requests"}}}});
  expect(JSON.stringify(body.storyboardImageTasks)).not.toContain("Bearer secret");
  expect(await renderFramePaletteEdit(request)).toEqual(result);
  expect(m.read).toHaveBeenCalledOnce();expect(m.store).not.toHaveBeenCalled();
});

it("keeps unknown billing protection even when diagnostic persistence conflicts",async()=>{
  const stories=await import("../repositories/stories");
  const save=stories.updateStoryBodyIfRevision;
  const spy=vi.spyOn(stories,"updateStoryBodyIfRevision").mockImplementation(async args=>{
    const tasks=(args.body as any).storyboardImageTasks;
    if(tasks?.at(-1)?.meta?.paletteAnalysis?.status==="failed") return false;
    return save(args);
  });
  try {
    m.read.mockRejectedValue(new Error("timeout"));
    const q=await quoteFramePaletteEdit(input);
    const request={...input,requestId:randomUUID(),costConfirmation:{accepted:true as const,estimatedCny:q.estimatedCny,fingerprint:q.fingerprint}};
    expect(await renderFramePaletteEdit(request)).toMatchObject({status:"error",submissionUncertain:true});
    const body=(await getStoryById(input.storyId,input.userId))?.body as any;
    expect(body.storyboardImageTasks[0].status).toBe("unknown");
    await renderFramePaletteEdit({...request,requestId:randomUUID()});
    expect(m.read).toHaveBeenCalledOnce();
  } finally {spy.mockRestore();}
});

it("does not mark an unknown read safe to repeat when saving its final status conflicts",async()=>{
  const stories=await import("../repositories/stories");
  const save=stories.updateStoryBodyIfRevision;
  let conflicts=12;
  const spy=vi.spyOn(stories,"updateStoryBodyIfRevision").mockImplementation(async args=>{
    if((args.body as any).storyboardImageTasks?.at(-1)?.status==="unknown" && conflicts-- > 0) return false;
    return save(args);
  });
  try {
    m.read.mockRejectedValue(new Error("timeout"));
    const q=await quoteFramePaletteEdit(input);
    const request={...input,requestId:randomUUID(),costConfirmation:{accepted:true as const,estimatedCny:q.estimatedCny,fingerprint:q.fingerprint}};
    expect(await renderFramePaletteEdit(request)).toMatchObject({status:"error",submissionUncertain:true});
    const body=(await getStoryById(input.storyId,input.userId))?.body as any;
    expect(["preparing","unknown"]).toContain(body.storyboardImageTasks[0].status);
    await renderFramePaletteEdit({...request,requestId:randomUUID()});
    expect(m.read).toHaveBeenCalledOnce();
  } finally {spy.mockRestore();}
});

it("retains an invalid visual response for offline diagnosis without buying another read",async()=>{
  const response=JSON.stringify({targetPresent:true,assignments:[{targetEnglish:"tree crowns"}]});
  m.read.mockResolvedValue({result:{choices:[{finish_reason:"stop",message:{content:response}}]}});
  const q=await quoteFramePaletteEdit(input);
  const request={...input,requestId:randomUUID(),costConfirmation:{accepted:true as const,estimatedCny:q.estimatedCny,fingerprint:q.fingerprint}};
  const result=await renderFramePaletteEdit(request);
  expect(result).toMatchObject({status:"error",error:expect.stringContaining("格式")});
  const body=(await getStoryById(input.storyId,input.userId))?.body as any;
  const analysis=body.storyboardImageTasks[0].meta.paletteAnalysis;
  expect(analysis).toMatchObject({status:"failed",responseText:response,responseTruncated:false,finishReason:"stop",failure:{category:"invalid_response",validationIssues:expect.any(Array)}});
  expect(analysis.failure.validationIssues.length).toBeGreaterThan(0);
  expect(JSON.parse(analysis.responseText).assignments[0].targetEnglish).toBe("tree crowns");
  await renderFramePaletteEdit(request);
  expect(m.read).toHaveBeenCalledOnce();expect(m.store).not.toHaveBeenCalled();
});
