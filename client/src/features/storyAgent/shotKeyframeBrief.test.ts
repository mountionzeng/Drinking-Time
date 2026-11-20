import { describe, expect, it } from "vitest";
import { imageEditPlanOutput } from "@shared/chatImageEditPlan";
import { inlineImageToken as token } from "@shared/inlineChatImages";
import { keyframeChatTurns, openKeyframeReview, orderedKeyframeRefs, reviewedKeyframeTarget, shotKeyframeBeats } from "./shotKeyframeBrief";
import type { ChatMessage } from "./types";
const quote = {storyId:12,stableShotId:"shot5",sourceId:"shot5",shotNo:5,sourceType:"shot" as const,selectedText:"05",fullText:"05"};
const images = Array.from({length:4},(_,i)=>({imageId:i+11,imageUrl:"/image"+i,label:"截图"+(i+1)}));
const brief = "先特写电脑的界面，是一个比较大的纸质的邮箱logo，咱们的另外一个小茶杯，从这个纸质的邮箱信封里面钻出来。然后展示这个第二张截图的界面，第三/4张截图的功能";
const board:ChatMessage = {id:"saved-photos:board",role:"assistant",selectionQuote:quote,timestamp:1,content:"关键帧初稿\n"+images.map(i=>token(i.imageId)).join(" ")};
describe("shot idea keyframes",()=>{
 it("keeps five distinct beats, references, and the full direction through the existing paid contract",()=>{
   const beats=shotKeyframeBeats(brief)!;
   expect(beats).toHaveLength(5);
   expect(beats[0]).toContain("纸质");expect(beats[1]).toContain("钻出来");
   const turns=keyframeChatTurns(brief,beats,images,quote);
   expect(turns[0].content).toContain(brief);expect(turns.map(t=>t.selectionQuote)).toEqual(Array(6).fill(quote));
   expect(turns.slice(1).every(t=>t.imageEditPlan?.status==="draft")).toBe(true);
   expect(turns[1].imageEditPlan?.images.every(i=>i.role==="undecided")).toBe(true);
   const output=imageEditPlanOutput({...turns[5].imageEditPlan!,status:"submitted"},14,1);
   expect(output.refs.map(r=>r.imageId)).toEqual([14,11,12,13]);expect(output.instruction).toContain("第 5 帧");expect(output.instruction).toContain(brief);
 });
 it.each(["抽取3张关键帧","先不要生成关键帧","第03镜生成视频","这两张图分别调亮","先打开仓库然后导出视频","查看第 05 镜的关键帧"])("leaves other actions alone: %s",s=>expect(shotKeyframeBeats(s)).toBeNull());
 it("binds numbered feedback and free review to the actual same-shot gallery",()=>{
   expect(openKeyframeReview("查看第05镜的关键帧",[board],quote)?.id).toBe(board.id);
   expect(reviewedKeyframeTarget("第2张杯子再高一点",[board],quote,images)?.imageId).toBe(12);
   expect(reviewedKeyframeTarget("第2张杯子再高一点",[board],{...quote,stableShotId:"x"},images)).toBeNull();
   expect(reviewedKeyframeTarget("第2张修改、第3张也修改",[board],quote,images)).toBeNull();
   expect(()=>reviewedKeyframeTarget("第5张杯子再高一点",[board],quote,images)).toThrow();
 });
 it("keeps attachment identities ordered, and refuses missing references",()=>{
   expect(orderedKeyframeRefs(token(12)+token(11),images,[images[1],images[2]]).map(r=>r.imageId)).toEqual([12,11,13]);
   expect(()=>orderedKeyframeRefs(token(777),images,[])).toThrow();
   expect(()=>keyframeChatTurns(brief,shotKeyframeBeats(brief)!,images.slice(0,2),quote)).toThrow();
 });
});

import { collectKeyframeReview } from "./keyframeReview";
import { keyframeApproval } from "./shotKeyframeBrief";
import type { ImageEditBatch } from "../../../../server/services/chatImageEditBatch";
it("only offers video planning after explicit visual approval",()=>{
 expect(keyframeApproval("这组关键帧我都满意",[board],quote)).toContain("逐秒视频方案");
 expect(keyframeApproval("第2张认可",[board],quote)).toContain("#12");
 expect(keyframeApproval("第2张认可，但需要改颜色",[board],quote)).toBeNull();
 expect(keyframeApproval("好的",[board],quote)).toBeNull();
});
it("collects real candidate receipts in beat order, deduplicates replays and keeps shots isolated",()=>{
 const plan=keyframeChatTurns("先特写书，然后展示图二",["书","展示图二"],images,quote);
 const receipt=(i:number):ImageEditBatch=>({storyId:12,shotNo:5,stableShotId:"shot5",planMessageId:"image-edit-confirmed:"+plan[i+1].id,unitEstimatedCny:1,remainingEstimatedCny:0,
   items:[{imageId:11,copy:1,requestId:"rq"+i,imageUrl:"/base",status:"done",result:{imageId:51+i,imageUrl:"/new"+i},request:{referenceImageUrl:"/base",referenceContextImageUrls:[],explicitInstruction:"test",prompt:"test"}}]});
 const half=collectKeyframeReview(plan,receipt(1),20);
 expect(half.at(-1)?.content).toContain(token(52)); expect(half.at(-1)?.content).not.toContain("初稿");
 const done=collectKeyframeReview(half,receipt(0),21);
 const gallery=done.at(-1)!;
 expect(gallery.content.indexOf(token(51))).toBeLessThan(gallery.content.indexOf(token(52)));
 expect(collectKeyframeReview(done,receipt(1),22)).toBe(done);
 expect(collectKeyframeReview(plan,{...receipt(0),stableShotId:"other"},23)).toBe(plan);
});
import { matchingKeyframeReview } from "./shotKeyframeBrief";
it("never offers to buy an already illustrated idea with identical source order",()=>{
 const original={...board,id:"u",role:"user" as const,content:brief+" "+images.map(r=>token(r.imageId)).join(" ")};
 const style={...original,id:"style",content:"背景淡绿"};
 expect(matchingKeyframeReview(brief,images,[original,style,board],quote)).toBe(board);
 expect(matchingKeyframeReview(brief,[...images].reverse(),[original,style,board],quote)).toBeNull();
 expect(matchingKeyframeReview(brief+"再加一本书",images,[original,style,board],quote)).toBeNull();
 expect(matchingKeyframeReview(brief,images,[original,style,board,{...style,id:"later"}],quote)).toBeNull();
});
