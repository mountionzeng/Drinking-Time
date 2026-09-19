import {describe,expect,it} from "vitest";
import {bindShiguangStoryAccessWithStore,parseShiguangStoryAccessGrant,type BoundShiguangStory,type ShiguangStoryAccessGrant,type ShiguangStoryAccessStore} from "./shiguangStoryAccess";

const grant=(suffix="a"):ShiguangStoryAccessGrant=>({grantId:`desktop-grant-${suffix.repeat(64)}`,familyId:"family_owner",storyId:"story-summer",
  revisionId:"revision-current",version:7,title:"那年的夏天"});
function memoryStore():ShiguangStoryAccessStore&{rows:BoundShiguangStory[]}{
  const rows:BoundShiguangStory[]=[];
  return {rows,findByGrant:async id=>rows.find(row=>row.grantId===id),findByStory:async(userId,familyId,storyId)=>rows.find(row=>row.userId===userId&&row.sourceFamilyId===familyId&&row.sourceStoryId===storyId),
    upsert:async(userId,input)=>{const found=rows.find(row=>row.userId===userId&&row.sourceFamilyId===input.familyId&&row.sourceStoryId===input.storyId);
      const next={id:found?.id??rows.length+1,userId,sourceFamilyId:input.familyId,sourceStoryId:input.storyId,grantId:input.grantId,
        sourceRevisionId:input.revisionId,sourceVersion:input.version,title:input.title,status:"active" as const};if(found)Object.assign(found,next);else rows.push(next);}};
}
describe("权威拾光故事绑定",()=>{
  it("只接受有界、完整且没有额外字段的授权描述",()=>{
    expect(parseShiguangStoryAccessGrant(grant())).toEqual(grant());
    expect(parseShiguangStoryAccessGrant({...grant(),title:""})).toBeNull();
    expect(parseShiguangStoryAccessGrant({...grant(),clientDraft:{text:"伪造"}})).toBeNull();
    expect(parseShiguangStoryAccessGrant({...grant(),revisionId:`revision-${"a".repeat(119)}`,version:2147483647})).not.toBeNull();
    expect(parseShiguangStoryAccessGrant({...grant(),revisionId:`revision-${"a".repeat(120)}`})).toBeNull();
    expect(parseShiguangStoryAccessGrant({...grant(),version:2147483648})).toBeNull();
  });
  it("同一账号和故事更新绑定而不创建第二份权威稿",async()=>{
    const store=memoryStore(),first=await bindShiguangStoryAccessWithStore(17,grant(),store);
    const next={...grant("b"),revisionId:"revision-next",version:8};const updated=await bindShiguangStoryAccessWithStore(17,next,store);
    expect(updated.id).toBe(first.id);expect(updated.sourceRevisionId).toBe("revision-next");expect(store.rows).toHaveLength(1);
  });
  it("同一个授权编号不能绑定到另一账号或故事",async()=>{
    const store=memoryStore();await bindShiguangStoryAccessWithStore(17,grant(),store);
    await expect(bindShiguangStoryAccessWithStore(18,grant(),store)).rejects.toThrow("grant_conflict");
    await expect(bindShiguangStoryAccessWithStore(17,{...grant(),storyId:"story-other"},store)).rejects.toThrow("grant_conflict");
  });
  it("延迟到达的旧授权不能把已观察到的较新修订回退",async()=>{
    const store=memoryStore();await bindShiguangStoryAccessWithStore(17,{...grant(),revisionId:"revision-new",version:9},store);
    await expect(bindShiguangStoryAccessWithStore(17,{...grant("b"),revisionId:"revision-old",version:8},store)).rejects.toThrow("stale_grant");
    await expect(bindShiguangStoryAccessWithStore(17,{...grant("c"),revisionId:"revision-other",version:9},store)).rejects.toThrow("grant_conflict");
    expect(store.rows[0]).toMatchObject({sourceRevisionId:"revision-new",sourceVersion:9});
  });
});
