import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { captureInputSchema, CAPTURE_MAX_FILE_BYTES, CAPTURE_MAX_TOTAL_BYTES, type CaptureInput } from "../../shared/materialCapture";
import { captureHash } from "./materialCapture";
const schema = z.object({ encodedItems: z.string().min(1).max(28*1024*1024) });
const bad = (message:string) => new TRPCError({code:"BAD_REQUEST",message});
function contentUuid(value:string) {
  const hex=captureHash(value);
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
/** Shortcuts encodes the actual shared text/file bytes, never downloads source URLs. */
export function shortcutCaptureInput(userId:number,raw:unknown):CaptureInput {
  const {encodedItems}=schema.parse(raw), parts=encodedItems.trim().split(/\r?\n/).filter(Boolean);
  if(parts.length>12)throw bad("每次最多分享12项文字或素材");
  const id=contentUuid(`shortcut:${userId}:${encodedItems.trim()}`), files:CaptureInput["files"]=[], texts:string[]=[];
  let total=0;
  for(const [index,base64] of parts.entries()){
    if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))throw bad("分享素材编码无效");
    const bytes=Buffer.from(base64,"base64");total+=bytes.length;
    if(bytes.length>CAPTURE_MAX_FILE_BYTES || total>CAPTURE_MAX_TOTAL_BYTES)throw bad("单份素材最多8MB，一批最多20MB");
    let mime:CaptureInput["files"][number]["mime"]|undefined, extension="";
    if(bytes.subarray(0,3).equals(Buffer.from([255,216,255]))){mime="image/jpeg";extension="jpg";}
    else if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){mime="image/png";extension="png";}
    else if(bytes.subarray(0,4).toString()==="RIFF") {if(bytes.subarray(8,12).toString()==="WEBP"){mime="image/webp";extension="webp";}else if(bytes.subarray(8,12).toString()==="WAVE"){mime="audio/wav";extension="wav";}}
    else if(bytes.subarray(0,4).toString()==="OggS"){mime="audio/ogg";extension="ogg";}
    else if(bytes.subarray(4,8).toString()==="ftyp"){
      if(/hei[cf]|mif1|avif/.test(bytes.subarray(8,32).toString()))throw bad("此照片为HEIC，请在相册分享选项中选择“最兼容”（JPEG）后重试");
      mime="audio/mp4";extension="m4a";
    }
    else if(bytes.subarray(0,3).toString()==="ID3" || (bytes[0]===255 && (bytes[1]&224)===224)){mime="audio/mpeg";extension="mp3";}
    if(mime){files.push({id:contentUuid(`${id}:${index}`),name:`分享素材-${index+1}.${extension}`,mime,base64});continue;}
    let text:string;
    try {text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);}catch{throw bad("此文件格式暂不支持，请直接发送文字、JPG/PNG/WebP图片或录音");}
    if(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text))throw bad("无法将此文件识别为文字或媒体");
    texts.push(text);
  }
  // Sharing identical bytes again returns the original result, including after an interrupted shortcut.
  return captureInputSchema.parse({id,origin:"ios-shortcut",text:texts.join("\n\n"),files});
}
