import {expect,it} from "vitest";
import {bookImageProgressMessage,recordBookImageProgress} from "./bookImageChatProgress";
import {storySpineStore} from "@/features/storyAgent/spine/storySpine";
import type {BookImageWork} from "./bookImageEditWork";
import type {BookMediaSession} from "./bookMediaSession";

const work: BookImageWork = {request:"裁掉左边，改成正方形。两人等高。换成清晨色调",cropped:true,chatId:"book-image-progress:one",phase:"quote"};
it("shows confirmed cost only after acceptance and keeps the image with its result",()=>{
  const quote=bookImageProgressMessage(work,"base",2)!;
  expect(quote.content).toContain("第 02 镜");
  expect(quote.content).toContain("裁左，留右");
  expect(quote.content).not.toContain("已确认本次生成报价");
  const rendering={...work,confirmedCny:1.43};
  expect(bookImageProgressMessage({...rendering,phase:"sending"},"base")!.content).toContain("2.86 算力\n正在生成");
  expect(bookImageProgressMessage({...rendering,phase:"failed",message:"未取到图片"},"base")!.content).toContain("未取到图片");
  expect(bookImageProgressMessage({...rendering,phase:"review",resultUrl:"candidate"},"base")?.photoUrl).toBe("candidate");
  const done=bookImageProgressMessage({...rendering,phase:"done"},"adopted")!;
  expect(done.content).toContain("已放回文章");expect(done.photoUrl).toBe("adopted");
});
it("updates one assistant receipt per edit and ignores results from another account, story or epoch",()=>{
  const before=storySpineStore.getState();
  const session={accountId:2,storyId:3,epoch:4,shotNo:2} as BookMediaSession;
  try {
    storySpineStore.setState({accountId:2,activeStoryId:3,storyScopeEpoch:4,messages:[]});
    for (const mismatch of [{accountId:1},{storyId:1},{epoch:1}]) recordBookImageProgress({...session,...mismatch},work,"base");
    expect(storySpineStore.getState().messages).toHaveLength(0);
    recordBookImageProgress(session,work,"base");
    const timestamp=storySpineStore.getState().messages[0].timestamp;
    recordBookImageProgress(session,{...work,phase:"done"},"adopted");
    expect(storySpineStore.getState().messages).toMatchObject([{timestamp,photoUrl:"adopted",role:"assistant"}]);
  } finally {storySpineStore.setState(before);}
});
