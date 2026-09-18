import {describe,expect,it,vi} from "vitest";
import type {TrpcContext} from "../_core/context";
import type {BoundShiguangStory} from "../services/shiguangStoryAccess";
import type {AuthoritativeStoryDocument} from "../services/shiguangStoryAuthorityClient";
import {createShiguangStoryAccessRouter} from "./shiguangStoryAccess";

const binding:BoundShiguangStory={id:4,userId:17,sourceFamilyId:"family_owner",sourceStoryId:"story-summer",grantId:"desktop-grant-"+"a".repeat(64),
  sourceRevisionId:"revision-old",sourceVersion:1,title:"那年的夏天",status:"active"};
const document:AuthoritativeStoryDocument={familyId:"family_owner",storyId:"story-summer",revisionId:"revision-current",version:8,title:"那年的夏天",updatedAt:"now",provenanceVersion:1,chapters:[]};
function context(userId:number|null):TrpcContext{return {user:userId===null?null:{id:userId,openId:`user-${userId}`,email:null,name:"用户",loginMethod:"test",role:"user",sessionVersion:1,createdAt:new Date(),updatedAt:new Date(),lastSignedIn:new Date()},
  req:{protocol:"https",headers:{}} as TrpcContext["req"],res:{} as TrpcContext["res"]};}

describe("拾光权威故事路由",()=>{
  it('卡片请求使用本人绑定，拒绝跨账号和夹带的原稿内容',async()=>{
    const card=vi.fn(async()=>({story:{id:'story-summer',title:'夏日',version:1},revisionId:'revision-a',chapters:[]}));
    const router=createShiguangStoryAccessRouter({list:async()=>[],get:async id=>id===17?binding:undefined,read:async()=>document,write:vi.fn(),card});
    await expect(router.createCaller(context(18)).card({accessId:4,operation:'source'})).rejects.toMatchObject({code:'NOT_FOUND'});
    expect(card).not.toHaveBeenCalled();
    await router.createCaller(context(17)).card({accessId:4,operation:'source'});
    expect(card).toHaveBeenCalledWith(binding,{operation:'source'});
    await expect(router.createCaller(context(17)).card({accessId:4,operation:'source',text:'注入内容'} as never)).rejects.toMatchObject({code:'BAD_REQUEST'});
    await expect(router.createCaller(context(null)).card({accessId:4,operation:'source'})).rejects.toMatchObject({code:'UNAUTHORIZED'});
  });
  it("列表仅使用登录账号且不暴露授权编号、家庭或故事内部编号",async()=>{
    const list=vi.fn(async(userId:number)=>userId===17?[binding]:[]),get=vi.fn(),read=vi.fn(),write=vi.fn();
    const result=await createShiguangStoryAccessRouter({list,get,read,write}).createCaller(context(17)).list();
    expect(list).toHaveBeenCalledWith(17);expect(result).toEqual([{id:4,title:"那年的夏天",status:"active"}]);
    expect(JSON.stringify(result)).not.toContain("grantId");expect(JSON.stringify(result)).not.toContain("family_owner");expect(JSON.stringify(result)).not.toContain("story-summer");
  });

  it("读取先按登录账号查绑定，错误账号看不到标题且不会调用权威端",async()=>{
    const read=vi.fn(async()=>document),get=vi.fn(async(userId:number,accessId:number)=>userId===17&&accessId===4?binding:undefined);
    const router=createShiguangStoryAccessRouter({list:async()=>[],get,read,write:vi.fn()});
    await expect(router.createCaller(context(18)).read({accessId:4})).rejects.toMatchObject({code:"NOT_FOUND",message:"故事不可用"});
    expect(read).not.toHaveBeenCalled();
    await expect(router.createCaller(context(17)).read({accessId:4})).resolves.toEqual(document);expect(get).toHaveBeenLastCalledWith(17,4);
  });

  it("不接受客户端 userId、grantId 或权威地址，匿名用户不能调用",async()=>{
    const router=createShiguangStoryAccessRouter({list:async()=>[],get:async()=>binding,read:async()=>document,write:vi.fn()});
    await expect(router.createCaller(context(17)).read({accessId:4,userId:18} as never)).rejects.toMatchObject({code:"BAD_REQUEST"});
    await expect(router.createCaller(context(null)).list()).rejects.toMatchObject({code:"UNAUTHORIZED"});
  });

  it("照片只按登录账号和当前文档坐标换取短期地址",async()=>{
    const media=vi.fn(async()=>({photoId:"photo-kept",url:"https://media.example/temporary.jpg",expiresInSeconds:300 as const}));
    const get=vi.fn(async(userId:number)=>userId===17?binding:undefined),router=createShiguangStoryAccessRouter({list:async()=>[],get,read:async()=>document,write:vi.fn(),media});
    const input={accessId:4,revisionId:"revision-current",chapterId:"chapter-one",photoId:"photo-kept"};
    await expect(router.createCaller(context(18)).media(input)).rejects.toMatchObject({code:"NOT_FOUND"});expect(media).not.toHaveBeenCalled();
    await expect(router.createCaller(context(17)).media(input)).resolves.toMatchObject({expiresInSeconds:300});
    expect(media).toHaveBeenCalledWith(binding,{revisionId:"revision-current",chapterId:"chapter-one",photoId:"photo-kept"});
    await expect(router.createCaller(context(17)).media({...input,grantId:binding.grantId} as never)).rejects.toMatchObject({code:"BAD_REQUEST"});
  });

  it("保存只按登录账号取隐藏授权，并拒绝客户端夹带来源和身份字段",async()=>{
    const write=vi.fn(async()=>({ok:true as const,storyId:"story-summer",revisionId:"revision-desktop-next",version:9,replayed:false}));
    const get=vi.fn(async(userId:number)=>userId===17?binding:undefined),router=createShiguangStoryAccessRouter({list:async()=>[],get,read:async()=>document,write});
    const input={accessId:4,revisionId:"revision-current",expectedVersion:8,requestId:"desktop-request-1",
      edits:[{action:"edit" as const,blockId:"block-"+"b".repeat(64),text:"电脑端修改"}]};
    await expect(router.createCaller(context(18)).write(input)).rejects.toMatchObject({code:"NOT_FOUND"});expect(write).not.toHaveBeenCalled();
    await expect(router.createCaller(context(17)).write(input)).resolves.toMatchObject({version:9});
    expect(write).toHaveBeenCalledWith(binding,{revisionId:"revision-current",expectedVersion:8,requestId:"desktop-request-1",edits:input.edits});
    await expect(router.createCaller(context(17)).write({...input,userId:18} as never)).rejects.toMatchObject({code:"BAD_REQUEST"});
    await expect(router.createCaller(context(17)).write({...input,edits:[{...input.edits[0],sourceIds:[]}]} as never)).rejects.toMatchObject({code:"BAD_REQUEST"});
  });

  it("保存冲突给出可恢复错误，权威端不可用时不回退本地快照",async()=>{
    const base={list:async()=>[],get:async()=>binding,read:async()=>document},input={accessId:4,revisionId:"revision-current",expectedVersion:8,
      requestId:"desktop-request-2",edits:[{action:"appendOwn" as const,chapterId:"chapter-one",text:"补充"}]};
    await expect(createShiguangStoryAccessRouter({...base,write:async()=>{throw new Error("story_version_conflict");}}).createCaller(context(17)).write(input))
      .rejects.toMatchObject({code:"CONFLICT"});
    await expect(createShiguangStoryAccessRouter({...base,write:async()=>{throw new Error("story_authority_unavailable");}}).createCaller(context(17)).write(input))
      .rejects.toMatchObject({code:"SERVICE_UNAVAILABLE"});
  });
});
