import { execFile } from "node:child_process";
import path from "node:path";
import sharp from "sharp";
import { TRPCError } from "@trpc/server";
import type { PictureRegion, RegionReading } from "../../shared/chatPictureRegion";
import { loadAuthorizedStoryImage } from "../persistence/storyVisualPersistence";
import { getStoryById } from "../repositories/stories";
import { imageBytesForAsset } from "./editingTransitionWorkflow";
import { isWechatImportImage, readOwnedWechatImage } from "./wechatVideoImage";

export async function cropPictureRegion(bytes:Uint8Array, region:PictureRegion) {
  const source = sharp(bytes, { limitInputPixels:48 * 1024 * 1024 });
  const meta = await source.metadata();
  if (!meta.width || !meta.height || (meta.pages ?? 1) !== 1) throw Error("请选一张可读取的静态图片");
  const rotated = [5,6,7,8].includes(meta.orientation ?? 1);
  const [w,h] = rotated ? [meta.height,meta.width] : [meta.width,meta.height];
  const left = Math.floor(w * region.left), top = Math.floor(h * region.top);
  const width = Math.ceil(w * region.right) - left, height = Math.ceil(h * region.bottom) - top;
  if (Math.min(width,height) < 3) throw Error("选区太小，请重新框选");
  return source.rotate().extract({left,top,width,height}).resize({width:1200,height:1200,fit:"inside",withoutEnlargement:true}).png().toBuffer();
}

function localRegionReading(crop:Buffer):Promise<RegionReading> {
  const mac = process.platform === "darwin";
  const args = mac ? [path.resolve("scripts/read-picture-region.swift")] : ["stdin","stdout","--psm","6"];
  return new Promise(resolve => {
    const task = execFile(mac ? "swift" : "tesseract", args, {timeout:15000,maxBuffer:256*1024}, (err, stdout) => {
      if (!err) {
        try {
          const result = mac ? JSON.parse(stdout) : {text:stdout,object:""};
          return resolve({text:String(result.text ?? "").trim().slice(0,240),object:String(result.object ?? "").slice(0,100),available:true});
        } catch { /* Report unavailable if the local reader did not finish. */ }
      }
      resolve({text:"",object:"",available:false});
    });
    task.stdin?.on("error", () => {}); // May close before input if the OS reader is absent.
    task.stdin?.end(crop);
  });
}

const readingUsers = new Map<number, number>();
let activeReaders = 0;
export async function ownedPictureBytes(storyId:number,userId:number,imageId:number) {
  const image = await loadAuthorizedStoryImage({storyId,userId,imageId});
  if (!image) throw new TRPCError({code:"NOT_FOUND",message:"图片不属于当前故事"});
  const bytes = isWechatImportImage(image.imageUrl) ? await readOwnedWechatImage(image.imageUrl,userId) :
    (await imageBytesForAsset(image.imageUrl)).bytes;
  if (!bytes) throw new TRPCError({code:"NOT_FOUND",message:"原图不可用"});
  return bytes;
}

export async function withLocalPictureReader<T>(userId:number,read:()=>Promise<T>):Promise<T> {
  if (activeReaders >= 6 || (readingUsers.get(userId) ?? 0) >= 2)
    throw new TRPCError({code:"TOO_MANY_REQUESTS",message:"正在读图，请稍后重新框选"});
  activeReaders++;
  readingUsers.set(userId, (readingUsers.get(userId) ?? 0) + 1);
  try {
    return await read();
  } finally {
    activeReaders--;
    const remaining = readingUsers.get(userId)! - 1;
    if (remaining) readingUsers.set(userId, remaining);
    else readingUsers.delete(userId);
  }
}

export async function inspectChatPictureRegion(input:{storyId:number;userId:number;imageId:number;region:PictureRegion}) {
  if (!await getStoryById(input.storyId,input.userId)) throw new TRPCError({code:"NOT_FOUND",message:"图片不属于当前故事"});
  return withLocalPictureReader(input.userId,async()=>{
    const bytes = await ownedPictureBytes(input.storyId,input.userId,input.imageId);
    return localRegionReading(await cropPictureRegion(bytes,input.region));
  });
}
