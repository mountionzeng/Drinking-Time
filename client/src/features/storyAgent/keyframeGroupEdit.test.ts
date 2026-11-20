import { expect, it } from "vitest";
import { inlineImageToken as token, inlineChatImageIds } from "@shared/inlineChatImages";
import { imageEditPlanQuote, imageEditPlanReply, confirmedImageEditPlanId, createChatImageEditPlan } from "@shared/chatImageEditPlan";
import { formatComputeQuote } from "@shared/computeMoney";
import { imageEditGenerationError } from "./imageEditPurchase";
import { collectKeyframeReview } from "./keyframeReview";
import { keyframeGroupEdit } from "./keyframeGroupEdit";
import type { ChatMessage } from "./types";
import type { ImageEditBatch } from "../../../../server/services/chatImageEditBatch";

const shot = {sourceType:"shot" as const, sourceId:"s5", stableShotId:"s5", storyId:1, shotNo:5, selectedText:"05", fullText:"05"};
const images = [11,12,13,14,15,99].map(imageId => ({imageId, imageUrl:"/img"+imageId, label:"#"+imageId}));
const board:ChatMessage = {id:"saved-photos:initial", role:"assistant", timestamp:1, selectionQuote:shot,
  content:"关键帧初稿（5 张）\n"+images.slice(0,5).map(i=>token(i.imageId)).join("\n")};
const request = "我觉得“边界太生硬”这种事情你应该直接避免，我的这个对话出来，你应该直接判断，5张图一起改";
const old = createChatImageEditPlan([images[5],images[1],images[0]],"参考图1（图片 #99），这两张电脑边界太生硬");
old.images.forEach((i,index)=>{i.role=index ? "target" : "reference"; i.purpose=index ? "保留纸信封" : "仅参考背景层次";});
old.preserve = "两张分别保留淡绿纸感和位置。";
const card:ChatMessage = {...board,id:"two",content:"报价",imageEditPlan:old};
const prepare = (text=request, rows=[board,card], library=images) => keyframeGroupEdit(text,rows,shot,library);
it("promotes two examples to five independent edits, carries explicit roles and replaces only the draft",()=>{
 const result=keyframeGroupEdit(request,[board,card],shot,images,12)!;
 expect(result.turns[0].content).toBe(request);
 const next=result.turns[1], plan=next.imageEditPlan!;
 expect(next.id).toBe("image-edit-adjusted:two"); expect(plan.status).toBe("draft");
 expect(plan.images.map(i=>[i.imageId,i.role,i.copies])).toEqual([[11,"target",1],[12,"target",1],[13,"target",1],[14,"target",1],[15,"target",1],[99,"reference",1]]);
 expect(plan.images[0].purpose).toContain("纸信封"); expect(plan.preserve).toContain("淡绿");
 expect(plan.changes).not.toContain("图1（"); expect(plan.changes).toContain("接触阴影");
 expect(imageEditGenerationError(plan)).toBeNull();
 expect(formatComputeQuote(imageEditPlanQuote(plan).totalCny)).toBe("14.30 算力");
 expect(prepare(request,[board,card,...result.turns])?.repeatId).toBe(next.id);
 expect(prepare(request,[board,card,{...card,id:confirmedImageEditPlanId(card.id),imageEditPlan:{...old,status:"submitted"}}])?.turns[1].id).not.toBe(next.id);
 expect(()=>inlineChatImageIds(imageEditPlanReply(plan))).toThrow("最多引用");
});
it("resolves a first shared background and edge critique from the current review",()=>{
 const first="整体的背景的丰富的程度参考（但它不好看，你需要再改改）"+token(99)+" ，这两张电脑边界太生硬了"+token(12)+" "+token(11);
 const plan=prepare(first,[board])!.turns[1].imageEditPlan!;
 expect(plan.images.filter(i=>i.role==="target")).toHaveLength(5);
 expect(plan.images.at(-1)).toMatchObject({imageId:99,role:"reference",purpose:expect.stringContaining("背景")});
});
it.each(["只改这两张的边界","把这一张的边缘调自然","第五张边界太生硬","不要把5张图一起改","这组可以一起改吗？","这些图全部采用","把这组图渲染视频","只改第2张，其余整组保留"])("leaves limited or unrelated intent alone: %s",text=>expect(prepare(text)).toBeNull());
it("uses the immediately visible board for a short art critique, and honors single-image and timeline context",()=>{
 expect(prepare("边界太生硬",[board])?.turns[1].imageEditPlan?.images).toHaveLength(5);
 expect(keyframeGroupEdit("边界太生硬",[board],shot,images,12)).toBeNull();
 expect(prepare("这张的边界太生硬",[board])).toBeNull();
 expect(prepare("边界太生硬",[board,{...card,imageEditPlan:undefined,content:"一张已选的画面"}])).toBeNull();
 expect(prepare("整组音乐都要调低",[board])).toBeNull();
});
it("requires evidence of the same board, count, all source files and an actual instruction",()=>{
 expect(()=>prepare("四张图一起改边缘")).toThrow("张数");
 expect(()=>prepare(request,[{...board,selectionQuote:{...shot,stableShotId:"s4"}}])).toThrow("本镜");
 expect(()=>prepare(request,[board,card],images.slice(1))).toThrow("#11");
 expect(()=>prepare("5张图一起改",[board])).toThrow("改哪里");
 expect(()=>prepare(request,[board,{...board,id:"saved-photos:new",content:"关键帧修订稿（5 张）"+token(11)}])).toThrow("张数");
});
it("publishes a single ordered gallery only after all five results exist",()=>{
 const chat=prepare()!.turns[1], confirmed={...chat,id:confirmedImageEditPlanId(chat.id),imageEditPlan:{...chat.imageEditPlan!,status:"submitted" as const}};
 const rows=[board,card,chat,confirmed];
 const items=images.slice(0,5).map(i=>({...i,copy:1,requestId:"r"+i.imageId,status:"done" as const,result:{imageId:i.imageId+20,imageUrl:i.imageUrl},request:{referenceImageUrl:i.imageUrl,referenceContextImageUrls:[],explicitInstruction:"精修",prompt:"精修"}}));
 const batch:ImageEditBatch={storyId:1,stableShotId:"s5",shotNo:5,unitEstimatedCny:1.43,remainingEstimatedCny:0,planMessageId:confirmed.id,items};
 expect(collectKeyframeReview(rows,{...batch,items:batch.items.map((i,n)=>n===1?{...i,status:"pending"}:i)},12)).toBe(rows);
 const done=collectKeyframeReview(rows,{...batch,items:batch.items.slice().reverse()},13);
 expect(done.at(-1)?.content).toContain("修订稿（5 张）");expect(done.at(-1)?.content.indexOf(token(31))).toBeLessThan(done.at(-1)!.content.indexOf(token(35)));
 expect(collectKeyframeReview(done,batch,14)).toBe(done);
});

it("records a standing source-reading request without starting or replacing an edit",()=>{
 const text="我希望你生成任何东西的时候，都需要先拿到画面本身的信息，分析他们的该怎么变化。避免「边界太生硬」这件事，";
 const note=prepare(text)!.turns;
 expect(note[0].content).toBe(text);expect(note[1].imageEditPlan).toBeUndefined();
 expect(note[1].content).toContain("先逐张读画面");
 expect(prepare(text,[board,card,...note])?.repeatId).toBe(note[1].id);
});

const delivery = "你至少需要再对话框识别我的需求，然后给我5张正确的图";
it("recognizes a request for the five revised images after the source-reading discussion", () => {
 const rows = [board, card, ...prepare()!.turns];
 rows.push(...prepare("我希望每次生成先读原图、分析画面", rows)!.turns);
 const turns = prepare(delivery, rows)!.turns;
 expect(turns[0].content).toBe(delivery);
 expect(turns[1].content).toContain("接触阴影");
 expect(turns[1].content).toContain("还没交回");
 expect(turns[1].imageEditPlan).toBeUndefined();
 expect(turns[1].id).not.toMatch(/^saved-photos:/);
 expect(() => prepare("给我四张正确的图", rows)).toThrow("张数");
 expect(prepare("不要给我5张正确的图", rows)).toBeNull();
 expect(prepare("给我五张新的海报", rows)).toBeNull();
 expect(prepare(delivery, [{...board, selectionQuote:{...shot,stableShotId:"other"}}])).toBeNull();
});
it("returns only the actual images of the latest completed revision, in board order", () => {
 const revised = {...board, id:"saved-photos:revision-current", content:"关键帧修订稿（5 张）\n" +
   [15,14,13,12,11].map((id,index) => (index+1) + "　画面" + index + "　" + token(id)).join("\n")};
 const recall = prepare("请发给我五张改好的图片", [board, revised])!.turns[1];
 expect(recall.id).toMatch(/^saved-photos:keyframe-recall:/);
 expect(recall.content.match(/\[\[ref:[^\]]+\]\]/g)).toEqual([15,14,13,12,11].map(token));
 expect(recall.imageEditPlan).toBeUndefined();
 const fresh = prepare("把背景调成蓝色，然后给我5张正确的图", [board, revised])!.turns[1];
 expect(fresh.imageEditPlan?.changes).toContain("蓝色");
 expect(fresh.id).not.toMatch(/^saved-photos:/);
 expect(prepare("我想画一段海边的新故事，然后给我5张图", [board, revised])).toBeNull();
 expect(prepare(delivery, [board])!.turns[1].id).not.toMatch(/^saved-photos:/);
 expect(() => prepare(delivery, [board, revised], images.slice(1))).toThrow("#11");
});
