import { expect,it } from "vitest";
import { prepareKeyframeScan,scannedEditPlan } from "./keyframeRegionScan";
import { inlineImageToken } from "@shared/inlineChatImages";
import { chatImageEditPlanSchema,imageEditPlanError,imageEditPlanOutput,imageEditPlanQuote } from "@shared/chatImageEditPlan";
import type { ChatMessage } from "./types";
const selectionQuote={sourceType:"shot" as const,sourceId:"s5",storyId:7,stableShotId:"s5",selectedText:"第五镜"};
const board:ChatMessage={id:"saved-photos:test",role:"assistant",timestamp:1,selectionQuote,content:"关键帧修订稿（5 张） "+[1,2,3,4,5].map(inlineImageToken).join(" ")};
const coords={left:.1,top:.2,right:.3,bottom:.4};
const citation=inlineImageToken(5)+" 〔选区 x 10%–30%, y 20%–40% · 文字「Library」〕 ";
it("automatically checks just the source's current board when a circled object is rejected",()=>{
 const plan=prepareKeyframeScan(citation+"我不想要这个东西",[board],7);
 expect(plan).toMatchObject({ids:[1,2,3,4,5],imageId:5,region:coords,instruction:"我不想要这个东西"});
 expect(prepareKeyframeScan(citation+"只改这张，不要有这段文字",[board],7)).toBeNull();
 expect(prepareKeyframeScan(citation+"这是什么？",[board],7)).toBeNull();
 expect(prepareKeyframeScan(citation+"不要有具体的文字",[board],8)).toBeNull();
 expect(()=>prepareKeyframeScan("另外四张有没有同样的问题",[board],7)).toThrow("先在一张");
 const newBoard={...board,id:"saved-photos:new",content:"关键帧修订稿 "+[6,7].map(inlineImageToken).join(" ")};
 expect(()=>prepareKeyframeScan(citation+"另外四张也检查同样的问题",[board,newBoard],7)).toThrow("旧版");
});
it("uses each match's location, charges only checked images, and retains misses as omissions",()=>{
 const req=prepareKeyframeScan(citation+"不要有这种具体的文字",[board],7)!;
 const other={left:.6,right:.9,top:.05,bottom:.1};
 const plan=scannedEditPlan(req,[{imageId:1,status:"not-found",detail:"未检出"},{imageId:2,status:"review",detail:"需核对"},
  {imageId:3,status:"matched",region:other,detail:"Library"},{imageId:4,status:"review",detail:"需核对"},
  {imageId:5,status:"source",region:coords,detail:"Library"}],[1,2,3,4,5].map(i=>({imageId:i,imageUrl:"/"+i,label:"#"+i})));
 expect(imageEditPlanError(plan)).toBeNull();expect(imageEditPlanQuote(plan).tasks).toBe(2);
 const item=imageEditPlanOutput({...plan,status:"submitted"},3,1);
 expect(item.refs.map(i=>i.imageId)).toEqual([3]);expect(item.instruction).toContain("x 60%–90%");
 plan.images[2].role="omit";expect(imageEditPlanQuote(plan).tasks).toBe(1);
 plan.images[1].role="target";expect(imageEditPlanError(plan)).toBeTruthy();
 for (const image of plan.images) image.role="omit";
 expect(chatImageEditPlanSchema.parse(plan)).toEqual(plan);
 expect(imageEditPlanQuote(plan).candidates).toBe(0);
 expect(imageEditPlanError(plan)).toContain("请选择至少一张");
 expect(chatImageEditPlanSchema.safeParse({...plan,status:"submitted"}).success).toBe(false);
});

it("keeps the other frames in their original slots when a partial repair completes",async()=>{
 const {collectKeyframeReview}=await import("./keyframeReview");
 const req=prepareKeyframeScan(citation+"我不想要这个东西",[board],7)!;
 const rows=req.ids.map(imageId=>({imageId,status:imageId===5?"source" as const:imageId===3?"matched" as const:"review" as const,
    region:imageId===5 || imageId===3?coords:undefined,detail:"example"}));
 const plan=scannedEditPlan(req,rows,req.ids.map(imageId=>({imageId,imageUrl:"/"+imageId,label:"#"+imageId})));plan.status="submitted";
 const confirmed={...board,id:"confirm",imageEditPlan:plan};
 const result=collectKeyframeReview([board,confirmed],{storyId:7,stableShotId:"s5",planMessageId:"confirm",
   items:[{imageId:5,status:"done",result:{imageId:105}},{imageId:3,status:"done",result:{imageId:103}}]} as Parameters<typeof collectKeyframeReview>[1],123);
 expect(result.at(-1)?.content).toMatch(/关键帧修订稿（5 张）/);
 expect(result.at(-1)?.content.match(/image%3A(\d+)/g)).toEqual([1,2,103,4,105].map(id=>"image%3A"+id));
 expect(result[0]).toBe(board);
});
