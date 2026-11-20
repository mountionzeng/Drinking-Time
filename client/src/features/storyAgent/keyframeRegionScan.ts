import { keyframeBoardImageIds, type ChatImageEditPlan } from "@shared/chatImageEditPlan";
import { chatPictureParts, regionFromNote, type RegionMatch } from "@shared/chatPictureRegion";
import type { ChatMessage } from "./types";

export function prepareKeyframeScan(text:string, messages:readonly ChatMessage[], storyId:number, selectedShot?:string|null) {
  const parts=chatPictureParts(text);
  const instruction=parts.filter(p=>!p.imageId).map(p=>p.text).join("").trim();
  const other=/(?:[其另][它他外余]|其余|剩下|整组|这组|同组|这[五5]张|每张|一起).{0,14}(?:张|图|也|查|搜|检查|找|改|修|问题)|(?:查|搜|检查|找).{0,12}(?:其[他它余]|另外|整组|剩下)|(?:check|find|scan|fix).{0,25}(?:other|rest|all|group)/i.test(instruction);
  const reject=/(?:不要有|不想要|我?不要这|不想保留|去掉|删掉|删除|移除|擦掉|抹掉|don't want|do not want|remove|erase)/i.test(instruction);
  if (!other && !reject || /(?:只|仅)(?:改|修|处理|看|查)(?:这|此|第)|(?:不(?:要|用|必)|别)(?:再)?(?:查|搜|检查|找|改|动)(?:其[他它余]|另外|整组)|(?:just|only) this (?:one|image)/i.test(instruction)) return null;
  if (/不要(?:删|去掉|移除)|(?:don't|do not) remove|取消/.test(instruction) && !other) return null;
  const scope=messages.filter(m=>m.selectionQuote?.storyId===storyId && (!selectedShot || m.selectionQuote.stableShotId===selectedShot));
  const explicit=parts.filter(p=>p.imageId);
  let reference=explicit.find(p=>p.note);
  if (other && !explicit.length && selectedShot) {
    const last=[...scope].reverse().find(m=>m.role==="user" && chatPictureParts(m.content).some(p=>p.imageId));
    reference=last && chatPictureParts(last.content).find(p=>p.note);
  }
  if(!reference?.imageId || !reference.note) {
    if(other && /同样|相同|一样的|同一个|同一处|圈选|框选|same (?:issue|thing|object)/i.test(instruction))
      throw Error("先在一张关键帧上框出问题，再告诉我想改什么，我会检查同组其他图。");
    return null;
  }
  if(explicit.length>1) {if(other) throw Error("请用一个选区作样本，再检查同组图片。");return null;}
  const region=regionFromNote(reference.note);
  if(!region) return null;
  const boards=scope.filter(m=>m.role==="assistant" && m.id.startsWith("saved-photos:") && keyframeBoardImageIds(m.id,m.content).length);
  const board=[...boards].reverse().find(m=>keyframeBoardImageIds(m.id,m.content).includes(reference!.imageId!));
  if(!board || !board.selectionQuote?.stableShotId) {if(other)throw Error("这张图不在当前镜头的关键帧组中，请从审图消息重新框选。");return null;}
  if(boards.some(m=>m.selectionQuote?.stableShotId===board.selectionQuote!.stableShotId && boards.indexOf(m)>boards.indexOf(board)))
    {if(other)throw Error("这张图属于旧版，请在本镜最新一组里框选。");return null;}
  const ids=keyframeBoardImageIds(board.id,board.content);
  if(ids.length<2 || ids.length>12)return null;
  return {board,ids,imageId:reference.imageId,region,instruction};
}

export function scannedEditPlan(request:NonNullable<ReturnType<typeof prepareKeyframeScan>>, rows:RegionMatch[],
  images:readonly {imageId?:number;imageUrl:string;label:string}[]): ChatImageEditPlan {
  if(rows.length!==request.ids.length || rows.some((row,i)=>row.imageId!==request.ids[i])) throw Error("组内原图已变化，请重新检查。");
  return {status:"draft",mode:"separate",keyframeBoardId:request.board.id,regionScanSourceId:request.imageId,
    changes:/(?:不要有|不想要|不要这|不想保留|去掉|删掉|删除|移除|擦掉|抹掉|remove|erase|(?:don't|do not) want)/i.test(request.instruction)
      ? "移除每张标出范围内匹配的内容，用周围背景补齐。" + request.instruction
      : /替换|改成|换成|调亮|调暗|修复|change|replace|repair/i.test(request.instruction) ? request.instruction : "", preserve:"保留选区以外的主体、文字、构图、纸感和原有光影。修补处与周边材质、透视和受光相接。",
    details:"每张按各自标出的位置修改。", images:rows.map(row=>{
      const image=images.find(i=>i.imageId===row.imageId);
      if(!image)throw Error("组内原图 #"+row.imageId+" 已不可用。");
      return {imageId:row.imageId,imageUrl:image.imageUrl,label:image.label,role:row.region?"target":"omit",copies:1,
        region:row.region,purpose:row.detail};
    })};
}
