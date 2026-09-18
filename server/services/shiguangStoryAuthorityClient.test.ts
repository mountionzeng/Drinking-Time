import {describe,expect,it,vi} from "vitest";
import {bridgeSignature} from "../_core/shiguangBridgeSignature";
import type {BoundShiguangStory} from "./shiguangStoryAccess";
import {readShiguangAuthoritativeMedia,readShiguangAuthoritativeStory,writeShiguangAuthoritativeStory} from "./shiguangStoryAuthorityClient";

const binding:BoundShiguangStory={id:4,userId:17,sourceFamilyId:"family_owner",sourceStoryId:"story-summer",grantId:"desktop-grant-"+"a".repeat(64),
  sourceRevisionId:"revision-old",sourceVersion:1,title:"旧标题",status:"active"};
const story={familyId:"family_owner",storyId:"story-summer",revisionId:"revision-current",version:8,title:"夏天",updatedAt:"2026-09-18T06:00:00.000Z",provenanceVersion:1 as const,
  chapters:[{id:"chapter-one",title:"第一章",content:[{text:"现在的正文",blockId:"block-"+"b".repeat(64),sourceIds:["source-"+"c".repeat(64)]}]}]};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json; charset=utf-8"}});

describe("拾光权威故事客户端",()=>{
  it("只把服务器保存的授权编号发送到 HTTPS 权威端，并严格验证当前文档",async()=>{
    const fetcher=vi.fn(async(input:string|URL,init?:RequestInit)=>{
      expect(String(input)).toBe("https://authority.example/v1/story/read");expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({grantId:binding.grantId});
      const headers=init?.headers as Record<string,string>,timestamp="1789711200000",nonce="abcdefghijklmnop";
      expect(headers["x-shiguang-signature"]).toBe(bridgeSignature("s".repeat(32),"/v1/story/read",timestamp,nonce,{grantId:binding.grantId}));
      return json({story});
    });
    await expect(readShiguangAuthoritativeStory(binding,{enabled:true,baseUrl:"https://authority.example",secret:"s".repeat(32),fetcher,now:()=>1789711200000,nonce:()=>"abcdefghijklmnop"})).resolves.toEqual(story);
  });

  it("默认关闭，且拒绝 HTTP、错故事、未知字段和不可用服务",async()=>{
    await expect(readShiguangAuthoritativeStory(binding,{enabled:false})).rejects.toThrow("story_authority_disabled");
    await expect(readShiguangAuthoritativeStory(binding,{enabled:true,baseUrl:"http://authority.example",secret:"s".repeat(32)})).rejects.toThrow("story_authority_not_configured");
    for(const value of [{story:{...story,storyId:"story-other"}},{story:{...story,secret:"leak"}},{story:{...story,provenanceVersion:2}}]){
      await expect(readShiguangAuthoritativeStory(binding,{enabled:true,baseUrl:"https://authority.example",secret:"s".repeat(32),fetcher:async()=>json(value),now:()=>1789711200000,nonce:()=>"abcdefghijklmnop"})).rejects.toThrow("story_authority_response_invalid");
    }
    await expect(readShiguangAuthoritativeStory(binding,{enabled:true,baseUrl:"https://authority.example",secret:"s".repeat(32),fetcher:async()=>{throw new Error("offline");},now:()=>1789711200000,nonce:()=>"abcdefghijklmnop"})).rejects.toThrow("story_authority_unavailable");
  });

  it("撤销响应不会回退到旧的导入快照",async()=>{
    await expect(readShiguangAuthoritativeStory(binding,{enabled:true,baseUrl:"https://authority.example",secret:"s".repeat(32),fetcher:async()=>json({error:"story_access_revoked"},404),now:()=>1789711200000,nonce:()=>"abcdefghijklmnop"})).rejects.toThrow("story_access_revoked");
  });

  it("照片请求绑定当前修订和章节，并只接受短期 HTTPS 地址",async()=>{
    const input={revisionId:"revision-current",chapterId:"chapter-one",photoId:"photo-kept"},fetcher=vi.fn(async(url:string|URL,init?:RequestInit)=>{
      expect(String(url)).toBe("https://authority.example/v1/story/media");const body=JSON.parse(String(init?.body));
      expect(body).toEqual({grantId:binding.grantId,...input});const headers=init?.headers as Record<string,string>;
      expect(headers["x-shiguang-signature"]).toBe(bridgeSignature("s".repeat(32),"/v1/story/media","1789711200000","abcdefghijklmnop",body));
      return json({photo:{photoId:"photo-kept",url:"https://media.example/temporary.jpg?token=short",expiresInSeconds:300}});
    });
    await expect(readShiguangAuthoritativeMedia(binding,input,{enabled:true,baseUrl:"https://authority.example",secret:"s".repeat(32),fetcher,
      now:()=>1789711200000,nonce:()=>"abcdefghijklmnop"})).resolves.toMatchObject({photoId:"photo-kept",expiresInSeconds:300});
    for(const photo of [{photoId:"photo-other",url:"https://media.example/a",expiresInSeconds:300},{photoId:"photo-kept",url:"http://media.example/a",expiresInSeconds:300},
      {photoId:"photo-kept",url:"https://media.example/a",expiresInSeconds:3600}])await expect(readShiguangAuthoritativeMedia(binding,input,{enabled:true,
        baseUrl:"https://authority.example",secret:"s".repeat(32),fetcher:async()=>json({photo}),now:()=>1789711200000,nonce:()=>"abcdefghijklmnop"}))
        .rejects.toThrow("story_authority_response_invalid");
  });

  it("写入只发送版本和区块操作，并严格验证权威端回执",async()=>{
    const input={revisionId:"revision-current",expectedVersion:8,requestId:"desktop-request-1",edits:[{action:"edit" as const,blockId:"block-"+"b".repeat(64),text:"电脑端修改"}]};
    const fetcher=vi.fn(async(url:string|URL,init?:RequestInit)=>{
      expect(String(url)).toBe("https://authority.example/v1/story/write");const body=JSON.parse(String(init?.body));
      expect(body).toEqual({grantId:binding.grantId,...input});expect(JSON.stringify(body)).not.toContain("sourceIds");
      const headers=init?.headers as Record<string,string>;expect(headers["x-shiguang-signature"]).toBe(bridgeSignature("s".repeat(32),"/v1/story/write","1789711200000","abcdefghijklmnop",body));
      return json({result:{ok:true,storyId:"story-summer",revisionId:"revision-desktop-"+"d".repeat(32),version:9,replayed:false}});
    });
    await expect(writeShiguangAuthoritativeStory(binding,input,{enabled:true,baseUrl:"https://authority.example",secret:"s".repeat(32),fetcher,now:()=>1789711200000,
      nonce:()=>"abcdefghijklmnop"})).resolves.toMatchObject({ok:true,version:9,replayed:false});
  });

  it("写入冲突、错故事回执和网络失败都不会伪装成保存成功",async()=>{
    const input={revisionId:"revision-current",expectedVersion:8,requestId:"desktop-request-2",edits:[{action:"appendOwn" as const,chapterId:"chapter-one",text:"补充"}]};
    const options={enabled:true,baseUrl:"https://authority.example",secret:"s".repeat(32),now:()=>1789711200000,nonce:()=>"abcdefghijklmnop"};
    await expect(writeShiguangAuthoritativeStory(binding,input,{...options,fetcher:async()=>json({error:"version_conflict"},409)})).rejects.toThrow("story_version_conflict");
    await expect(writeShiguangAuthoritativeStory(binding,input,{...options,fetcher:async()=>json({result:{ok:true,storyId:"story-other",revisionId:"revision-next",version:9,replayed:false}})})).rejects.toThrow("story_authority_response_invalid");
    await expect(writeShiguangAuthoritativeStory(binding,input,{...options,fetcher:async()=>{throw new Error("offline");}})).rejects.toThrow("story_authority_unavailable");
  });
});
