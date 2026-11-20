import { execFile } from "node:child_process";
import { setImmediate as yieldThread } from "node:timers/promises";
import path from "node:path";
import sharp from "sharp";
import { TRPCError } from "@trpc/server";
import { keyframeBoardImageIds } from "../../shared/chatImageEditPlan";
import { type PictureRegion, type RegionMatch } from "../../shared/chatPictureRegion";
import { getStoryById } from "../repositories/stories";
import { ownedPictureBytes, withLocalPictureReader } from "./chatPictureRegion";

type Word = { text: string; region: PictureRegion; confidence?: number };
type Plane = { pixels: Buffer; width: number; height: number };
const centerInside = (b: PictureRegion, r: PictureRegion) =>
  (b.left+b.right)/2 >= r.left && (b.left+b.right)/2 <= r.right && (b.top+b.bottom)/2 >= r.top && (b.top+b.bottom)/2 <= r.bottom;
const normalize = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export function findTextRegion(words: Word[], needle: string): PictureRegion[] {
  const target = normalize(needle);
  if (target.length < 2) return [];
  const hits: PictureRegion[] = [];
  for (let i=0; i<words.length; i++) {
    let text = "", bounds = { ...words[i].region };
    for (let j=i; j<words.length && target.length>text.length; j++) {
      const word = words[j], token = normalize(word.text);
      if (!token) break;
      if (j>i && Math.abs(word.region.top - words[i].region.top) > 1.5*(words[i].region.bottom-words[i].region.top)) break;
      text += token;
      if (!target.startsWith(text)) break;
      bounds = { left: Math.min(bounds.left,word.region.left), right: Math.max(bounds.right,word.region.right),
        top: Math.min(bounds.top,word.region.top), bottom: Math.max(bounds.bottom,word.region.bottom) };
      if (text === target && ((words[i].confidence ?? 1) >= 0.5 || j >= i+1 && target.length >= 8)) hits.push(bounds);
    }
  }
  return hits;
}

async function wordsIn(png: Buffer, width: number, height: number): Promise<Word[] | null> {
  const mac = process.platform === "darwin";
  const args = mac ? [path.resolve("scripts/read-picture-region.swift"), "--words"] : ["stdin","stdout","--psm","11","tsv"];
  return new Promise(resolve => {
    const task = execFile(mac ? "swift" : "tesseract", args, { timeout: 12000, maxBuffer: 1024*1024 }, (error, stdout) => {
      if (error) return resolve(null);
      try {
        if (mac) return resolve(JSON.parse(stdout));
        const result:Word[]=[];
        for (const line of stdout.split("\n").slice(1)) {
          const c=line.split("\t"), text=c.slice(11).join(" ").trim();
          if (c[0] !== "5" || Number(c[10]) < 50 || !text) continue;
          const [x,y,w,h]=c.slice(6,10).map(Number);
          result.push({text,region:{left:x/width, top:y/height, right:(x+w)/width,bottom:(y+h)/height}});
        }
        resolve(result);
      } catch { resolve(null); }
    });
    task.stdin?.on("error",()=>{}); task.stdin?.end(png);
  });
}

async function loadFrame(storyId: number, userId: number, imageId: number) {
  const bytes = await ownedPictureBytes(storyId,userId,imageId);
  const { data, info } = await sharp(bytes,{limitInputPixels:48*1024*1024}).rotate().resize({width:1280,height:1280,fit:"inside",withoutEnlargement:true}).png().toBuffer({resolveWithObject:true});
  const small = await sharp(data).flatten({background:"#fff"}).resize({width:256,height:256,fit:"inside"}).greyscale().raw().toBuffer({resolveWithObject:true});
  return { words: await wordsIn(data,info.width,info.height), plane:{pixels:small.data,width:small.info.width,height:small.info.height} };
}

/** Search translated and resized copies. Flat patches and ambiguous repeating motifs require review. */
export async function findVisualRegion(source: Plane, region: PictureRegion, dst: Plane): Promise<PictureRegion | undefined> {
  const sw=(region.right-region.left)*source.width, sh=(region.bottom-region.top)*source.height;
  if (Math.min(sw,sh)<5) return;
  const grid=8, values:number[]=[];
  for(let j=0;j<grid;j++) for(let i=0;i<grid;i++){
    const x=Math.min(source.width-1,Math.floor(region.left*source.width+(i+.5)*sw/grid));
    const y=Math.min(source.height-1,Math.floor(region.top*source.height+(j+.5)*sh/grid));
    values.push(source.pixels[y*source.width+x]);
  }
  const mean=values.reduce((a,b)=>a+b,0)/values.length, centered=values.map(v=>v-mean);
  const variance=centered.reduce((s,v)=>s+v*v,0);
  let texture = 0;
  for(let y=1;y<grid-1;y++)for(let x=1;x<grid-1;x++) {
    const k=y*grid+x;
    texture+=Math.abs(values[k]-(values[k-1]+values[k+1]+values[k-grid]+values[k+grid])/4);
  }
  if(variance/values.length<36 || texture/(grid-2)**2<3) return;
  type Hit={score:number;region:PictureRegion};
  let best:Hit|undefined, second:Hit|undefined;
  const close=(a:PictureRegion,b:PictureRegion)=>Math.abs((a.left+a.right)-(b.left+b.right))<.6*(a.right-a.left) &&
    Math.abs((a.top+a.bottom)-(b.top+b.bottom))<.6*(a.bottom-a.top);
  for(const scale of [.5,.67,.8,1,1.25,1.5,2]){
    const w=Math.round(sw*scale),h=Math.round(sh*scale);
    if(Math.min(w,h)<5 || w>dst.width || h>dst.height) continue;
    const offsets=values.map((_,k)=>Math.floor((Math.floor(k/grid)+.5)*h/grid)*dst.width+Math.floor((k%grid+.5)*w/grid));
    for(let y=0;y<=dst.height-h;y++) for(let x=0;x<=dst.width-w;x++){
      const start=y*dst.width+x; let sum=0, sumSq=0, cross=0;
      for(let k=0;k<offsets.length;k++){ const v=dst.pixels[start+offsets[k]];sum+=v;sumSq+=v*v;cross+=v*centered[k]; }
      const spread=sumSq-sum*sum/values.length;
      if(spread<variance*.18 || spread>variance*8 || Math.abs(sum/values.length-mean)>22)continue;
      const score=cross/Math.sqrt(spread*variance);
      if(score<.89)continue;
      const hit={score,region:{left:x/dst.width,top:y/dst.height,right:(x+w)/dst.width,bottom:(y+h)/dst.height}};
      if(!best || score>best.score){ if(best && !close(hit.region,best.region)) second=best; best=hit; }
      else if(!close(hit.region,best.region) && (!second || score>second.score)) second=hit;
    }
    await yieldThread();
  }
  if(best && best.score>=.965 && (!second || close(best.region,second.region) || best.score-second.score>.045)) return best.region;
}

export async function scanKeyframeRegions(input:{storyId:number;userId:number;shotId:string;boardId:string;imageId:number;region:PictureRegion}) {
  const {storyId,userId,imageId,region}=input;
  const story=await getStoryById(storyId,userId);
  const body=story?.body as {messages?:Array<{id:string;who:string;text:string;selectionQuote?:{storyId:number;stableShotId:string}}> } | undefined;
  const board=body?.messages?.filter(m=>m.who==="s" && m.selectionQuote?.storyId===storyId && m.selectionQuote.stableShotId===input.shotId &&
    keyframeBoardImageIds(m.id,m.text).length).at(-1);
  const ids=board && keyframeBoardImageIds(board.id,board.text);
  if(!ids || board?.id!==input.boardId || !ids.includes(imageId) || ids.length<2 || ids.length>12)
    throw new TRPCError({code:"CONFLICT",message:"本镜关键帧组已变化，请重新选图"});
  return withLocalPictureReader(userId,async()=>{
    const source=await loadFrame(storyId,userId,imageId);
    const phrase=(source.words??[]).filter(w=>centerInside(w.region,region)).map(w=>w.text).join(" ").slice(0,160);
    const rows:RegionMatch[]=[];
    for(const id of ids){
      if(id===imageId){rows.push({imageId:id,status:"source",region,detail:phrase || "圈选原处"});continue;}
      try{
        const frame=await loadFrame(storyId,userId,id);
        const matches=findTextRegion(frame.words??[],phrase);
        if(matches.length===1){rows.push({imageId:id,status:"matched",region:matches[0],detail:phrase});continue;}
        if(matches.length>1){rows.push({imageId:id,status:"review",detail:"多处文字相同，需要选定位置"});continue;}
        const visual=await findVisualRegion(source.plane,region,frame.plane);
        if(visual){rows.push({imageId:id,status:"matched",region:visual,detail:"相同局部图形"});continue;}
        const textChecked=normalize(phrase).length>=2 && Boolean(frame.words?.length);
        rows.push({imageId:id,status:textChecked?"not-found":"review",detail:textChecked?"未检出相同文字":"未能可靠定位，需核对"});
      }catch{rows.push({imageId:id,status:"review",detail:"原图未能读取，需核对"});}
    }
    return rows;
  });
}
