import sharp from "sharp";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { canonicalizeShotNo } from "../../shared/imageAsset";
import { createGeneratedImage, getStoryGeneratedImages } from "../repositories/images";
import { getStoryMaterialState } from "./storyMaterials";
import { getStoryVideoTakes } from "../repositories/videos";
import { localImageDir } from "./imageGen";
import { renderTransitionVideoFrame } from "./videoEndpointFrames";
import { consumeTimelineFrameExtractionAllowance, preflightTimelineFrameExtractionStorage, runTimelineFrameCapture, storeTimelineFrameExtractionBytes } from "./timelineFrameExtractionLimits";

type Box = { x:number; y:number; w:number; h:number };
const arrow = [[0,0],[1,.59],[.60,.63],[.85,.90],[.61,1],[.37,.69],[0,.86]];
function insidePointer(x:number,y:number) {
  let inside=false;
  for(let i=0,j=arrow.length-1;i<arrow.length;j=i++) {
    const [ax,ay]=arrow[i], [bx,by]=arrow[j];
    if ((ay>y)!==(by>y) && x<(bx-ax)*(y-ay)/(by-ay)+ax) inside=!inside;
  }
  return inside;
}

// Locate the typical dark, left-pointing desktop cursor. A triangle or static send icon is insufficient.
function pointers(mask:Uint8Array,width:number,height:number) {
  const queue=new Int32Array(mask.length);
  const result:Box[]=[];
  for(let pos=0;pos<mask.length;pos++) {
    if(mask[pos]!==1) continue;
    let head=0,tail=1, left=width,top=height,right=0,bottom=0;
    queue[0]=pos; mask[pos]=2;
    while(head<tail) {
      const p=queue[head++],x=p%width,y=Math.floor(p/width);
      left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
      for(let yy=Math.max(0,y-1);yy<=Math.min(height-1,y+1);yy++)
        for(let xx=Math.max(0,x-1);xx<=Math.min(width-1,x+1);xx++) {
          const n=yy*width+xx;
          if(mask[n]===1){ mask[n]=2;queue[tail++]=n; }
        }
    }
    const w=right-left+1,h=bottom-top+1;
    if(w<6 || h<10 || h>128 || w/h<.45 || w/h>.9 || tail>w*h*.82) continue;
    let union=0,intersection=0;
    const pixels=new Set(queue.subarray(0,tail));
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
      const expected=insidePointer((x+.5)/w,(y+.5)/h), actual=pixels.has((top+y)*width+left+x);
      if(expected || actual) union++;
      if(expected && actual) intersection++;
    }
    if(intersection/union>=.73) result.push({x:left,y:top,w,h});
  }
  return result;
}

export function restoreOpeningPixels(first:Buffer,a:Buffer,b:Buffer,width:number,height:number) {
  const count=width*height;
  if(count>4096*4096 || [first,a,b].some(frame=>frame.length!==count*3)) throw new Error("原始帧尺寸不一致");
  const gone=new Uint8Array(count), moved=new Uint8Array(count);
  for(let p=0;p<count;p++) {
    const i=p*3,delta=(a[i]-first[i])+(a[i+1]-first[i+1])+(a[i+2]-first[i+2]);
    gone[p]=Number(delta>135); moved[p]=Number(delta< -135);
  }
  const arrows=pointers(gone,width,height);
  if(arrows.length!==1) throw new Error("无法唯一识别移动的鼠标指针，请核对原片。未修改画面。");
  const box=arrows[0],destinations=pointers(moved,width,height);
  if(!destinations.some(other=>Math.abs(other.w-box.w)<=2 && Math.abs(other.h-box.h)<=2))
    throw new Error("未找到鼠标移开后的对应轮廓，已保留发送键与原帧。");
  const pad=Math.max(3,Math.ceil(box.h*.18));
  const x0=box.x-pad,y0=box.y-pad,x1=box.x+box.w+pad,y1=box.y+box.h+pad;
  if(x0<1 || y0<1 || x1>=width || y1>=height) throw new Error("指针贴近边界，无法可靠还原。");
  let changed=0,donorError=0,borderError=0,borderSamples=0;
  const output=Buffer.from(first);
  for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++) {
    const i=(y*width+x)*3,edge=x<x0+2 || x>=x1-2 || y<y0+2 || y>=y1-2;
    for(let channel=0;channel<3;channel++) {
      const j=i+channel;
      const diff=Math.abs(a[j]-b[j]); donorError+=diff;
      if(edge) { borderError+=Math.abs(first[j]-a[j]); borderSamples++; }
      if(diff>22) throw new Error("鼠标后的背景发生变化，保留原帧。");
    }
    if(!first.subarray(i,i+3).equals(a.subarray(i,i+3))) changed++;
    a.copy(output,i,i,i+3);
  }
  if(donorError/((x1-x0)*(y1-y0)*3)>3 || borderError/borderSamples>4)
    throw new Error("邻帧背景没有稳定对齐，保留原帧。");
  return {output,box:{x:x0,y:y0,w:x1-x0,h:y1-y0},changed};
}

type Input = {storyId:number;stableShotId:string;userId:number};
type Result = {imageId:number;imageUrl:string;takeId:number};
const pending=new Map<string,Promise<Result>>();
export async function cleanVideoOpening(input:Input):Promise<Result> {
  const material=await getStoryMaterialState(input.storyId,input.userId);
  const shot=material?.shots.find(s=>s.stableShotId===input.stableShotId);
  const originals=shot && (await getStoryVideoTakes(input.storyId,input.userId)).filter(t=>
    t.stableShotId===shot.stableShotId && t.status==="available" && t.provider==="local-import" && t.model==="chatcut-original");
  if(!shot || originals?.length!==1) throw new Error("本镜没有可唯一定位的原始导入视频，请从仓库核对。");
  const take=originals[0], digest=createHash("sha256").update(JSON.stringify([input.userId,input.storyId,shot.stableShotId,take.id,take.videoKey,(take.parameterSnapshot as {sha256?: string} | null)?.sha256,"opening-cursor-v1"])).digest("hex").slice(0,32);
  const filename="source-opening-"+digest+".png",key="generated/frame-references/"+filename;
  const running=pending.get(key);
  if(running) return running;
  const task=(async()=>{
    const existing=(await getStoryGeneratedImages(input.storyId,input.userId)).find(img=>img.imageKey===key && img.shotIdentity===shot.stableShotId);
    if(existing) return {imageId:existing.id,imageUrl:existing.imageUrl,takeId:take.id};
    const allowance=consumeTimelineFrameExtractionAllowance({...input,requestId:digest});
    if(!allowance.allowed) throw new Error("本地抽帧繁忙，请稍后再试。");
    await preflightTimelineFrameExtractionStorage({storageKey:key});
    const frames=[];
    for(const atSec of [0,.85,1.3]) {
      const args={userId:input.userId,takeId:take.id,rangeId:null,atSec};
      const frame=await runTimelineFrameCapture({...args,variant:"source-native",capture:()=>renderTransitionVideoFrame({...args,preserveDimensions:true})});
      frames.push(await sharp(await readFile(frame.path),{limitInputPixels:4096*4096}).removeAlpha().toColourspace("srgb").raw().toBuffer({resolveWithObject:true}));
    }
    const {width,height}=frames[0].info;
    if(frames.some(f=>f.info.width!==width || f.info.height!==height)) throw new Error("邻帧尺寸不一致");
    const {output,box,changed}=restoreOpeningPixels(frames[0].data,frames[1].data,frames[2].data,width,height);
    const bytes=await sharp(output,{raw:{width,height,channels:3}}).png().toBuffer();
    await storeTimelineFrameExtractionBytes({bytes,storageKey:key,store:async()=>{
      await mkdir(localImageDir(),{recursive:true});
      await writeFile(path.join(localImageDir(),filename),bytes);
    }});
    const prompt=`视频原始首帧 · Take ${take.id} · 源 0.000s · 本地去鼠标 0 算力 · 源尺寸 ${width}×${height} · 修补框 ${box.x},${box.y},${box.w},${box.h} · 变化 ${changed} 像素 · 框外逐像素保留`;
    const image=await createGeneratedImage({storyId:input.storyId,userId:input.userId,shotIdentity:shot.stableShotId,shotNo:canonicalizeShotNo(shot.shotNo),imageKey:key,imageUrl:"/api/images/"+filename,prompt,isCurrent:false,generationType:"initial"});
    return {imageId:image.id,imageUrl:image.imageUrl,takeId:take.id};
  })();
  pending.set(key,task);
  try {return await task;} finally {pending.delete(key);}
}
