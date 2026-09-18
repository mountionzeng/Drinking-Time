import {describe,expect,it} from "vitest";
import type {TrpcContext} from "../_core/context";
import {createShiguangStoryAccessRouter} from "../routers/shiguangStoryAccess";
import type {BoundShiguangStory} from "../services/shiguangStoryAccess";
import {readShiguangAuthoritativeMedia,readShiguangAuthoritativeStory,writeShiguangAuthoritativeStory,type AuthoritativeStoryDocument} from "../services/shiguangStoryAuthorityClient";

const binding:BoundShiguangStory={id:4,userId:17,sourceFamilyId:"family_owner",sourceStoryId:"story-summer",grantId:"desktop-grant-"+"a".repeat(64),
  sourceRevisionId:"revision-old",sourceVersion:1,title:"夏天",status:"active"};
function context(userId:number):TrpcContext{return {user:{id:userId,openId:`integration-${userId}`,email:null,name:"测试",loginMethod:"test",role:"user",sessionVersion:1,
  createdAt:new Date(),updatedAt:new Date(),lastSignedIn:new Date()},req:{protocol:"https",headers:{}} as TrpcContext["req"],res:{} as TrpcContext["res"]};}

describe("登录用户到拾光权威故事的读写集成",()=>{
  it("uses one owned binding for read then write without exposing or accepting authority identity",async()=>{
    let story:AuthoritativeStoryDocument={familyId:"family_owner",storyId:"story-summer",revisionId:"revision-current",version:8,title:"夏天",updatedAt:"2026-09-18T06:00:00.000Z",
      provenanceVersion:1,chapters:[{id:"chapter-one",title:"第一章",content:[{text:"原文",blockId:"block-"+"b".repeat(64),sourceIds:[]},
        {photoId:"photo-kept",blockId:"block-"+"c".repeat(64),sourceIds:[]}]}]};
    const fetcher=async(input:string|URL,init?:RequestInit)=>{const url=new URL(String(input)),body=JSON.parse(String(init?.body));expect(body.grantId).toBe(binding.grantId);
      if(url.pathname==="/v1/story/read")return new Response(JSON.stringify({story}),{status:200,headers:{"content-type":"application/json"}});
      if(url.pathname==="/v1/story/media")return new Response(JSON.stringify({photo:{photoId:body.photoId,url:"https://media.example/temporary.jpg",expiresInSeconds:300}}),
        {status:200,headers:{"content-type":"application/json"}});
      story={...story,revisionId:"revision-desktop-next",version:9,updatedAt:"2026-09-18T06:01:00.000Z",chapters:[{...story.chapters[0],content:story.chapters[0].content.map(block=>
        typeof block.text==="string"?{...block,text:body.edits[0].text}:block)}]};
      return new Response(JSON.stringify({result:{ok:true,storyId:story.storyId,revisionId:story.revisionId,version:story.version,replayed:false}}),{status:200,headers:{"content-type":"application/json"}});};
    const options={enabled:true,baseUrl:"https://authority.example",secret:"s".repeat(32),fetcher,now:()=>1789711200000,nonce:()=>"abcdefghijklmnop"};
    const router=createShiguangStoryAccessRouter({list:async userId=>userId===17?[binding]:[],get:async(userId,id)=>userId===17&&id===4?binding:undefined,
      read:item=>readShiguangAuthoritativeStory(item,options),write:(item,input)=>writeShiguangAuthoritativeStory(item,input,options),
      media:(item,input)=>readShiguangAuthoritativeMedia(item,input,options)}),owner=router.createCaller(context(17));
    await expect(owner.read({accessId:4})).resolves.toMatchObject({version:8,chapters:[{content:[{text:"原文"},{photoId:"photo-kept"}]}]});
    await expect(owner.media({accessId:4,revisionId:"revision-current",chapterId:"chapter-one",photoId:"photo-kept"})).resolves.toMatchObject({expiresInSeconds:300});
    await expect(owner.write({accessId:4,revisionId:"revision-current",expectedVersion:8,requestId:"desktop-request-1",
      edits:[{action:"edit",blockId:"block-"+"b".repeat(64),text:"网页修改"}]})).resolves.toMatchObject({version:9});
    await expect(owner.read({accessId:4})).resolves.toMatchObject({version:9,chapters:[{content:[{text:"网页修改"},{photoId:"photo-kept"}]}]});
    await expect(router.createCaller(context(18)).read({accessId:4})).rejects.toMatchObject({code:"NOT_FOUND"});
  });
});
