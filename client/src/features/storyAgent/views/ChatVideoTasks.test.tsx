import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect,it,vi } from "vitest";
import type { VideoTakeAsset } from "@shared/videoAsset";
const m=vi.hoisted(()=>({data:[] as VideoTakeAsset[]}));
vi.mock("@/lib/trpc",()=>({trpc:{storyAgent:{storyVideoAssets:{useQuery:()=>({data:m.data})}}}}));
vi.mock("@tanstack/react-query",()=>({useMutationState:()=>[]}));
import { ChatVideoTasks,chatVideoTasks } from "./ChatVideoTasks";
const take=(id:number,stableShotId="s3",status="available",provider="local")=>({id,stableShotId,status,provider,videoUrl:`/${id}.mp4`,durationSec:8,updatedAt:new Date().toISOString()}) as VideoTakeAsset;
it("restores previews from persisted takes without adopting, isolates shot history",()=>{
 vi.stubGlobal("React",React);m.data=[take(1),take(2),take(3,"s4"),take(4,"s3","available","local-import")];
 expect(chatVideoTasks(m.data,"s3").map(t=>t.id)).toEqual([2,1]);
 const html=renderToStaticMarkup(<ChatVideoTasks storyId={7} shots={[{shotNo:3,stableShotId:"s3"}]} stableShotId="s3"/>);
 expect(html).toContain('src="/2.mp4"');expect(html).not.toContain('/3.mp4');expect(html).toContain("第 03 镜采用视频 Take 2");expect(html).toContain("<details");expect(html).not.toContain("<button");
});
it("shows failure or unknown receipt without an endless generating state",()=>{
 vi.stubGlobal("React",React);m.data=[take(3,"s3","failed")];
 expect(renderToStaticMarkup(<ChatVideoTasks storyId={7} shots={[]}/>)).toContain("生成失败 · 未自动重试");
 m.data=[{...take(3,"s3","processing"),updatedAt:"2020-01-01T00:00:00Z"}];
 expect(renderToStaticMarkup(<ChatVideoTasks storyId={7} shots={[]}/>)).toContain("状态待确认");
});
