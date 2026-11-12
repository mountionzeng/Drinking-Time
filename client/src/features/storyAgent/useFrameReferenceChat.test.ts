import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ capture:vi.fn(), invalidate:vi.fn(), state:{accountId:1,activeStoryId:7,storyScopeEpoch:1,storyLoadEpoch:1} }));
vi.mock("@/lib/trpc",()=>({trpc:{creationAgent:{chatFrameReferences:{useMutation:()=>({mutateAsync:m.capture})}},useUtils:()=>({storyAgent:{storyImages:{invalidate:m.invalidate},storyMaterialState:{invalidate:m.invalidate}}})}}));
vi.mock("@/features/uiLanguage/UiLanguage",()=>({useUiLanguage:()=>({language:"en"})}));
vi.mock("./spine/storySpine",()=>({storySpineStore:{getState:()=>({...m.state})}}));
import { useFrameReferenceChat } from "./useFrameReferenceChat";
beforeEach(()=>{vi.clearAllMocks();m.state.activeStoryId=7;});
it("does not capture unrelated instructions and handles failures without falling into generation",async()=>{
  const run=useFrameReferenceChat();expect(await run(7,"generate a video")).toBeNull(); expect(m.capture).not.toHaveBeenCalled();
  m.capture.mockRejectedValue(new Error("unavailable"));expect(await run(7,"capture frames")).toMatchObject({handled:true,reply:expect.stringContaining("unavailable")});
});
it("does not attach late frames to another story",async()=>{
  m.capture.mockImplementation(async()=>{m.state.activeStoryId=9;return {frames:[{imageId:55}],failures:[],shotNo:3,requestedCount:1};});
  const result=await useFrameReferenceChat()(7,"capture frames");expect(result).not.toHaveProperty("frameReferences");
});
it("does not announce success when zero frames were saved",async()=>{
  m.capture.mockResolvedValue({frames:[],failures:["storage unavailable"],shotNo:3,requestedCount:3});
  expect((await useFrameReferenceChat()(7,"capture frames"))?.reply).toContain("no reference frames were saved");
});
