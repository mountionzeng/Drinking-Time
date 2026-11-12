import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({quote:vi.fn(),split:vi.fn(),state:{activeStoryId:7,storyScopeEpoch:1,setMessages:vi.fn()}}));
vi.mock("@/lib/trpc",()=>({trpc:{useUtils:()=>({storyAgent:{quoteChatLlm:{fetch:m.quote}}})}}));
vi.mock("@/features/uiLanguage/UiLanguage",()=>({useUiLanguage:()=>({language:"en"})}));
vi.mock("./spine/storySpine",()=>({storySpineStore:{getState:()=>m.state}}));
import { useShotSplitChat } from "./useShotSplitChat";
function setup(){let api!:ReturnType<typeof useShotSplitChat>;function Host(){api=useShotSplitChat({storyId:7,editor:{shots:[{shotNo:3,stableShotId:"s3",imageVersions:[1,2,3].map(id=>({id,imageUrl:`/${id}`}))}],timelineLayoutRows:[{item:{stableShotId:"s3"},startFrame:180,endFrame:420}],splitTimelineVideoClip:m.split} as never});return null;}renderToStaticMarkup(<Host/>);return api;}
beforeEach(()=>{vi.stubGlobal("React",React);vi.clearAllMocks();m.state.activeStoryId=7;m.quote.mockResolvedValue({totalCny:0.1});m.split.mockResolvedValue("new-shot");});
it("quotes free, only the explicit confirmation splits, and uses one shared boundary",async()=>{
 const api=setup();await api.handle("第3镜拆成两段，用 #1、#2、#3，每段4秒");expect(m.split).not.toHaveBeenCalled();
 expect(await api.handle("confirm split")).toBe(true);
 expect(m.split).toHaveBeenCalledTimes(1);
 expect(m.split).toHaveBeenCalledWith({stableShotId:"s3",cutFrame:300,startEndPlan:{imageIds:[1,2,3],durationSec:4,expectedStartFrame:180,expectedEndFrame:420}});
 expect(m.state.setMessages).toHaveBeenCalled();
});
it("cancelled or stale proposals cannot mutate the editor",async()=>{
 const api=setup();await api.handle("第3镜拆成两段，用 #1、#2、#3，每段4秒");await api.handle("cancel");await api.handle("confirm split");
 await api.handle("第3镜拆成两段，用 #1、#2、#3，每段4秒");m.state.activeStoryId=8;await api.handle("confirm split");expect(m.split).not.toHaveBeenCalled();
});
it("consumes invalid targets without falling through to a model",async()=>{
 const api=setup();for(const text of ["第99镜拆成两段，用 #1、#2、#3", "第3镜拆成两段，用 #1、#1、#3", "第3镜拆成两段，用 #1、#2、#3，每段6秒"])expect(await api.handle(text)).toBe(true);
 expect(m.quote).not.toHaveBeenCalled();expect(m.split).not.toHaveBeenCalled();
});
it("a late quote cannot revive a cancelled proposal",async()=>{
 let finish!:(value:{totalCny:number})=>void;m.quote.mockReturnValue(new Promise(resolve=>{finish=resolve;}));const api=setup();
 const pending=api.handle("第3镜拆成两段，用 #1、#2、#3");await api.handle("cancel");finish({totalCny:0.1});await pending;await api.handle("confirm split");expect(m.split).not.toHaveBeenCalled();
});
