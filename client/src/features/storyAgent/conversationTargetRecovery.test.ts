import { expect, it } from "vitest";
import type { StoryMaterialState } from "@shared/storyMaterial";
import type { CreationEditorShot } from "../creationEditor/types";
import type { ChatMessage } from "./types";
import { recoverConversationTarget } from "./conversationTargetRecovery";

const shots = [{ stableShotId: "s3", shotNo: 3, subject: "Forest" }] as CreationEditorShot[];
const materialState = { storyId: 7, shots: [], warehouseImages: [
  { id: 2109, storyId: 7, shotIdentity: "s3", imageUrl: "/source.png" },
  { id: 2116, storyId: 7, shotIdentity: "s3", imageUrl: "/candidate.png" },
] } as unknown as StoryMaterialState;
const user: ChatMessage = { id: "u", role: "user", timestamp: 1, content: "还要调整配色",
  selectionQuote: { sourceType: "storyboard-image", sourceId: "2109", selectedText: "原帧",
    storyId: 7, stableShotId: "s3", imageId: 2109 } };
const recover = (messages: ChatMessage[]) => recoverConversationTarget({ storyId: 7, shots, materialState, messages });
it("restores the explicitly started next shot until a newer user turn", () => {
  const next = {...user,role:"assistant" as const,id:"start-shot:7:s4",selectionQuote:{...user.selectionQuote!,sourceType:"shot" as const,storyId:7,stableShotId:"s4"}};
  const data={storyId:7,shots:[...shots,{...shots[0],stableShotId:"s4",shotNo:4}],materialState};
  expect(recoverConversationTarget({...data,messages:[user,next]})?.shotNo).toBe(4);
  expect(recoverConversationTarget({...data,messages:[next,user]})?.shotNo).toBe(3);
});

it("restores the last user-selected image, without selecting the assistant's new candidate", () => {
  expect(recover([user, { id: "a", role: "assistant", timestamp: 2, content: "候选 #2116" }]))
    .toMatchObject({ sourceType: "storyboard-image", imageId: 2109, stableShotId: "s3" });
});
it("restores the latest explicitly named shot instead of the playhead or an older image", () => {
  expect(recover([user, { id: "u2", role: "user", timestamp: 3, content: "检查第03镜生成视频还缺什么" }]))
    .toMatchObject({ sourceType: "shot", stableShotId: "s3" });
  expect(recover([user, { id: "u2", role: "user", timestamp: 3, content: "聊聊别的" }])).toBeNull();
});
it("keeps the exact inline image after a quote is canceled and the page reloads", () => {
  expect(recover([{ ...user, content: '[[ref:image%3A2116]] 云更白', selectionQuote: { ...user.selectionQuote!, sourceType: 'shot', imageId: undefined } },
    {id:'cancel',role:'assistant',content:'已取消报价',timestamp:2}])).toMatchObject({imageId:2116});
});
it("rejects foreign, removed and stale-region targets without falling back to an older selection", () => {
  for (const patch of [{ storyId: 8 }, { stableShotId: "deleted" }, { imageId: 999 },
    { selection: { kind: "rect" as const, x: 0, y: 0, width: 1, height: 1 } }]) {
    expect(recover([user, { ...user, id: "bad", selectionQuote: { ...user.selectionQuote!, ...patch } }])).toBeNull();
  }
  expect(recoverConversationTarget({ storyId: 8, shots, materialState, messages: [user] })).toBeNull();
});

it('restores a completed remix as the chat subject but lets subsequent user choices win',()=>{
 const result:ChatMessage={id:'remix-result:q',role:'assistant',content:'已保存',timestamp:3,imageRevision:{storyId:7,stableShotId:'s3',shotNo:3,imageId:2116,imageUrl:'/candidate.png'}};
 expect(recover([user,result])).toMatchObject({imageId:2116,materialStatus:'candidate-image'});
 expect(recover([user,result,{...user,id:'u2',timestamp:4}])).toMatchObject({imageId:2109});
 expect(recover([user,{...result,imageRevision:{...result.imageRevision!,storyId:8}}])).toBeNull();
});
