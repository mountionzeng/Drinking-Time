import { randomBytes } from "node:crypto";
import {z} from 'zod';
import {cardSourceSchema,cardDescriptorSchema,cardMaterialSchema,type CardSelection} from '../../shared/storyShareCard';

import { bridgeSignature } from "../_core/shiguangBridgeSignature";
import type { BoundShiguangStory } from "./shiguangStoryAccess";

const READ_PATH="/v1/story/read",WRITE_PATH="/v1/story/write",MEDIA_PATH="/v1/story/media";
const exact=(value:Record<string,unknown>,fields:string[])=>Object.keys(value).every(key=>fields.includes(key));

export type AuthoritativeStoryBlock={text?:string;photoId?:string;blockId:string;sourceIds:string[]};
export type AuthoritativeStoryDocument={familyId:string;storyId:string;revisionId:string;version:number;title:string;updatedAt:string;provenanceVersion:1;
  chapters:Array<{id:string;title:string;content:AuthoritativeStoryBlock[]}>};
type Fetcher=(input:string|URL,init?:RequestInit)=>Promise<Response>;
type AuthorityOptions={enabled?:boolean;baseUrl?:string;secret?:string;fetcher?:Fetcher;now?:()=>number;nonce?:()=>string;timeoutMs?:number};
export type ShiguangStoryWriteEdit={action:"edit";blockId:string;text:string}|{action:"merge";blockIds:string[];text:string}|{action:"appendOwn";chapterId:string;text:string};
export type ShiguangStoryWriteInput={revisionId:string;expectedVersion:number;requestId:string;edits:ShiguangStoryWriteEdit[]};
export type ShiguangStoryWriteResult={ok:true;storyId:string;revisionId:string;version:number;replayed:boolean};
export type ShiguangStoryMediaInput={revisionId:string;chapterId:string;photoId:string};
export type ShiguangStoryMediaResult={photoId:string;url:string;expiresInSeconds:300};

async function boundedText(response:Response,limit:number):Promise<string>{
  const declared=Number(response.headers.get("content-length"));if(Number.isFinite(declared)&&declared>limit){try{await response.body?.cancel();}catch{}throw new Error("story_authority_response_invalid");}
  if(!response.body){const value=await response.text();if(Buffer.byteLength(value)>limit)throw new Error("story_authority_response_invalid");return value;}
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;if(value){bytes+=value.byteLength;if(bytes>limit)throw new Error("story_authority_response_invalid");chunks.push(value);}}}
  catch(error){try{await reader.cancel();}catch{}throw error;}
  finally{reader.releaseLock();}
  return Buffer.concat(chunks.map(chunk=>Buffer.from(chunk))).toString("utf8");
}

function parseDocument(value:unknown):AuthoritativeStoryDocument|null{
  if(!value||typeof value!=="object"||Array.isArray(value))return null;const doc=value as Record<string,unknown>;
  if(!exact(doc,["familyId","storyId","revisionId","version","title","updatedAt","provenanceVersion","chapters"])||
    typeof doc.familyId!=="string"||!/^family_[0-9A-Za-z_-]{1,120}$/.test(doc.familyId)||typeof doc.storyId!=="string"||!/^story-[a-z0-9-]{1,100}$/.test(doc.storyId)||
    typeof doc.revisionId!=="string"||!/^revision-[a-zA-Z0-9-]{1,119}$/.test(doc.revisionId)||!Number.isSafeInteger(doc.version)||(doc.version as number)<1||(doc.version as number)>2147483647||
    typeof doc.title!=="string"||!doc.title.trim()||doc.title.length>120||typeof doc.updatedAt!=="string"||doc.updatedAt.length>64||!Number.isFinite(Date.parse(doc.updatedAt))||doc.provenanceVersion!==1||
    !Array.isArray(doc.chapters)||doc.chapters.length>30)return null;
  let blocks=0;const chapterIds=new Set<string>(),blockIds=new Set<string>(),chapters=[] as AuthoritativeStoryDocument["chapters"];
  for(const raw of doc.chapters){if(!raw||typeof raw!=="object"||Array.isArray(raw))return null;const chapter=raw as Record<string,unknown>;
    if(!exact(chapter,["id","title","content"])||typeof chapter.id!=="string"||!/^chapter-[a-z0-9-]{1,60}$/.test(chapter.id)||chapterIds.has(chapter.id)||typeof chapter.title!=="string"||chapter.title.length>40||!Array.isArray(chapter.content))return null;chapterIds.add(chapter.id);
    const content=[] as AuthoritativeStoryBlock[];for(const rawBlock of chapter.content){if(++blocks>512||!rawBlock||typeof rawBlock!=="object"||Array.isArray(rawBlock))return null;const block=rawBlock as Record<string,unknown>;
      if(!exact(block,["text","photoId","blockId","sourceIds"])||typeof block.blockId!=="string"||!/^block-[a-f0-9]{64}$/.test(block.blockId)||blockIds.has(block.blockId)||
        !Array.isArray(block.sourceIds)||block.sourceIds.length>64||new Set(block.sourceIds).size!==block.sourceIds.length||!block.sourceIds.every(id=>typeof id==="string"&&/^source-[a-f0-9]{64}$/.test(id))||
        ((typeof block.text==="string")===(typeof block.photoId==="string"))||(typeof block.text==="string"&&block.text.length>20000)||
        (typeof block.photoId==="string"&&!/^photo-[a-z0-9-]{1,120}$/.test(block.photoId)))return null;
      blockIds.add(block.blockId);content.push(block as AuthoritativeStoryBlock);}
    chapters.push({id:chapter.id,title:chapter.title,content});}
  return {...doc,chapters,title:doc.title.trim()} as AuthoritativeStoryDocument;
}

export async function readShiguangAuthoritativeStory(binding:BoundShiguangStory,options:{enabled?:boolean;baseUrl?:string;secret?:string;
  fetcher?:Fetcher;now?:()=>number;nonce?:()=>string;timeoutMs?:number}={}):Promise<AuthoritativeStoryDocument>{
  const value=await authorityRequest(READ_PATH,{grantId:binding.grantId},options);
  if(!value||typeof value!=="object"||Array.isArray(value)||!exact(value as Record<string,unknown>,["story"]))throw new Error("story_authority_response_invalid");
  const document=parseDocument((value as {story:unknown}).story);
  if(!document||document.familyId!==binding.sourceFamilyId||document.storyId!==binding.sourceStoryId)throw new Error("story_authority_response_invalid");
  return document;
}

async function authorityRequest(path:string,body:Record<string,unknown>,options:AuthorityOptions):Promise<unknown>{
  const enabled=options.enabled??process.env.SHIGUANG_STORY_AUTHORITY_ENABLED==="true",baseUrl=String(options.baseUrl??process.env.SHIGUANG_STORY_AUTHORITY_URL??"").trim();
  const secret=String(options.secret??process.env.SHIGUANG_STORY_AUTHORITY_SECRET??"");
  if(!enabled)throw new Error("story_authority_disabled");let url:URL;try{url=new URL(path,baseUrl.endsWith("/")?baseUrl:baseUrl+"/");}catch{throw new Error("story_authority_not_configured");}
  if(url.protocol!=="https:"||url.pathname!==path||url.username||url.password||secret.length<32)throw new Error("story_authority_not_configured");
  const timestamp=String((options.now??Date.now)()),nonce=(options.nonce??(()=>randomBytes(18).toString("base64url")))();
  if(!/^\d{13}$/.test(timestamp)||!/^[0-9A-Za-z_-]{16,64}$/.test(nonce))throw new Error("story_authority_request_invalid");
  let response:Response;try{response=await (options.fetcher??fetch)(url,{method:"POST",headers:{"content-type":"application/json","x-shiguang-timestamp":timestamp,
    "x-shiguang-nonce":nonce,"x-shiguang-signature":bridgeSignature(secret,path,timestamp,nonce,body)},body:JSON.stringify(body),signal:AbortSignal.timeout(options.timeoutMs??12000)});}catch{throw new Error("story_authority_unavailable");}
  if(!/^application\/json\b/i.test(response.headers.get("content-type")||"")){try{await response.body?.cancel();}catch{}throw new Error("story_authority_unavailable");}
  const raw=await boundedText(response,600000);
  let value:unknown;try{value=JSON.parse(raw);}catch{throw new Error("story_authority_response_invalid");}
  if(!response.ok){if(response.status===404)throw new Error("story_access_revoked");if(response.status===409)throw new Error("story_version_conflict");throw new Error("story_authority_unavailable");}
  return value;
}

export async function writeShiguangAuthoritativeStory(binding:BoundShiguangStory,input:ShiguangStoryWriteInput,options:AuthorityOptions={}):Promise<ShiguangStoryWriteResult>{
  const value=await authorityRequest(WRITE_PATH,{grantId:binding.grantId,...input},options);
  if(!value||typeof value!=="object"||Array.isArray(value)||!exact(value as Record<string,unknown>,["result"]))throw new Error("story_authority_response_invalid");
  const result=(value as {result:unknown}).result;if(!result||typeof result!=="object"||Array.isArray(result))throw new Error("story_authority_response_invalid");
  const row=result as Record<string,unknown>;if(!exact(row,["ok","storyId","revisionId","version","replayed"])||row.ok!==true||row.storyId!==binding.sourceStoryId||
    typeof row.revisionId!=="string"||!/^revision-[a-zA-Z0-9-]{1,119}$/.test(row.revisionId)||!Number.isSafeInteger(row.version)||(row.version as number)<1||(row.version as number)>2147483647||typeof row.replayed!=="boolean")
    throw new Error("story_authority_response_invalid");
  return row as ShiguangStoryWriteResult;
}

export async function readShiguangAuthoritativeMedia(binding:BoundShiguangStory,input:ShiguangStoryMediaInput,options:AuthorityOptions={}):Promise<ShiguangStoryMediaResult>{
  const value=await authorityRequest(MEDIA_PATH,{grantId:binding.grantId,...input},options);
  if(!value||typeof value!=="object"||Array.isArray(value)||!exact(value as Record<string,unknown>,["photo"]))throw new Error("story_authority_response_invalid");
  const photo=(value as {photo:unknown}).photo;if(!photo||typeof photo!=="object"||Array.isArray(photo))throw new Error("story_authority_response_invalid");
  const row=photo as Record<string,unknown>;if(!exact(row,["photoId","url","expiresInSeconds"])||row.photoId!==input.photoId||row.expiresInSeconds!==300||
    typeof row.url!=="string"||row.url.length>4096)throw new Error("story_authority_response_invalid");
  let url:URL;try{url=new URL(row.url);}catch{throw new Error("story_authority_response_invalid");}
  if(url.protocol!=="https:"||url.username||url.password)throw new Error("story_authority_response_invalid");
  return row as ShiguangStoryMediaResult;
}

export const parseShiguangAuthoritativeStory=parseDocument;

export async function requestShiguangShareCard(binding:BoundShiguangStory,input:{operation:'source'}|({operation:'preview'|'export';descriptorId?:string}&CardSelection),options:AuthorityOptions={}){
  const value=await authorityRequest('/v1/story/card',{grantId:binding.grantId,...input},options);
  const schema=input.operation==='source'?cardSourceSchema:input.operation==='preview'?z.object({descriptor:cardDescriptorSchema}).strict():cardMaterialSchema;
  const result=z.object({card:schema}).strict().safeParse(value);
  if(!result.success)throw new Error('story_authority_response_invalid');
  const card=result.data.card;
  if('story' in card){if(card.story.id!==binding.sourceStoryId)throw new Error('story_authority_response_invalid');}
  else if(card.descriptor.storyId!==binding.sourceStoryId||input.operation==='source'||card.descriptor.revisionId!==input.revisionId||card.descriptor.chapterId!==input.chapterId||
    (input.operation==='export'&&card.descriptor.id!==input.descriptorId))throw new Error('story_authority_response_invalid');
  if('descriptor' in card&&input.operation!=='source'){
    const photos=card.descriptor.photos;
    if(photos.length!==input.photoIds.length||new Set(photos.map(photo=>photo.photoId)).size!==photos.length||
      photos.some(photo=>!input.photoIds.includes(photo.photoId)||!input.blockIds.includes(photo.blockId)))throw new Error('story_authority_response_invalid');
    if(input.operation==='export'){
      const material=cardMaterialSchema.safeParse(card);
      if(!material.success||material.data.media.length!==photos.length||new Set(material.data.media.map(photo=>photo.photoId)).size!==material.data.media.length||
        material.data.media.some(photo=>!input.photoIds.includes(photo.photoId)))throw new Error('story_authority_response_invalid');
    }
  }
  return card;
}
